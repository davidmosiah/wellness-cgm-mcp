import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DexcomClient } from "../services/dexcom-client.js";
import { LibreLinkUpClient } from "../services/librelink-client.js";
import { CgmSource } from "../services/cgm-source.js";
import {
  detectHypoEvents,
  mealResponse,
  mockReadings,
  summarize,
  timeInRangeWindow,
  type GlucoseReading,
} from "../services/glucose-engine.js";
import { buildAgentManifest } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildPrivacyAudit } from "../services/privacy-audit.js";
import {
  buildProfileSummary,
  getOnboardingFlow,
  getProfile,
  getProfilePath,
  missingCriticalFields,
  updateProfile,
  type WellnessProfileDocument,
} from "../services/profile-store.js";

function jsonResponse(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

async function loadReadings(source: CgmSource, hours: number): Promise<{ readings: GlucoseReading[]; mock: boolean }> {
  return source.loadReadings(hours);
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
      description:
        "Reports the active CGM provider (dexcom | libre), why it was selected, whether credentials are present, and whether the connector will return mock vs live data. For Dexcom it includes the env (sandbox/production); for FreeStyle Libre it includes the LibreLink Up region.",
      inputSchema: {},
    },
    async () => {
      const source = CgmSource.resolve();
      const status = source.status();
      // Backward-compatible Dexcom fields (kept for callers that read them directly).
      const dexcom = new DexcomClient();
      return jsonResponse({
        ...status,
        env: dexcom.env,
        client_id_configured: Boolean(dexcom.clientId),
        access_token_configured: dexcom.hasAuth(),
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
        hypo_thresholds: {
          level_1_mg_dl: 70,
          level_2_mg_dl: 54,
          min_duration_minutes: 15,
          source: "ADA Standards of Care — Level 1 is alert value, Level 2 is clinically significant.",
        },
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
      const source = CgmSource.resolve();
      const { readings, mock } = await loadReadings(source, 1);
      if (readings.length === 0) {
        return jsonResponse({ ok: false, error: "no_readings", provider: source.provider, mock });
      }
      const latest = readings[readings.length - 1];
      return jsonResponse({ ok: true, provider: source.provider, mock, latest });
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
      const source = CgmSource.resolve();
      const window = hours ?? 24;
      const { readings, mock } = await loadReadings(source, window);
      return jsonResponse({ ok: true, provider: source.provider, mock, hours: window, count: readings.length, readings });
    },
  );

  server.registerTool(
    "cgm_hypo_events",
    {
      title: "CGM hypo events",
      description:
        "v0.3.3 — Detect hypoglycemia events between `from` and `to` ISO dates. Returns an array of contiguous below-threshold runs lasting ≥ `min_duration_minutes`, each with `started_at`, `ended_at`, `duration_minutes`, `min_glucose_mg_dl`, `mean_glucose_mg_dl`, `severity` (level_1 = <70 ADA Level 1, level_2 = <54 ADA Level 2), and `recovery_time_minutes` (time to first reading ≥ threshold+10). Also returns `total_events`, `total_minutes_below`, `mean_min_glucose`, `events_per_day`, a `summary` string, and `recommendations` grounded in what was actually observed. **MEDICAL DISCLAIMER: NOT medical advice. Do not use for treatment decisions. Hypo events should be discussed with your clinician.**",
      inputSchema: {
        from: z.string().describe("ISO-8601 timestamp / date of the analysis window start."),
        to: z.string().describe("ISO-8601 timestamp / date of the analysis window end."),
        threshold_mg_dl: z
          .number()
          .min(40)
          .max(100)
          .optional()
          .describe("Hypo threshold in mg/dL. Default 70 (ADA Level 1)."),
        severe_threshold_mg_dl: z
          .number()
          .min(40)
          .max(80)
          .optional()
          .describe("Severe hypo threshold in mg/dL. Default 54 (ADA Level 2)."),
        min_duration_minutes: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe("Minimum contiguous-minutes-below-threshold to count as an event. Default 15."),
        response_format: z
          .enum(["structured", "summary"])
          .optional()
          .describe('Output shape. "structured" (default) returns the full event array. "summary" omits the per-event array, keeping totals + summary + recommendations.'),
      },
    },
    async ({ from, to, threshold_mg_dl, severe_threshold_mg_dl, min_duration_minutes, response_format }) => {
      const source = CgmSource.resolve();
      const startMs = new Date(from).getTime();
      const endMs = new Date(to).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return jsonResponse({ ok: false, error: "invalid_window", message: "from / to must be ISO-8601 timestamps" });
      }
      if (endMs <= startMs) {
        return jsonResponse({ ok: false, error: "invalid_window", message: "to must be after from" });
      }
      const { readings, mock } = await source.loadReadingsWindow(startMs, endMs);
      try {
        const result = detectHypoEvents(readings, {
          threshold_mg_dl,
          severe_threshold_mg_dl,
          min_duration_minutes,
          from,
          to,
        });
        const payload: Record<string, unknown> = {
          ok: true,
          provider: source.provider,
          mock,
          window: { from, to },
          medical_disclaimer:
            "NOT medical advice. Do not use for treatment decisions. Hypo events should be discussed with your clinician.",
          ...result,
        };
        if (response_format === "summary") {
          delete (payload as Record<string, unknown>).events;
        }
        return jsonResponse(payload);
      } catch (err) {
        return jsonResponse({ ok: false, error: "invalid_window", message: (err as Error).message });
      }
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
      const source = CgmSource.resolve();
      const window = hours ?? 24;
      const { readings, mock } = await loadReadings(source, window);
      const summary = summarize(readings);
      return jsonResponse({ ok: true, provider: source.provider, mock, window_hours: window, summary });
    },
  );

  server.registerTool(
    "cgm_time_in_range",
    {
      title: "CGM time in range (windowed)",
      description:
        "Compute Time in Range (TIR), Time Below Range, and Time Above Range over a specific time window with a customizable target range. Use this for mealtime TIR (e.g. 7am-10am breakfast window), overnight TIR (e.g. 23:00-07:00), or specific date-range comparisons. Returns total_readings, readings_in_window, mean_glucose, median_glucose, and GMI (Glucose Management Indicator, estimated A1C per ADA / Bergenstal 2018: GMI% = 3.31 + 0.02392 × mean_mg_dL). Supports a `time_window` preset (\"wake\" = 06:00-22:00, \"sleep\" = 22:00-06:00, \"all\") OR explicit `start_hour` / `end_hour` (0-24, UTC) for recurring hour-of-day filtering. Defaults: 24h load, ADA 70-180 mg/dL, time_window=all. Pulls from cgm_glucose_window data; falls back to mock in unauth mode.",
      inputSchema: {
        start_time: z
          .string()
          .optional()
          .describe("ISO-8601 timestamp of window start. Defaults to the earliest reading available."),
        end_time: z
          .string()
          .optional()
          .describe("ISO-8601 timestamp of window end. Defaults to the latest reading available."),
        target_low: z
          .number()
          .min(40)
          .max(200)
          .optional()
          .describe("Low end of target range in mg/dL. Default 70 (ADA)."),
        target_high: z
          .number()
          .min(80)
          .max(400)
          .optional()
          .describe("High end of target range in mg/dL. Default 180 (ADA)."),
        hours: z
          .number()
          .int()
          .min(1)
          .max(72)
          .optional()
          .describe("How many hours of data to load before filtering. Default 24."),
        time_window: z
          .enum(["all", "wake", "sleep"])
          .optional()
          .describe(
            'Hour-of-day preset. "wake" = 06:00-22:00, "sleep" = 22:00-06:00 (wraps midnight), "all" = no hour filter. Default "all". Overridden by explicit start_hour/end_hour.',
          ),
        start_hour: z
          .number()
          .min(0)
          .max(24)
          .optional()
          .describe("Explicit recurring hour-of-day start (0-24, UTC). Use with end_hour to override time_window preset."),
        end_hour: z
          .number()
          .min(0)
          .max(24)
          .optional()
          .describe("Explicit recurring hour-of-day end (0-24, UTC). May be < start_hour to wrap midnight (e.g. 22→6)."),
      },
    },
    async ({ start_time, end_time, target_low, target_high, hours, time_window, start_hour, end_hour }) => {
      const source = CgmSource.resolve();
      const loadHours = hours ?? 24;
      const { readings, mock } = await loadReadings(source, loadHours);
      try {
        const tir = timeInRangeWindow(readings, {
          start_time,
          end_time,
          low: target_low,
          high: target_high,
          time_window,
          start_hour,
          end_hour,
        });
        const notes: string[] = [];
        if (tir.readings_in_window === 0) {
          notes.push(
            "No readings fell within the requested window. Widen start_time / end_time, load more hours, or relax the time_window/start_hour/end_hour filter.",
          );
        } else if (tir.readings_in_window < 12) {
          notes.push(
            `Small sample (${tir.readings_in_window} readings). TIR may not be statistically meaningful below ~12 EGVs.`,
          );
        }
        return jsonResponse({
          ok: true,
          provider: source.provider,
          mock,
          loaded_window_hours: loadHours,
          requested_window: { start_time, end_time },
          requested_time_window: time_window ?? (start_hour !== undefined && end_hour !== undefined ? "custom" : "all"),
          target_range: { low: target_low ?? 70, high: target_high ?? 180 },
          tir,
          notes,
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: "invalid_window", message: (err as Error).message });
      }
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
      const source = CgmSource.resolve();
      const total = window_hours ?? 4;
      const { readings, mock } = await loadReadings(source, total);
      const response = mealResponse(readings, meal_time);
      if (!response) {
        return jsonResponse({ ok: false, error: "insufficient_readings", provider: source.provider, mock, meal_time });
      }
      return jsonResponse({ ok: true, provider: source.provider, mock, response });
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
    "cgm_profile_get",
    {
      title: "CGM profile get",
      description:
        "Returns the shared Delx Wellness profile (~/.delx-wellness/profile.json). Read-only. Surfaces diabetes status / non-DM context so wellness-cgm-mcp can pick the right time-in-range profile (70-180 ADA vs 70-140 metabolic-health).",
      inputSchema: {},
    },
    async () => {
      const profile = await getProfile();
      return jsonResponse({
        ok: true,
        profile,
        summary: buildProfileSummary(profile),
        missing_critical: missingCriticalFields(profile),
        storage_path: getProfilePath(),
      });
    },
  );

  server.registerTool(
    "cgm_profile_update",
    {
      title: "CGM profile update",
      description:
        "Persist a partial patch to the shared Delx Wellness profile. Requires explicit_user_intent: true. Rejects any field containing oauth/token/secret/password/cookie/refresh/api_key/session — the profile is for non-secret wellness context only.",
      inputSchema: {
        patch: z
          .record(z.string(), z.unknown())
          .describe(
            "Partial WellnessProfileDocument patch. Top-level keys: profile, goals, devices, training, nutrition, preferences, safety, notes.",
          ),
        explicit_user_intent: z
          .boolean()
          .optional()
          .describe("Must be true. Pass only after the user explicitly asked to save/update profile data."),
      },
    },
    async ({ patch, explicit_user_intent }) => {
      if (explicit_user_intent !== true) {
        return jsonResponse({
          ok: false,
          error: "USER_ACTION_REQUIRED",
          message:
            "explicit_user_intent must be true to update the shared wellness profile. Confirm with the user, then retry.",
        });
      }
      try {
        const profile = await updateProfile(patch as Partial<WellnessProfileDocument>);
        return jsonResponse({
          ok: true,
          profile,
          summary: buildProfileSummary(profile),
          storage_path: getProfilePath(),
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: "update_failed", message: (err as Error).message });
      }
    },
  );

  server.registerTool(
    "cgm_onboarding",
    {
      title: "CGM onboarding",
      description:
        "Returns the 11-question onboarding flow for the shared Delx Wellness profile. Read-only. The agent should ask these questions next so wellness-cgm-mcp (and the rest of the wellness stack) can personalize responses — non-secret data only, stored at ~/.delx-wellness/profile.json.",
      inputSchema: {
        locale: z.enum(["en", "pt-BR"]).optional().describe("Onboarding locale. Defaults to en."),
      },
    },
    async ({ locale }) => {
      const flow = getOnboardingFlow(locale ?? "en");
      const profile = await getProfile();
      return jsonResponse({
        ok: true,
        ...flow,
        current_profile: profile,
        missing_critical: missingCriticalFields(profile),
        cross_connector_hint:
          "wellness-cgm-mcp reads profile.safety.medical_constraints to decide which time-in-range profile to surface — diabetic (70-180 ADA) vs non-DM metabolic-health (70-140 Levels-style).",
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
          `In live mode, set DEXCOM_ACCESS_TOKEN (Dexcom) or LIBRELINKUP_EMAIL/PASSWORD (FreeStyle Libre) and the same tools return real EGVs.`,
          `Sample summary: mean=${summary.mean_mgdl} mg/dL, GMI=${summary.gmi_pct}% (estimated A1C), TIR(70-180)=${summary.diabetic_tir.in_range_pct}%.`,
        ],
      });
    },
  );

  // --- FreeStyle Libre (via LibreLink Up) ---------------------------------

  server.registerTool(
    "cgm_libre_status",
    {
      title: "CGM Libre status",
      description:
        "Reports FreeStyle Libre (LibreLink Up) configuration: region, whether LIBRELINKUP_EMAIL/PASSWORD (or a token) are set, whether a patient id is pinned, and whether reads will be live or mock. Use this to confirm the Libre path is wired before calling glucose tools with CGM_PROVIDER=libre.",
      inputSchema: {},
    },
    async () => {
      const c = new LibreLinkUpClient();
      const live = c.hasAuth();
      return jsonResponse({
        ok: true,
        provider: "libre",
        region: c.region,
        credentials_configured: live,
        patient_id_pinned: Boolean(c.fixedPatientId),
        mode: live ? "live" : "mock",
        env_vars: ["LIBRELINKUP_EMAIL", "LIBRELINKUP_PASSWORD", "LIBRELINKUP_REGION", "LIBRELINKUP_PATIENT_ID"],
        notes: live
          ? [
              "Credentials present. Call cgm_libre_login to verify them and list your connected sensor, then set CGM_PROVIDER=libre (or unset DEXCOM_ACCESS_TOKEN) to route glucose tools through Libre.",
            ]
          : [
              "Mock mode — set LIBRELINKUP_EMAIL and LIBRELINKUP_PASSWORD (the same login you use in the LibreLinkUp app) to enable live FreeStyle Libre reads.",
              "Default region is 'eu' (api.libreview.io). Set LIBRELINKUP_REGION (e.g. 'us', 'de', 'fr', 'au', 'jp') if your account lives on another shard — login also auto-follows a regional redirect.",
            ],
      });
    },
  );

  server.registerTool(
    "cgm_libre_login",
    {
      title: "CGM Libre login",
      description:
        "Authenticate against LibreLink Up using LIBRELINKUP_EMAIL / LIBRELINKUP_PASSWORD and list the sensors (connections) this account follows. Confirms the FreeStyle Libre path works end-to-end before reading glucose. Never returns the auth token. When credentials are missing it returns mock=true with a synthetic connection so the surface can be demoed without an Abbott account.",
      inputSchema: {},
    },
    async () => {
      const c = new LibreLinkUpClient();
      if (!c.hasAuth()) {
        const sample = mockReadings(1);
        return jsonResponse({
          ok: true,
          provider: "libre",
          mock: true,
          region: c.region,
          connections: [
            {
              patientId: "mock-patient",
              firstName: "Mock",
              lastName: "Sensor",
              latest: sample[sample.length - 1],
            },
          ],
          notes: [
            "Mock mode — set LIBRELINKUP_EMAIL and LIBRELINKUP_PASSWORD to log in for real.",
            "In live mode this lists the patientId(s) you follow; pin one with LIBRELINKUP_PATIENT_ID if you follow more than one.",
          ],
        });
      }
      try {
        const auth = await c.login();
        const connections = await c.getConnections();
        return jsonResponse({
          ok: true,
          provider: "libre",
          mock: false,
          region: c.region,
          logged_in: true,
          account_id_present: Boolean(auth.accountId),
          connection_count: connections.length,
          connections,
          notes:
            connections.length === 0
              ? ["Logged in, but no connections found. In the LibreLinkUp app, accept the sharing invite from your LibreLink app."]
              : [
                  `Found ${connections.length} connection(s). Set CGM_PROVIDER=libre (or unset DEXCOM_ACCESS_TOKEN) so glucose tools read from Libre.`,
                ],
        });
      } catch (err) {
        return jsonResponse({
          ok: false,
          provider: "libre",
          error: "libre_login_failed",
          message: (err as Error).message,
          hint: "Check LIBRELINKUP_EMAIL / LIBRELINKUP_PASSWORD and LIBRELINKUP_REGION. The credentials are the same as the LibreLinkUp (follower) app.",
        });
      }
    },
  );
}
