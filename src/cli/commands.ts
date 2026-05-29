import { NPM_PACKAGE_NAME, SERVER_VERSION } from "../constants.js";
import { DexcomClient } from "../services/dexcom-client.js";
import { LibreLinkUpClient } from "../services/librelink-client.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildPrivacyAudit } from "../services/privacy-audit.js";
import {
  getOnboardingFlow,
  getProfile,
  getProfilePath,
  missingCriticalFields,
} from "../services/profile-store.js";

const COMMANDS = new Set([
  "status",
  "doctor",
  "setup",
  "authorize",
  "exchange",
  "onboarding",
  "libre-login",
]);

function printCommunityCTA(): void {
  if (process.env.WELLNESS_CGM_QUIET === "1") return;
  if (!process.stderr.isTTY) return;
  process.stderr.write(
    `\n✨ wellness-cgm-mcp v${SERVER_VERSION} — bringing CGM into the agent loop. A star ⭐ helps surface this to other AI builders.\n` +
      `   ⭐  https://github.com/davidmosiah/wellness-cgm-mcp\n` +
      `   💬  https://github.com/davidmosiah/wellness-cgm-mcp/issues\n` +
      `   🐦  https://x.com/delx369\n` +
      `   (silence with WELLNESS_CGM_QUIET=1)\n\n`,
  );
}

export function isCliCommand(args: string[]): boolean {
  const command = args[0];
  return command !== undefined && COMMANDS.has(command);
}

export async function runCliCommand(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case "status":
        return printStatus();
      case "doctor":
        return doctor();
      case "setup":
        return setup(rest);
      case "authorize":
        return authorize();
      case "exchange":
        return await exchange(rest);
      case "onboarding":
        return await onboarding(rest);
      case "libre-login":
        return await libreLogin();
      default:
        return -1;
    }
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}

function printStatus(): number {
  const c = new DexcomClient();
  console.log(
    JSON.stringify(
      {
        name: NPM_PACKAGE_NAME,
        version: SERVER_VERSION,
        env: c.env,
        client_id_configured: Boolean(c.clientId),
        access_token_configured: c.hasAuth(),
        mode: c.hasAuth() ? "live" : "mock",
      },
      null,
      2,
    ),
  );
  printCommunityCTA();
  return 0;
}

function doctor(): number {
  const c = new DexcomClient();
  const libre = new LibreLinkUpClient();
  const provider = (process.env.CGM_PROVIDER ?? "").trim().toLowerCase() || (libre.hasAuth() && !c.hasAuth() ? "libre (auto)" : "dexcom (default)");
  const checks = [
    { name: "node", ok: true, detail: process.version },
    { name: "cgm_provider", ok: true, detail: provider },
    { name: "dexcom_env", ok: true, detail: c.env },
    { name: "client_id", ok: Boolean(c.clientId), detail: c.clientId ? "set" : "missing" },
    { name: "redirect_uri", ok: Boolean(c.redirectUri), detail: c.redirectUri ?? "missing" },
    {
      name: "access_token",
      ok: c.hasAuth(),
      detail: c.hasAuth() ? "present" : "missing — running in mock mode",
    },
    {
      name: "librelinkup_credentials",
      ok: libre.hasAuth(),
      detail: libre.hasAuth() ? `present (region ${libre.region})` : "missing — FreeStyle Libre disabled",
    },
  ];
  const recommendations: string[] = [];
  if (!c.clientId || !c.redirectUri) {
    recommendations.push(
      "Sign up at https://developer.dexcom.com (sandbox is free).",
      "Create an app, register a redirect URI (suggestion: http://localhost:3012/callback).",
      "Set DEXCOM_CLIENT_ID, DEXCOM_CLIENT_SECRET, DEXCOM_REDIRECT_URI in your env or MCP config.",
    );
  } else if (!c.hasAuth()) {
    recommendations.push(
      "Run `wellness-cgm authorize` to get the OAuth URL.",
      "Open it, grant access, copy the ?code=<auth_code> from the redirect URL.",
      "Run `wellness-cgm exchange <auth_code>` to swap for an access_token + refresh_token.",
      "Set DEXCOM_ACCESS_TOKEN to the access_token. Mock mode flips to live automatically.",
    );
  } else {
    recommendations.push(
      "Live mode active. Try `wellness-cgm-mcp` over MCP and call cgm_glucose_now or cgm_daily_summary.",
    );
  }
  if (!libre.hasAuth()) {
    recommendations.push(
      "Using a FreeStyle Libre (the OTC sensor)? Set LIBRELINKUP_EMAIL / LIBRELINKUP_PASSWORD, then run `wellness-cgm libre-login` and set CGM_PROVIDER=libre.",
    );
  } else {
    recommendations.push(
      "FreeStyle Libre configured. Run `wellness-cgm libre-login` to verify and list your sensor, then set CGM_PROVIDER=libre.",
    );
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        package: NPM_PACKAGE_NAME,
        version: SERVER_VERSION,
        mode: c.hasAuth() ? "live" : "mock",
        checks,
        recommendations,
        privacy: buildPrivacyAudit(),
        capabilities: buildCapabilities(),
      },
      null,
      2,
    ),
  );
  printCommunityCTA();
  return 0;
}

