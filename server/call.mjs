// Call burner-mcp over HTTP, the same way Claude does. Handy for checking a host from any machine.
// usage: node server/call.mjs '<json array of {name, arguments}>' [outdir]
//        name "tools/list" prints the tools; screenshots are saved to outdir (default: .)
// env:   BURNER_MCP_URL (default http://127.0.0.1:8790/mcp), BURNER_MCP_TOKEN
//        Both are read from ~/.config/burner-mcp/env if not set.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_URL as url, TOKEN as token } from "./config.mjs";

if (!token) throw new Error("Set BURNER_MCP_TOKEN (or create ~/.config/burner-mcp/env)");

const calls = JSON.parse(process.argv[2] ?? '[{"name":"screen"}]');
const outDir = process.argv[3] ?? ".";

const client = new Client({ name: "burner-call", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { authProvider: { token: async () => token } }));

let shot = 0;
for (const c of calls) {
  if (c.name === "tools/list") {
    const { tools } = await client.listTools();
    for (const t of tools) console.log(`- ${t.name}(${Object.keys(t.inputSchema?.properties ?? {}).join(", ")}): ${t.description}`);
    continue;
  }
  const started = Date.now();
  const r = await client.callTool({ name: c.name, arguments: c.arguments ?? {} });
  console.log(`\n### ${c.name} ${JSON.stringify(c.arguments ?? {})} (${Date.now() - started} ms)${r.isError ? "  [isError]" : ""}`);
  for (const part of r.content) {
    if (part.type === "text") console.log(part.text);
    else if (part.type === "image") {
      const f = join(outDir, `phone-${++shot}.${part.mimeType.split("/")[1]}`);
      writeFileSync(f, Buffer.from(part.data, "base64"));
      console.log(`[image ${part.mimeType} -> ${f}]`);
    }
  }
}
await client.close();
