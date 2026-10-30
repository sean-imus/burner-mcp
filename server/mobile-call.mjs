// Debugging aid: talk to raw mobile-mcp (the layer under burner-mcp) over stdio and run a list of calls.
// Useful to see what mobile-mcp itself returns, e.g. the full element JSON.
// usage: node server/mobile-call.mjs '<json array of {name, arguments}>' [outdir]
//        name "tools/list" lists tools (prints names + input schemas). The device id is the AVD name (BURNER_AVD, default "burner").
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const calls = JSON.parse(process.argv[2] ?? "[]");
const outDir = process.argv[3] ?? ".";
// The same pinned mobile-mcp that burner-mcp runs, from server/node_modules.
const MOBILE_MCP = createRequire(import.meta.url).resolve("@mobilenext/mobile-mcp/lib/index.js");
const srv = spawn(process.execPath, [MOBILE_MCP, "--stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, MOBILEMCP_DISABLE_TELEMETRY: "1" },
});

let buf = "", nextId = 1;
const pending = new Map();
srv.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const rpc = (method, params) => new Promise((res) => {
  const id = nextId++;
  pending.set(id, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "burner-mobile-call", version: "0" } });
console.log(`server: ${init.result.serverInfo.name} ${init.result.serverInfo.version}`);
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

let shot = 0;
for (const c of calls) {
  if (c.name === "tools/list") {
    const r = await rpc("tools/list", {});
    for (const t of r.result.tools) console.log(`- ${t.name}(${Object.keys(t.inputSchema?.properties ?? {}).join(", ")})`);
    continue;
  }
  const r = await rpc("tools/call", { name: c.name, arguments: c.arguments ?? {} });
  console.log(`\n### ${c.name} ${JSON.stringify(c.arguments ?? {})}${r.result?.isError ? "  [isError]" : ""}`);
  if (r.error) { console.log("RPC ERROR", JSON.stringify(r.error)); continue; }
  for (const part of r.result.content) {
    if (part.type === "text") console.log(part.text);
    else if (part.type === "image") {
      const f = join(outDir, `shot-${++shot}.${part.mimeType.split("/")[1]}`);
      writeFileSync(f, Buffer.from(part.data, "base64"));
      console.log(`[image ${part.mimeType} -> ${f}]`);
    }
  }
}
srv.kill();
