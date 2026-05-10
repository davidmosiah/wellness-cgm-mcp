import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DexcomClient } from "../services/dexcom-client.js";
import {
  mealResponse,
  mockReadings,
  summarize,
  type GlucoseReading,
} from "../services/glucose-engine.js";
import { buildAgentManifest } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildPrivacyAudit } from "../services/privacy-audit.js";

function jsonResponse(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

async function loadReadings(client: DexcomClient, hours: number): Promise<{ readings: GlucoseReading[]; mock: boolean }> {
  if (!client.hasAuth()) {
    return { readings: mockReadings(hours), mock: true };
  }
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const readings = await client.getEgvs(start.toISOString(), end.toISOString());
  return { readings, mock: false };
}

export function registerCgmTools(server: McpServer): void {
  server.registerTool(
    "cgm_agent_manifest",
    {
      title: "CGM agent manifest",
      description:
        "Returns the wellness-cgm-mcp agent manifest: tool list, supported clients, env vars, recommended first calls, capabilities, privacy posture, and community links.",
      inputSchema: {
        client: z
          .enum(["claude", "codex", "cursor", "windsurf", "hermes", "openclaw", "generic"])
          .optional(),
      },
    },
    async ({ client }) => jsonResponse(buildAgentManifest(client ?? "generic")),
  );

  server.registerTool(
    "cgm_capabilities",
    {
      title: "CGM capabilities",
      description: "Lists supported providers, configured providers (via env vars), available metrics, and privacy modes.",
      inputSchema: {},
    },
    async () => jsonResponse(buildCapabilities()),
  );

  server.registerTool(
    "cgm_connection_status",
    {
      title: "CGM connection status",
      description: "Reports Dexcom env (sandbox/production), whether credentials are present, and whether the connector will return mock vs live data.",
      inputSchema: {},
    },
    async () => {
      const c = new DexcomClient();
      return jsonResponse({
        ok: true,
        env: c.env,
        client_id_configured: Boolean(c.clientId),
        access_token_configured: c.hasAuth(),
        mode: c.hasAuth() ? "live" : "mock",
        notes: c.hasAuth()
          ? ["Live mode — calls go to the Dexcom API."]
          : ["Mock mode — set DEXCOM_ACCESS_TOKEN to enable live reads. Run 'wellness-cgm authorize' to start the OAuth flow."],
      });
    },
  );

  server.registerTool(
    "cgm_privacy_audit",
    {
      title: "CGM privacy audit",
      description: "Returns what wellness-cgm-mcp stores locally, what is sent to Dexcom, what is never logged, and agent rules.",
      inputSchema: {},
    },
    async () => jsonResponse(buildPrivacyAudit()),
  );

  server.registerTool(
    "cgm_data_inventory",
    {
      title: "CGM data inventory",
      description: "Returns the metric catalog plus thresholds (TIR ranges, GMI formula reference).",
      inputSchema: {},
    },
    async () =>
      jsonResponse({
        metrics: [
          { id: "mgdl", unit: "mg/dL", source: "Dexcom EGV (5-minute interval)" },
          { id: "trend", unit: "arrow", source: "Dexcom" },
          { id: "tir_diabetic", unit: "%", source: "computed from EGVs (70-180 ADA)" },
          { id: "tir_metabolic_health", unit: "%", source: "computed from EGVs (70-140 Levels-style)" },
          { id: "gmi", unit: "% A1C estimate", source: "Bergenstal 2018: 3.31 + 0.02392 × mean(mg/dL)" },
          { id: "cv", unit: "%", source: "stdev / mean × 100" },
        ],
        meal_response_bands: [
          { band: "excellent", peak_delta_mgdl: "< 30" },
          { band: "good", peak_delta_mgdl: "30-49" },
          { band: "moderate", peak_delta_mgdl: "50-79" },
          { band: "poor", peak_delta_mgdl: "≥ 80" },
        ],
      }),
  );

  server.registerTool(
    "cgm_glucose_now",
    {
      title: "CGM glucose now",
      description: "Returns the most recent EGV (estimated glucose value) plus trend arrow if available.",
      inputSchema: {},
    },
    async () => {
      const client = new DexcomClient();
      const { readings, mock } = await loadReadings(client, 1);
      if (readings.length === 0) {
        return jsonResponse({ ok: false, error: "no_readings", mock });
      }
      const latest = readings[readings.length - 1];
      return jsonResponse({ ok: true, mock, latest });
    },
  );

  server.registerTool(
    "cgm_glucose_window",
    {
      title: "CGM glucose window",
      description: "Returns all EGVs over the last N hours (default 24).",
      inputSchema: {
        hours: z.number().int().min(1).max(72).optional(),
      },
    },
    async ({ hours }) => {
      const client = new DexcomClient();
      const window = hours ?? 24;
      const { readings, mock } = await loadReadings(client, window);
      return jsonResponse({ ok: true, mock, hours: window, count: readings.length, readings });
    },
  );

  server.registerTool(
    "cgm_daily_summary",
    {
      title: "CGM daily summary",
      description:
        "Returns daily glucose stats: mean, median, min/max, stdev, GMI (estimated A1C), CV, time-in-range (diabetic 70-180 + metabolic-health 70-140).",
      inputSchema: {
        hours: z.number().int().min(1).max(72).optional().describe("Window size; default 24."),
      },
    },
    async ({ hours }) => {
      const client = new DexcomClient();
      const window = hours ?? 24;
      const { readings, mock } = await loadReadings(client, window);
      const summary = summarize(readings);
      return jsonResponse({ ok: true, mock, window_hours: window, summary });
    },
  );

  server.registerTool(
    "cgm_meal_response",
    {
      title: "CGM meal response",
      description:
        "Compute glucose response to a meal: baseline → peak → return-to-baseline. Returns peak delta, peak time (min after meal), and a band (excellent/good/moderate/poor).",
      inputSchema: {
        meal_time: z.string().describe("ISO-8601 timestamp of when the meal was eaten (e.g. '2026-05-10T13:15:00Z')."),
        window_hours: z.number().int().min(2).max(6).optional().describe("Hours of CGM data to load before+after; default 4."),
      },
    },
    async ({ meal_time, window_hours }) => {
      const client = new DexcomClient();
      const total = window_hours ?? 4;
      const { readings, mock } = await loadReadings(client, total);
      const response = mealResponse(readings, meal_time);
      if (!response) {
        return jsonResponse({ ok: false, error: "insufficient_readings", mock, meal_time });
      }
      return jsonResponse({ ok: true, mock, response });
    },
  );

  server.registerTool(
    "cgm_authorize_url",
    {
      title: "CGM authorize URL",
      description:
        "Builds the Dexcom OAuth authorize URL. The user opens it, grants access, and Dexcom redirects to your registered DEXCOM_REDIRECT_URI with an auth code. If credentials are missing, returns a hint with the exact env vars needed.",
      inputSchema: {
        state: z.string().optional(),
      },
    },
    async ({ state }) => {
      const client = new DexcomClient();
      try {
        const url = client.buildAuthorizeUrl(state ?? "delx");
        return jsonResponse({
          ok: true,
          env: client.env,
          authorize_url: url,
          next: [
            "Open the authorize_url in a browser.",
            "Grant access to the Dexcom account.",
            "Dexcom redirects to your DEXCOM_REDIRECT_URI with ?code=<auth_code>.",
            "Copy that auth_code and run `wellness-cgm exchange <auth_code>` to swap it for an access_token.",
          ],
        });
      } catch (err) {
        return jsonResponse({
          ok: false,
          error: (err as Error).message,
          hint: "Set DEXCOM_CLIENT_ID, DEXCOM_CLIENT_SECRET, DEXCOM_REDIRECT_URI in your env. Sign up at https://developer.dexcom.com (sandbox is free).",
          recommended_redirect: "http://localhost:3012/callback (any URL works as long as you register it on developer.dexcom.com)",
        });
      }
    },
  );

  server.registerTool(
    "cgm_quickstart",
    {
      title: "CGM quickstart",
      description:
        "Returns a personalized 3-step walkthrough for getting wellness-cgm-mcp from mock mode → live mode (Dexcom). Call this first when the user asks 'how do I connect my CGM?'",
      inputSchema: {
        client: z
          .enum(["claude", "codex", "cursor", "windsurf", "hermes", "openclaw", "generic"])
          .optional(),
      },
    },
    async ({ client }) => {
      const c = new DexcomClient();
      const hasClientId = Boolean(c.clientId);
      const hasToken = c.hasAuth();
      return jsonResponse({
        ok: true,
        client: client ?? "generic",
        current_mode: hasToken ? "live" : "mock",
        env: c.env,
        steps: [
          {
            step: 1,
            title: hasClientId ? "(done) Dexcom Developer credentials configured" : "Sign up at https://developer.dexcom.com",
            action: hasClientId
              ? "DEXCOM_CLIENT_ID and DEXCOM_REDIRECT_URI are set."
              : "Create a free account → create an app → register a redirect URI (use http://localhost:3012/callback for local dev). Then set DEXCOM_CLIENT_ID, DEXCOM_CLIENT_SECRET, DEXCOM_REDIRECT_URI in your env.",
            done: hasClientId,
          },
          {
            step: 2,
            title: hasToken ? "(done) Access token already set — live mode is on" : "Run the OAuth dance",
            action: hasToken
              ? "DEXCOM_ACCESS_TOKEN is configured. All glucose tools return live data."
              : "Call cgm_authorize_url to get the OAuth URL. Open it, grant access, copy the ?code=<auth_code> from the redirect. Then run `wellness-cgm exchange <auth_code>` to swap for tokens. Set DEXCOM_ACCESS_TOKEN to the access_token printed.",
            done: hasToken,
          },
          {
            step: 3,
            title: "Verify with the agent",
            action: "Call cgm_glucose_now or cgm_daily_summary. Without a real token, every tool clearly returns mock=true so you can prototype.",
            example: "cgm_glucose_now() → { ok: true, mock: " + (hasToken ? "false" : "true") + ", latest: { mgdl: ..., timestamp: ... } }",
            done: false,
          },
        ],
        cross_connector_hints: [
          "Pair cgm_meal_response with wellness-nourish meal logs to compute spike + band per meal.",
          "Cross-reference glucose patterns with WHOOP recovery for metabolic-stress signals.",
          "wellness-cycle-coach late-luteal phase + glucose spikes = good context for PMS-related insulin sensitivity changes.",
        ],
      });
    },
  );

  server.registerTool(
    "cgm_demo",
    {
      title: "CGM demo",
      description:
        "Returns realistic example payloads of cgm_glucose_now, cgm_daily_summary, and cgm_meal_response. Use this to help users see what the connector will return before configuring Dexcom.",
      inputSchema: {},
    },
    async () => {
      const sampleReadings = mockReadings(24, 95);
      const summary = summarize(sampleReadings);
      const mealResp = mealResponse(sampleReadings, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
      const latest = sampleReadings[sampleReadings.length - 1];
      return jsonResponse({
        ok: true,
        is_demo: true,
        sample: {
          cgm_glucose_now: { ok: true, mock: true, latest },
          cgm_daily_summary: { ok: true, mock: true, window_hours: 24, summary },
          cgm_meal_response: { ok: true, mock: true, response: mealResp },
        },
        notes: [
          "All sample data is synthetic (mock=true).",
          `In live mode, set DEXCOM_ACCESS_TOKEN and the same tools return real Dexcom EGVs.`,
          `Sample summary: mean=${summary.mean_mgdl} mg/dL, GMI=${summary.gmi_pct}% (estimated A1C), TIR(70-180)=${summary.diabetic_tir.in_range_pct}%.`,
        ],
      });
    },
  );
}
