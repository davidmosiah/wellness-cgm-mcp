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
  // libre = LibreLink Up (community proxy); not in v0.1
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
    ],
    privacy_modes: ["summary", "structured", "raw"] as const,
    notes: [
      "Dexcom v0.1 ships against the official Developer API (sandbox + production).",
      "FreeStyle Libre via LibreLink Up community proxy is roadmapped for v0.2.",
      "Without a Dexcom token, all glucose tools return mock readings so agents can demo the surface.",
      "Time-in-range uses two profiles: ADA diabetic (70-180 mg/dL) AND Levels-style metabolic-health (70-140 mg/dL).",
      "GMI (estimated A1C) is computed via Bergenstal 2018 formula: 3.31 + 0.02392 × mean(mg/dL).",
    ],
  };
}