function setup(args: string[]): number {
  const optional = (args[0] ?? "generic").toLowerCase();
  console.log(
    JSON.stringify(
      {
        client: optional,
        config: {
          mcpServers: {
            "wellness-cgm": {
              command: "npx",
              args: ["-y", NPM_PACKAGE_NAME],
              env: {
                CGM_PROVIDER: "${CGM_PROVIDER:-dexcom}",
                DEXCOM_ENV: "sandbox",
                DEXCOM_CLIENT_ID: "${DEXCOM_CLIENT_ID}",
                DEXCOM_CLIENT_SECRET: "${DEXCOM_CLIENT_SECRET}",
                DEXCOM_REDIRECT_URI: "${DEXCOM_REDIRECT_URI}",
                DEXCOM_ACCESS_TOKEN: "${DEXCOM_ACCESS_TOKEN:-}",
                LIBRELINKUP_EMAIL: "${LIBRELINKUP_EMAIL:-}",
                LIBRELINKUP_PASSWORD: "${LIBRELINKUP_PASSWORD:-}",
                LIBRELINKUP_REGION: "${LIBRELINKUP_REGION:-eu}",
              },
            },
          },
        },
        next_steps: [
          "Pick a provider with CGM_PROVIDER (dexcom | libre). It auto-detects libre when only LIBRELINKUP_* creds are set.",
          "Dexcom: sign up at https://developer.dexcom.com, set DEXCOM_CLIENT_ID/SECRET/REDIRECT_URI, run `wellness-cgm authorize` then `wellness-cgm exchange <code>`, and set DEXCOM_ACCESS_TOKEN.",
          "FreeStyle Libre (OTC sensor): set LIBRELINKUP_EMAIL/PASSWORD (same as the LibreLinkUp app), optionally LIBRELINKUP_REGION, then run `wellness-cgm libre-login` to verify and list your sensor.",
          "Until a provider is configured, all tools return mock data tagged mock: true.",
        ],
      },
      null,
      2,
    ),
  );
  printCommunityCTA();
  return 0;
}

function authorize(): number {
  const c = new DexcomClient();
  try {
    const url = c.buildAuthorizeUrl();
    console.log(JSON.stringify({ ok: true, env: c.env, authorize_url: url }, null, 2));
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}

async function onboarding(args: string[]): Promise<number> {
  const locale = args[0] === "pt-BR" ? "pt-BR" : "en";
  const flow = getOnboardingFlow(locale);
  const profile = await getProfile();
  const missing = missingCriticalFields(profile);
  console.log(
    JSON.stringify(
      {
        ...flow,
        current_profile: profile,
        missing_critical: missing,
      },
      null,
      2,
    ),
  );
  if (process.stderr.isTTY && process.env.WELLNESS_CGM_QUIET !== "1") {
    process.stderr.write(
      `\n## Delx Wellness shared onboarding (${locale})\n` +
        `\nThe agent will ask these 11 questions next so wellness-cgm-mcp (and the rest of\n` +
        `the wellness stack) can personalize responses — non-secret data only, stored at\n` +
        `${getProfilePath()}.\n\n` +
        flow.questions
          .map((q, i) => `${i + 1}. (${q.required ? "required" : "optional"}) ${q.prompt}`)
          .join("\n") +
        `\n\nPrivacy: ${flow.privacy_note}\n\n`,
    );
  }
  return 0;
}

async function libreLogin(): Promise<number> {
  const c = new LibreLinkUpClient();
  if (!c.hasAuth()) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          provider: "libre",
          mode: "mock",
          region: c.region,
          message:
            "Set LIBRELINKUP_EMAIL and LIBRELINKUP_PASSWORD (the same login you use in the LibreLinkUp app), then re-run `wellness-cgm libre-login`.",
          hint: "Optional: LIBRELINKUP_REGION (eu|us|de|fr|au|jp), LIBRELINKUP_PATIENT_ID (pin a sensor if you follow more than one).",
        },
        null,
        2,
      ),
    );
    return 1;
  }
  try {
    const auth = await c.login();
    const connections = await c.getConnections();
    console.log(
      JSON.stringify(
        {
          ok: true,
          provider: "libre",
          mode: "live",
          region: c.region,
          logged_in: true,
          account_id_present: Boolean(auth.accountId),
          connection_count: connections.length,
          connections,
          next: "Set CGM_PROVIDER=libre (or leave DEXCOM_ACCESS_TOKEN unset) so the glucose tools read from FreeStyle Libre.",
        },
        null,
        2,
      ),
    );
    printCommunityCTA();
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}

async function exchange(args: string[]): Promise<number> {
  const code = args[0];
  if (!code) {
    console.error("usage: wellness-cgm exchange <auth_code>");
    return 1;
  }
  const c = new DexcomClient();
  const tokens = await c.exchangeAuthCode(code);
  console.log(
    JSON.stringify(
      {
        ok: true,
        env: c.env,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope,
        next: "Set DEXCOM_ACCESS_TOKEN to the access_token above (and DEXCOM_REFRESH_TOKEN to the refresh_token).",
      },
      null,
      2,
    ),
  );
  return 0;
}
