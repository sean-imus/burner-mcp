// End-to-end test suite for burner-mcp. Drives a real phone over HTTP and checks effects with adb.
// usage: node server/test.mjs            (URL and token from env or ~/.config/burner-mcp/env, like call.mjs)
//        BURNER_TEST_ADB=0 node server/test.mjs   skip adb ground-truth checks (e.g. against a remote host)
// It resets the phone at the start and the end, so anything done on the phone in between is lost.
import { execFileSync } from "node:child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_URL as URL_, TOKEN, SERIAL } from "./config.mjs";

const ADB = process.env.BURNER_TEST_ADB !== "0";

const sh = (...args) => execFileSync("adb", ["-s", SERIAL, ...args], { encoding: "utf8" }).trim();
const darkMode = () => sh("shell", "cmd", "uimode", "night").includes("yes");

async function connect() {
  const c = new Client({ name: "burner-test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(URL_), { authProvider: { token: async () => TOKEN } }));
  return c;
}
const client = await connect();

const sizes = {};
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  (sizes[name] ??= []).push(text.length);
  return { text, images: r.content.filter((p) => p.type === "image"), isError: !!r.isError };
}
const refFor = (screen, pattern) => screen.split("\n").find((l) => pattern.test(l))?.match(/^@e\d+\.\d+/)?.[0];
const xyFor = (screen, pattern) => screen.split("\n").find((l) => pattern.test(l))?.match(/@(\d+),(\d+)$/)?.slice(1).join(",");

let passed = 0, failed = 0;
async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log(`burner-mcp tests against ${URL_}${ADB ? "" : " (no adb checks)"}\n`);

await test("rejects missing and wrong tokens", async () => {
  for (const auth of [undefined, "Bearer wrong"]) {
    const res = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: "{}" });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  }
});

await test("healthz answers", async () => {
  const res = await fetch(URL_.replace(/\/mcp$/, "/healthz"));
  assert(res.ok && (await res.json()).ok === true, "healthz not ok");
});

await test("lists 7 compact tools with instructions", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort().join(",");
  assert(names === "open,press,reset,screen,swipe,tap,type", `tools: ${names}`);
  const size = JSON.stringify(tools).length;
  assert(size < 5000, `tool definitions are ${size} chars`);
  assert((client.getInstructions?.() ?? "").includes("ONE action"), "server instructions missing");
});

// The tests must not depend on what the clean snapshot contains (apps, home screen, dark mode): the user may re-save
// it at any time. So Settings is opened fresh, and the final check compares against the state right after reset.
let cleanDarkMode;
async function freshSettings() {
  if (ADB) sh("shell", "am", "force-stop", "com.android.settings"); // else it resumes on whatever page it was left
  else await call("press", { button: "HOME" });
  return call("open", { app: "settings" });
}

await test("reset returns to the launcher", async () => {
  const r = await call("reset");
  assert(!r.isError && /App: Pixel Launcher/.test(r.text), r.text.slice(0, 200));
  if (ADB) cleanDarkMode = darkMode();
});

await test("screen is compact; status bar is one summary line", async () => {
  const r = await call("screen");
  assert(/^App: /.test(r.text) && /@e\d+\.\d+ "(Phone|Chrome)"/.test(r.text), r.text.slice(0, 200));
  assert(/^Status: .*Battery/m.test(r.text), "no Status line with the battery");
  const elementLines = r.text.split("\n").filter((l) => l.startsWith("@e")).join("\n");
  assert(!/Battery|Wifi signal|signal full/.test(elementLines), "status bar icons listed as elements");
  assert(r.text.length < 1500, `home screen is ${r.text.length} chars`);
});

await test("open by name, then tap by coordinates navigates", async () => {
  const settings = await freshSettings();
  assert(/App: Settings/.test(settings.text), settings.text.slice(0, 200));
  const xy = xyFor(settings.text, /"Display & touch"/);
  assert(xy, "no Display & touch row in Settings");
  const r = await call("tap", { target: xy });
  assert(/"Dark theme"/.test(r.text), r.text.slice(0, 300));
});

await test("tap by text navigates", async () => {
  const r = await call("tap", { target: "Dark theme" });
  assert(/switch "Use dark theme"/.test(r.text), r.text.slice(0, 300));
});

await test("tap by text toggles a switch (checked with adb)", async () => {
  const before = ADB && darkMode();
  const r = await call("tap", { target: "Use dark theme" });
  assert(/\[switch "Use dark theme": (on|off)\]/.test(r.text), r.text.slice(0, 300));
  if (ADB) assert(darkMode() !== before, "dark mode did not change");
});

