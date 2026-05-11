export const SERVER_NAME = "wellness-cgm-mcp";
export const SERVER_VERSION = "0.3.0";
export const NPM_PACKAGE_NAME = "wellness-cgm-mcp";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;
export const USER_AGENT = `${NPM_PACKAGE_NAME}/${SERVER_VERSION} (https://wellness.delx.ai/connectors/cgm; contact: david@delx.ai)`;

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3012;
export const LOCAL_DIR_NAME = ".wellness-cgm";

export const DEXCOM_SANDBOX_BASE = "https://sandbox-api.dexcom.com";
export const DEXCOM_PRODUCTION_BASE = "https://api.dexcom.com";
export const DEXCOM_OAUTH_AUTHORIZE = "/v2/oauth2/login";
export const DEXCOM_OAUTH_TOKEN = "/v2/oauth2/token";

/** Time-in-range thresholds (mg/dL). ADA standard for adults with diabetes (also useful for non-DM users). */
export const TIR_LOW_MGDL = 70;
export const TIR_HIGH_MGDL = 180;
/** Tighter "metabolic health" range used for non-DM users (Levels-style). */
export const MH_LOW_MGDL = 70;
export const MH_HIGH_MGDL = 140;

export const SUPPORTED_PROVIDERS = ["dexcom", "libre"] as const;
export type CgmProvider = typeof SUPPORTED_PROVIDERS[number];
export type DexcomEnv = "sandbox" | "production";
