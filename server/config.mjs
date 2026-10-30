// Settings for the scripts around the server (call, tests, eval): the environment first, then
// ~/.config/burner-mcp/env (written by install.sh). The server itself only reads the environment.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const file = {};
try {
  for (const line of readFileSync(join(homedir(), ".config/burner-mcp/env"), "utf8").split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) file[m[1]] = m[2];
  }
} catch {}
const get = (key) => process.env[key] || file[key];

export const PORT = Number(get("BURNER_MCP_PORT") || 8790);
export const MCP_URL = get("BURNER_MCP_URL") || `http://127.0.0.1:${PORT}/mcp`;
export const TOKEN = get("BURNER_MCP_TOKEN");
export const AVD = get("BURNER_AVD") || "burner";
export const SERIAL = get("BURNER_SERIAL") || "emulator-5554";
