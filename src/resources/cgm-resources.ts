import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildAgentManifest } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildPrivacyAudit } from "../services/privacy-audit.js";
import { CgmSource } from "../services/cgm-source.js";
import { DexcomClient } from "../services/dexcom-client.js";

function jsonResource(uri: URL, data: unknown) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function registerCgmResources(server: McpServer): void {
  server.registerResource(
    "cgm_agent_manifest",
    "wellness-cgm-mcp://agent-manifest",
    {
      title: "CGM Agent Manifest",
      description: "Machine-readable install and operating instructions for AI agents.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, buildAgentManifest("generic")),
  );

  server.registerResource(
    "cgm_capabilities",
    "wellness-cgm-mcp://capabilities",
    {
      title: "CGM Capabilities",
      description: "Supported providers, metrics, and privacy modes.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, buildCapabilities()),
  );

  server.registerResource(
    "cgm_connection_status",
    "wellness-cgm-mcp://connection-status",
    {
      title: "CGM Connection Status",
      description: "Active CGM provider and mock vs live readiness (no tokens).",
      mimeType: "application/json",
    },
    async (uri) => {
      const source = CgmSource.resolve();
      const status = source.status();
      const dexcom = new DexcomClient();
      return jsonResource(uri, {
        ...status,
        env: dexcom.env,
        client_id_configured: Boolean(dexcom.clientId),
        access_token_configured: dexcom.hasAuth(),
      });
    },
  );

  server.registerResource(
    "cgm_data_inventory",
    "wellness-cgm-mcp://inventory",
    {
      title: "CGM Data Inventory",
      description: "Metric catalog and TIR thresholds.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri, {
        metrics: [
          { id: "mgdl", unit: "mg/dL" },
          { id: "trend", unit: "arrow" },
          { id: "tir_diabetic", unit: "%" },
          { id: "tir_metabolic_health", unit: "%" },
          { id: "gmi", unit: "% A1C estimate" },
          { id: "cv", unit: "%" },
        ],
        privacy_modes: ["summary", "structured", "raw"],
      }),
  );

  server.registerResource(
    "cgm_privacy_audit",
    "wellness-cgm-mcp://privacy-audit",
    {
      title: "CGM Privacy Audit",
      description: "What wellness-cgm-mcp stores locally and sends outbound.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, buildPrivacyAudit()),
  );
}
