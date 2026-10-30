// Robustness checks for a running burner-mcp on this machine (it kills processes and restarts the phone).
// usage: node server/robustness.mjs [soakMinutes=10]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_URL as URL_, TOKEN, SERIAL } from "./config.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const soakMinutes = Number(process.argv[2] ?? 10);

async function connect() {
  const c = new Client({ name: "robustness", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(URL_), { authProvider: { token: async () => TOKEN } }));
  return c;
}
const client = await connect();
async function call(name, args = {}) {
  const started = Date.now();
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.filter((p) => p.type === "text").map((p) => p.text).join("\n"), isError: !!r.isError, ms: Date.now() - started };
}
const pids = (pattern) => { try { return execSync(`pgrep -f '${pattern}'`, { encoding: "utf8" }).trim().split("\n").map(Number).filter((p) => p !== process.pid); } catch { return []; } };
const rssMb = (pid) => { try { return Math.round(Number(readFileSync(`/proc/${pid}/statm`, "utf8").split(" ")[1]) * 4096 / 1048576); } catch { return NaN; } };
const run = (cmd) => execFileSync(join(REPO, "bin", cmd), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const results = [];
async function check(name, fn) {
  try { const note = await fn(); results.push(["✓", name, note ?? ""]); console.log(`  ✓ ${name} ${note ?? ""}`); }
  catch (err) { results.push(["✗", name, err.message]); console.log(`  ✗ ${name}: ${err.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log("burner-mcp robustness\n");
await call("reset");

await check("recovers after mobile-mcp is killed", async () => {
  const child = pids("mobile-mcp/lib/index.js --stdio");
  assert(child.length > 0, "no mobile-mcp child found");
  child.forEach((p) => process.kill(p, "SIGKILL"));
  await sleep(500);
  const first = await call("screen");
  const second = first.isError ? await call("screen") : first;
  assert(!second.isError, second.text.slice(0, 120));
  return `(first call after kill: ${first.isError ? "error, then recovered" : "ok"}, ${first.ms} ms)`;
});

await check("clear error, no hang, when the phone is down", async () => {
  run("emu-stop");
  for (let i = 0; i < 60 && execSync("adb devices", { encoding: "utf8" }).includes(SERIAL); i++) await sleep(1000);
  const r = await call("screen");
  assert(r.isError, "expected an error with the phone down");
  assert(r.ms < 30_000, `took ${r.ms} ms`);
  return `(${r.ms} ms: ${r.text.slice(0, 80)})`;
});

await check("works again after the phone comes back, without restarting the server", async () => {
  run("emu-start");
  const r = await call("screen");
  const again = r.isError ? await call("screen") : r;
  assert(!again.isError && /App: /.test(again.text), again.text.slice(0, 120));
  return r.isError ? "(needed one retry)" : "";
});

await check("long text (1000 chars) types completely", async () => {
  await call("reset");
  await call("open", { app: "Settings" });
  const long = "a".repeat(1000);
  const r = await call("type", { into: "Search Settings", text: long });
  const typed = r.text.match(/"(a+)…?" \[edittext\]/)?.[1]?.length ?? 0;
  assert(!r.isError && typed >= 300, `edittext shows ${typed} chars: ${r.text.slice(0, 160)}`); // screen text is capped at 300
  return `(${r.ms} ms)`;
});

await check("non-ASCII text types correctly", async () => {
  await call("reset");
  await call("open", { app: "Settings" });
  const r = await call("type", { into: "Search Settings", text: "café über 東京" });
  assert(!r.isError && /"café über 東京" \[edittext\]/.test(r.text), r.text.slice(0, 200));
});

await check("emoji text types correctly", async () => {
  await call("reset");
  await call("open", { app: "Settings" });
  const r = await call("type", { into: "Search Settings", text: "hi 👋" });
  assert(!r.isError && /"hi 👋" \[edittext\]/.test(r.text), r.text.slice(0, 200));
});

await check("burst: 5 clients x 4 calls at once", async () => {
  await call("reset");
  const clients = await Promise.all(Array.from({ length: 5 }, connect));
  const started = Date.now();
  const all = await Promise.all(clients.flatMap((c) => Array.from({ length: 4 }, () => c.callTool({ name: "screen", arguments: {} }))));
  const bad = all.filter((r) => r.isError).length;
  await Promise.all(clients.map((c) => c.close()));
  assert(bad === 0, `${bad} of 20 failed`);
  return `(20 calls in ${Date.now() - started} ms)`;
});

await check(`soak: ${soakMinutes} min of mixed calls`, async () => {
  await call("reset");
  const server = pids("server/index.mjs")[0], child = () => pids("mobile-mcp/lib/index.js --stdio")[0], emu = pids("qemu-system-x86_64")[0];
  const before = { server: rssMb(server), child: rssMb(child()), emulator: rssMb(emu) };
  const steps = [["open", { app: "Settings" }], ["swipe", { direction: "up" }], ["press", { button: "BACK" }], ["press", { button: "HOME" }], ["screen", {}]];
  const lat = [];
  let errors = 0;
  const end = Date.now() + soakMinutes * 60_000;
  for (let i = 0; Date.now() < end; i++) {
    const [name, args] = steps[i % steps.length];
    const r = await call(name, args);
    lat.push(r.ms);
    if (r.isError) errors++;
  }
  lat.sort((a, b) => a - b);
  const after = { server: rssMb(server), child: rssMb(child()), emulator: rssMb(emu) };
  const p = (q) => lat[Math.floor(q * (lat.length - 1))];
  assert(errors === 0, `${errors} errors in ${lat.length} calls`);
  return `(${lat.length} calls, p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${lat.at(-1)} ms; RSS MB before→after: server ${before.server}→${after.server}, mobile-mcp ${before.child}→${after.child}, emulator ${before.emulator}→${after.emulator})`;
});

await call("reset");
await client.close();
const failed = results.filter((r) => r[0] === "✗").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
