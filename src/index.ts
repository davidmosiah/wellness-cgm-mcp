#!/usr/bin/env node
import cors from "cors";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DEFAULT_HOST, DEFAULT_PORT, SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { isCliCommand, runCliCommand } from "./cli/commands.js";
import { registerCgmTools } from "./tools/cgm-tools.js";

function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerCgmTools(server);
  return server;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runHttp(): Promise<void> {
  const app = express();
  const host = process.env.WELLNESS_CGM_HOST ?? DEFAULT_HOST;
  const port = Number(process.env.WELLNESS_CGM_PORT ?? DEFAULT_PORT);
  const allowedOrigin = process.env.WELLNESS_CGM_ALLOWED_ORIGIN ?? `http://${host}:${port}`;

  app.use(express.json({ limit: "1mb" }));
  app.use(cors({ origin: allowedOrigin }));

  app.get("/health", (_req, res) => res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION }));

  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP HTTP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.listen(port, host, () => {
    console.error(`${SERVER_NAME} HTTP transport listening on http://${host}:${port}/mcp`);
  });
}

const args = process.argv.slice(2);

if (args.includes("--http")) {
  await runHttp();
} else if (isCliCommand(args)) {
  const code = await runCliCommand(args);
  process.exit(code);
} else if (args.length === 0 || args.includes("--stdio")) {
  await runStdio();
} else {
  console.error(
    [
      `${SERVER_NAME} v${SERVER_VERSION}`,
      "",
      "Usage:",
      "  wellness-cgm                Run MCP stdio server (default).",
      "  wellness-cgm --http         Run MCP Streamable HTTP server.",
      "  wellness-cgm doctor         Local DX checks.",
      "  wellness-cgm status         Show current configuration.",
      "  wellness-cgm setup [client] Print MCP client config snippet.",
      "  wellness-cgm authorize      Print Dexcom OAuth authorize URL.",
      "  wellness-cgm exchange <code> Swap an auth code for an access_token.",
    ].join("\n"),
  );
  process.exit(1);
}
