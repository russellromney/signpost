// Signpost MCP server (stdio). Exposes the loop as MCP tools so an LLM agent can
// live in Signpost natively. It is a thin transport over mcp/tools.ts, which
// wraps the same lib/ops authorized layer the REST API uses — identical rules,
// same local SQLite database.
//
// Run:  SIGNPOST_TOKEN=sk_russell_coding npm run mcp
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { identityForToken } from "../lib/auth";
import { getDb } from "../lib/db";
import { TOOLS, type ToolCtx } from "./tools";

const db = getDb();
// Every tool call acts AS this identity. Resolved once at startup; throws if the
// token is missing or invalid.
const caller = identityForToken(db, process.env.SIGNPOST_TOKEN ?? null);
const ctx: ToolCtx = { db, caller };

const server = new McpServer({ name: "signpost", version: "0.1.0" });

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema },
    async (args: Record<string, unknown>) => {
      try {
        const result = tool.run(ctx, args ?? {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`signpost MCP server ready as ${caller} (${TOOLS.length} tools)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