await test("tap by ref toggles it back", async () => {
  const ref = refFor((await call("screen")).text, /switch "Use dark theme"/);
  assert(ref, "no ref for the switch");
  const before = ADB && darkMode();
  await call("tap", { target: ref });
  if (ADB) assert(darkMode() !== before, "dark mode did not change");
});

await test("radio buttons are labelled by their row title", async () => {
  const r = await call("screen");
  assert(/\[radio "Standard": (on|off)\]/.test(r.text) && /\[radio "Expanded"/.test(r.text), r.text.slice(0, 400));
});

await test("swipe up scrolls", async () => {
  const before = (await call("screen")).text;
  const after = (await call("swipe", { direction: "up" })).text;
  assert(after !== before, "screen did not change");
});

await test("exact drag from→to scrolls", async () => {
  const before = (await call("screen")).text;
  const r = await call("swipe", { from: "540,700", to: "540,1800", ms: 300 });
  assert(!r.isError && /Dragged/.test(r.text) && r.text !== before, r.text.slice(0, 200));
});

await test("press BACK and HOME", async () => {
  await call("press", { button: "BACK" });
  const r = await call("press", { button: "HOME" });
  assert(/App: Pixel Launcher/.test(r.text), r.text.slice(0, 200));
});

await test("open by app name and type into a search field", async () => {
  await call("reset");
  await freshSettings();
  const r = await call("type", { into: "Search Settings", text: "bluetooth" });
  assert(/"bluetooth" \[edittext\]/.test(r.text), r.text.slice(0, 300));
});

await test("type clear=true replaces the field's text", async () => {
  const r = await call("type", { text: "wifi", clear: true });
  assert(/"wifi" \[edittext\]/.test(r.text) && !/bluetooth/.test(r.text.split("\n").find((l) => l.includes("[edittext]")) ?? ""), r.text.slice(0, 300));
});

await test("press times=N repeats", async () => {
  const r = await call("press", { button: "BACKSPACE", times: 4 });
  assert(/Pressed BACKSPACE 4 times/.test(r.text) && !/"wifi" \[edittext\]/.test(r.text), r.text.slice(0, 300));
});

await test("a ref from an older screen is refused even if a later screen reused its number", async () => {
  await call("press", { button: "HOME" });
  const home = (await call("screen")).text;
  const staleRef = refFor(home, /"(Phone|Chrome)"/);
  assert(staleRef, "no Phone/Chrome icon on the home screen");
  await call("open", { app: "Settings" }); // the screen changes; the old ref now means something else
  const r = await call("tap", { target: staleRef });
  assert(r.isError && /screen changed/.test(r.text) && /App: Settings/.test(r.text), r.text.slice(0, 200));
});

await test("screen image=true returns a screenshot with its scale", async () => {
  const r = await call("screen", { image: true });
  assert(r.images.length === 1 && /multiply its x by/.test(r.text), "missing image or scale note");
});

await test("actions accept image=true", async () => {
  const r = await call("press", { button: "HOME", image: true });
  assert(r.images.length === 1, "no image");
});

await test("errors are clear, not crashes", async () => {
  for (const [name, args, pattern] of [
    ["tap", { target: "zzz nothing here" }, /Nothing on screen matches/],
    ["open", { app: "no such app" }, /No app called/],
    ["open", {}, /Give either app or url/],
    ["swipe", {}, /Give a direction/],
    ["swipe", { to: "1,1" }, /needs both from and to/],
  ]) {
    const r = await call(name, args);
    assert(r.isError && pattern.test(r.text), `${name} ${JSON.stringify(args)} -> ${r.text.slice(0, 120)}`);
  }
});

await test("bad arguments are rejected by the schema", async () => {
  let rejected = false;
  try { rejected = (await call("press", { button: "TELEPORT" })).isError; } catch { rejected = true; }
  assert(rejected, "invalid button was accepted");
});

await test("three clients at once all succeed", async () => {
  const clients = await Promise.all([connect(), connect(), connect()]);
  const results = await Promise.all(clients.map((c) => c.callTool({ name: "screen", arguments: {} })));
  assert(results.every((r) => !r.isError && /App: /.test(r.content[0].text)), "a concurrent call failed");
  await Promise.all(clients.map((c) => c.close()));
});

await test("reset restores the clean state", async () => {
  const r = await call("reset");
  assert(/App: Pixel Launcher/.test(r.text), r.text.slice(0, 200));
  if (ADB) assert(darkMode() === cleanDarkMode, "dark mode differs from the state right after the first reset");
});

await client.close();

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Response sizes (chars, max per tool):", Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, Math.max(...v)])));
process.exit(failed ? 1 : 0);
