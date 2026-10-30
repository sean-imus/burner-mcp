// Run the phone tasks with headless Claude and grade them on the phone.
// usage: node eval/run.mjs <setup> [model] [taskId,...]
//   setup: "burner" = burner-mcp over HTTP (needs it running; token from ~/.config/burner-mcp/env)
//          "mobile" = plain mobile-mcp over stdio, for comparison
//   model: haiku (default), sonnet, opus, or a full model id
// Each task starts from the "clean" snapshot. The model gets no built-in tools (only the phone) and a short system
// prompt, so token counts mostly reflect the phone tools. Results are appended to eval/results.jsonl.
import { writeFileSync, appendFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tasks } from "./tasks.mjs";
import { MCP_URL, TOKEN } from "../server/config.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const [setup = "burner", model = "haiku", only] = process.argv.slice(2);
const selected = only ? tasks.filter((t) => only.split(",").includes(t.id)) : tasks;

const SYSTEM = "You operate an Android phone through the available tools. Complete the user's task on the phone " +
  "without asking questions, then answer in one sentence. Skip or dismiss any account sign-in prompts.";

const servers = {
  burner: { type: "http", url: MCP_URL, headers: { Authorization: `Bearer ${TOKEN}` } },
  mobile: { command: process.execPath, args: [join(REPO, "server/node_modules/@mobilenext/mobile-mcp/lib/index.js"), "--stdio"], env: { MOBILEMCP_DISABLE_TELEMETRY: "1" } },
};
if (!servers[setup]) throw new Error(`unknown setup ${setup}`);
const configFile = join(mkdtempSync(join(tmpdir(), "burner-eval-")), "mcp.json");
writeFileSync(configFile, JSON.stringify({ mcpServers: { [setup]: servers[setup] } }), { mode: 0o600 });

// Runs one task; the full stream (every tool call and result) is saved to eval/transcripts/ for reading failures.
function claude(prompt, transcript) {
  return new Promise((resolve) => {
    const args = ["-p", "--model", model, "--mcp-config", configFile, "--strict-mcp-config", "--tools", "",
      "--allowedTools", `mcp__${setup}__*`, "--system-prompt", SYSTEM, "--max-turns", "40",
      "--output-format", "stream-json", "--verbose", prompt];
    const p = spawn("claude", args, { cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => p.kill("SIGTERM"), 10 * 60_000);
    p.on("close", () => {
      clearTimeout(timer);
      writeFileSync(transcript, out);
      const result = out.trim().split("\n").reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .find((m) => m?.type === "result");
      resolve(result ?? { is_error: true, result: out.slice(-300) });
    });
  });
}

console.log(`setup=${setup} model=${model} tasks=${selected.length}\n`);
for (const task of selected) {
  execFileSync(join(REPO, "bin/emu-reset"), { stdio: "ignore" });
  task.setup?.();
  const started = Date.now();
  mkdirSync(join(REPO, "eval/transcripts"), { recursive: true });
  const r = await claude(task.prompt, join(REPO, `eval/transcripts/${setup}-${model}-${task.id}.jsonl`));
  const seconds = Math.round((Date.now() - started) / 1000);
  let ok = false;
  try { ok = !!task.grade(r.result ?? ""); } catch (err) { ok = false; r.gradeError = err.message; }
  const u = r.usage ?? {};
  const row = {
    when: new Date().toISOString(), setup, model, task: task.id, ok, turns: r.num_turns, seconds,
    input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    output_tokens: u.output_tokens ?? 0, cost_usd: r.total_cost_usd, stop: r.subtype, answer: (r.result ?? "").slice(0, 200),
  };
  appendFileSync(join(REPO, "eval/results.jsonl"), JSON.stringify(row) + "\n");
  console.log(`${ok ? "PASS" : "FAIL"} ${task.id.padEnd(24)} turns=${String(row.turns).padStart(2)} in=${String(row.input_tokens).padStart(7)} out=${String(row.output_tokens).padStart(5)} ${seconds}s  ${row.answer.replace(/\s+/g, " ").slice(0, 90)}`);
}
execFileSync(join(REPO, "bin/emu-reset"), { stdio: "ignore" });
