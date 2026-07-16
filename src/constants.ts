export const SERVER_NAME = "wellness-cgm-mcp";
export const SERVER_VERSION = "0.4.1";
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

/**
 * LibreLink Up (FreeStyle Libre — the OTC sensor) community-proxy endpoints.
 * The LibreLink Up companion API is what the official "follower" app talks to;
 * it is the only practical way to read Libre 2/3 data without a hardware NFC scan.
 *
 * Regional bases: Abbott shards LibreLink Up by region. `LIBRELINKUP_REGION`
 * (e.g. "eu", "us", "de", "fr", "au", "jp") selects the shard. Default "eu"
 * (api.libreview.io). After login the response can ask the client to redirect
 * to a region-specific host (`data.redirect` / `data.region`); the client
 * follows that automatically.
 */
export const LIBRELINKUP_DEFAULT_REGION = "eu";
export const LIBRELINKUP_PRODUCT = "llu.android";
export const LIBRELINKUP_VERSION = "4.12.0";
/** Build the regional LibreLink Up API base for a given region code. */
export function libreLinkUpBase(region: string = LIBRELINKUP_DEFAULT_REGION): string {
  const r = region.trim().toLowerCase();
  // The EU/global shard has no region prefix; every other shard is api-<region>.
  return r === "eu" || r === "" ? "https://api.libreview.io" : `https://api-${r}.libreview.io`;
}

/** Time-in-range thresholds (mg/dL). ADA standard for adults with diabetes (also useful for non-DM users). */
export const TIR_LOW_MGDL = 70;
export const TIR_HIGH_MGDL = 180;
/** Tighter "metabolic health" range used for non-DM users (Levels-style). */
export const MH_LOW_MGDL = 70;
export const MH_HIGH_MGDL = 140;

export const SUPPORTED_PROVIDERS = ["dexcom", "libre"] as const;
export type CgmProvider = typeof SUPPORTED_PROVIDERS[number];
export type DexcomEnv = "sandbox" | "production";
