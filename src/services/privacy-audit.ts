import { LOCAL_DIR_NAME } from "../constants.js";

export interface CgmPrivacyAudit {
  local_storage: string;
  outbound_destinations: string[];
  what_is_logged: string[];
  what_is_never_logged: string[];
  agent_rules: string[];
}

export function buildPrivacyAudit(): CgmPrivacyAudit {
  return {
    local_storage: `~/${LOCAL_DIR_NAME}`,
    outbound_destinations: [
      "sandbox-api.dexcom.com (Dexcom sandbox testing)",
      "api.dexcom.com (Dexcom production user data)",
      "api.libreview.io / api-<region>.libreview.io (FreeStyle Libre via LibreLink Up, when CGM_PROVIDER=libre)",
    ],
    what_is_logged: [
      "Last fetched glucose readings cached locally to support offline replies and reduce API rate-limit pressure.",
      "Token expiry timestamp (so the CLI knows when to refresh).",
    ],
    what_is_never_logged: [
      "Dexcom OAuth client secret in plaintext logs.",
      "Refresh tokens in tool output.",
      "User identifiers — only 'self' scope is used.",
    ],
    agent_rules: [
      "CGM data is medical-record sensitive. Treat it accordingly.",
      "If a single reading shows < 70 or > 250 mg/dL, surface it but do NOT recommend insulin/medication adjustments.",
      "Cross with wellness-nourish meal logs to compute meal-glucose response band.",
      "If user has diabetes (T1/T2), defer insulin dosing decisions to clinician + their CGM app.",
      "Never claim diagnostic accuracy — these are observed readings, not medical advice.",
    ],
  };
}
