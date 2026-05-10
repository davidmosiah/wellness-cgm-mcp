import { NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE, SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { buildCapabilities } from "./capabilities.js";
import { buildPrivacyAudit } from "./privacy-audit.js";

export type CgmAgentClient = "claude" | "codex" | "cursor" | "windsurf" | "hermes" | "openclaw" | "generic";

const SUPPORTED_CLIENTS: CgmAgentClient[] = [
  "claude",
  "codex",
  "cursor",
  "windsurf",
  "hermes",
  "openclaw",
  "generic",
];

const TOOLS = [
  "cgm_agent_manifest",
  "cgm_capabilities",
  "cgm_connection_status",
  "cgm_privacy_audit",
  "cgm_data_inventory",
  "cgm_quickstart",
  "cgm_demo",
  "cgm_glucose_now",
  "cgm_glucose_window",
  "cgm_daily_summary",
  "cgm_meal_response",
  "cgm_authorize_url",
] as const;

export interface CgmAgentManifest {
  name: string;
  version: string;
  client: string;
  supported_clients: CgmAgentClient[];
  install: { command: string; args: string[]; optional_env: string[] };
  recommended_first_calls: string[];
  tools: ReadonlyArray<string>;
  resources: string[];
  agent_rules: string[];
  community: { repo: string; issues: string; twitter: string; docs: string; invite: string };
  capabilities: ReturnType<typeof buildCapabilities>;
  privacy: ReturnType<typeof buildPrivacyAudit>;
}

export function buildAgentManifest(client: CgmAgentClient = "generic"): CgmAgentManifest {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    client,
    supported_clients: SUPPORTED_CLIENTS,
    install: {
      command: "npx",
      args: ["-y", PINNED_NPM_PACKAGE],
      optional_env: [
        "DEXCOM_ENV",
        "DEXCOM_CLIENT_ID",
        "DEXCOM_CLIENT_SECRET",
        "DEXCOM_REDIRECT_URI",
        "DEXCOM_ACCESS_TOKEN",
        "DEXCOM_REFRESH_TOKEN",
        "WELLNESS_CGM_LOCAL_DIR",
      ],
    },
    recommended_first_calls: ["cgm_quickstart", "cgm_demo", "cgm_glucose_now"],
    tools: TOOLS,
    resources: [
      "wellness-cgm-mcp://agent-manifest",
      "wellness-cgm-mcp://capabilities",
      "wellness-cgm-mcp://privacy-audit",
    ],
    agent_rules: [
      "Call cgm_connection_status before any provider-backed tool.",
      "Without DEXCOM_ACCESS_TOKEN, all glucose tools return mock data — clearly tagged.",
      "Surface the time-in-range profile being used (diabetic 70-180 vs metabolic-health 70-140).",
      "When meal_response band is 'poor', cross-reference the meal in wellness-nourish and suggest a swap.",
      "Treat CGM data as medical-record sensitive. Defer insulin / medication dosing to clinician.",
      "Never claim diagnostic accuracy.",
    ],
    community: {
      repo: "https://github.com/davidmosiah/wellness-cgm-mcp",
      issues: "https://github.com/davidmosiah/wellness-cgm-mcp/issues",
      twitter: "https://x.com/delx369",
      docs: "https://wellness.delx.ai/connectors/cgm",
      invite:
        "If wellness-cgm-mcp helps your agent close the metabolic-health loop, a star on the repository increases visibility for other AI builders.",
    },
    capabilities: buildCapabilities(),
    privacy: buildPrivacyAudit(),
  };
}
