import { z } from "zod";

/** Per-call privacy override accepted on read tools (scorecard + agent surface). */
export const PrivacyModeSchema = z
  .enum(["summary", "structured", "raw"])
  .optional()
  .describe(
    "Optional privacy mode: summary | structured | raw. summary omits device/patient identifiers when present; structured/raw return full payload.",
  );
