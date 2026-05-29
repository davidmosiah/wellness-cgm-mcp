import { SUPPORTED_PROVIDERS, type CgmProvider } from "../constants.js";

export interface CgmCapabilities {
  providers: ReadonlyArray<CgmProvider>;
  configured: ReadonlyArray<CgmProvider>;
  metrics: ReadonlyArray<string>;
  privacy_modes: ReadonlyArray<"summary" | "structured" | "raw">;
  notes: string[];
}

export function buildCapabilities(): CgmCapabilities {
  const configured: CgmProvider[] = [];
  if (process.env.DEXCOM_ACCESS_TOKEN) configured.push("dexcom");
  // libre = FreeStyle Libre via LibreLink Up (the OTC sensor). Configured when
  // login creds (or a token) are present.
  if ((process.env.LIBRELINKUP_EMAIL && process.env.LIBRELINKUP_PASSWORD) || process.env.LIBRELINKUP_TOKEN) {
    configured.push("libre");
  }
  return {
    providers: SUPPORTED_PROVIDERS,
    configured,
    metrics: [
      "current_glucose_mgdl",
      "trend_arrow",
      "time_in_range_70_180_pct",
      "time_in_range_70_140_pct",
      "mean_glucose_mgdl",
      "median_glucose_mgdl",
      "gmi_pct",
      "cv_pct",
      "meal_response_band",
      "hypo_events_level_1",
      "hypo_events_level_2",
      "minutes_below_threshold",
      "recovery_time_minutes",
    ],
    privacy_modes: ["summary", "structured", "raw"] as const,
    notes: [
      "Dexcom ships against the official Developer API (sandbox + production).",
      "FreeStyle Libre (the OTC sensor) ships via LibreLink Up: set LIBRELINKUP_EMAIL / LIBRELINKUP_PASSWORD (and optionally LIBRELINKUP_REGION). Pick the backend with CGM_PROVIDER (dexcom | libre); it auto-detects Libre when only Libre creds are set.",
      "Both providers feed the same ADA TIR / GMI / hypo / meal-response engine — metrics are identical regardless of sensor.",
      "Without any provider credentials, all glucose tools return mock readings so agents can demo the surface.",
      "Time-in-range uses two profiles: ADA diabetic (70-180 mg/dL) AND Levels-style metabolic-health (70-140 mg/dL).",
      "GMI (estimated A1C) is computed via Bergenstal 2018 formula: 3.31 + 0.02392 × mean(mg/dL).",
      "Hypo detection (v0.3.3): cgm_hypo_events uses ADA Level 1 (<70 mg/dL) and Level 2 (<54 mg/dL) defaults; min event duration defaults to 15 minutes. Output always carries a medical disclaimer.",
    ],
  };
}
