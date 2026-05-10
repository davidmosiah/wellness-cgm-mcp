import { NPM_PACKAGE_NAME, SERVER_VERSION } from "../constants.js";
import { DexcomClient } from "../services/dexcom-client.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildPrivacyAudit } from "../services/privacy-audit.js";

const COMMANDS = new Set(["status", "doctor", "setup", "authorize", "exchange"]);

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
  const checks = [
    { name: "node", ok: true, detail: process.version },
    { name: "dexcom_env", ok: true, detail: c.env },
    { name: "client_id", ok: Boolean(c.clientId), detail: c.clientId ? "set" : "missing" },
    { name: "redirect_uri", ok: Boolean(c.redirectUri), detail: c.redirectUri ?? "missing" },
    {
      name: "access_token",
      ok: c.hasAuth(),
      detail: c.hasAuth() ? "present" : "missing — running in mock mode",
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
                DEXCOM_ENV: "sandbox",
                DEXCOM_CLIENT_ID: "${DEXCOM_CLIENT_ID}",
                DEXCOM_CLIENT_SECRET: "${DEXCOM_CLIENT_SECRET}",
                DEXCOM_REDIRECT_URI: "${DEXCOM_REDIRECT_URI}",
                DEXCOM_ACCESS_TOKEN: "${DEXCOM_ACCESS_TOKEN:-}",
              },
            },
          },
        },
        next_steps: [
          "Sign up at https://developer.dexcom.com and create a project (sandbox is free).",
          "Set DEXCOM_CLIENT_ID, DEXCOM_CLIENT_SECRET, DEXCOM_REDIRECT_URI in your env or MCP config.",
          "Run `wellness-cgm authorize` to print the OAuth URL — open it, grant access, copy the auth code from the redirect.",
          "Run `wellness-cgm exchange <auth_code>` to swap the code for an access_token.",
          "Set DEXCOM_ACCESS_TOKEN and restart the MCP. Until then, all tools return mock data.",
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
