/**
 * Dexcom Developer API client (sandbox + production).
 * Docs: https://developer.dexcom.com/docs/dexcomv2/overview
 *
 * v0.1 ships:
 * - OAuth authorize URL builder
 * - Token exchange (auth_code → access_token)
 * - EGV (estimated glucose value) read
 * - Mock mode when no token is present
 */
import {
  DEXCOM_OAUTH_AUTHORIZE,
  DEXCOM_OAUTH_TOKEN,
  DEXCOM_PRODUCTION_BASE,
  DEXCOM_SANDBOX_BASE,
  USER_AGENT,
  type DexcomEnv,
} from "../constants.js";
import type { GlucoseReading } from "./glucose-engine.js";

export interface DexcomTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string;
}

export interface DexcomClientOptions {
  env?: DexcomEnv;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  fetchImpl?: typeof fetch;
  accessToken?: string;
}

export class DexcomClient {
  readonly env: DexcomEnv;
  readonly baseUrl: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUri?: string;
  readonly accessToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: DexcomClientOptions = {}) {
    this.env = opts.env ?? (process.env.DEXCOM_ENV as DexcomEnv) ?? "sandbox";
    this.baseUrl = this.env === "production" ? DEXCOM_PRODUCTION_BASE : DEXCOM_SANDBOX_BASE;
    this.clientId = opts.clientId ?? process.env.DEXCOM_CLIENT_ID;
    this.clientSecret = opts.clientSecret ?? process.env.DEXCOM_CLIENT_SECRET;
    this.redirectUri = opts.redirectUri ?? process.env.DEXCOM_REDIRECT_URI;
    this.accessToken = opts.accessToken ?? process.env.DEXCOM_ACCESS_TOKEN;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  hasAuth(): boolean {
    return Boolean(this.accessToken);
  }

  buildAuthorizeUrl(state: string = "delx", scope: string = "offline_access"): string {
    if (!this.clientId || !this.redirectUri) {
      throw new Error("DEXCOM_CLIENT_ID and DEXCOM_REDIRECT_URI required to build the authorize URL");
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope,
      state,
    });
    return `${this.baseUrl}${DEXCOM_OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  async exchangeAuthCode(code: string): Promise<DexcomTokens> {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error("DEXCOM_CLIENT_ID, DEXCOM_CLIENT_SECRET, DEXCOM_REDIRECT_URI all required");
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
    });
    const res = await this.fetchImpl(`${this.baseUrl}${DEXCOM_OAUTH_TOKEN}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Dexcom token exchange failed: HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    return {
      access_token: String(json.access_token ?? ""),
      refresh_token: String(json.refresh_token ?? ""),
      expires_at: new Date(Date.now() + Number(json.expires_in ?? 0) * 1000).toISOString(),
      scope: String(json.scope ?? ""),
    };
  }

  async getEgvs(startDate: string, endDate: string): Promise<GlucoseReading[]> {
    if (!this.accessToken) throw new Error("DEXCOM_ACCESS_TOKEN required");
    const range = normalizeDexcomUtcRange(startDate, endDate);
    const url = `${this.baseUrl}/v3/users/self/egvs?startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}`;
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Dexcom egvs failed: HTTP ${res.status}`);
    const json = (await res.json()) as { records?: Array<Record<string, unknown>> };
    const records = json.records ?? [];
    return records
      .map((rec) => ({
        timestamp: String(rec.systemTime ?? rec.displayTime ?? ""),
        mgdl: Number(rec.value ?? rec.mgdl ?? 0),
        trend: typeof rec.trend === "string" ? rec.trend : undefined,
      }))
      .filter((r) => r.timestamp && Number.isFinite(r.mgdl) && r.mgdl > 0);
  }
}

function normalizeDexcomUtcRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const parse = (value: string, field: string): Date => {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      throw new Error(`${field} must be a valid ISO 8601 date-time`);
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new Error(`${field} must be a valid ISO 8601 date-time`);
    }
    return date;
  };
  const start = parse(startDate, "startDate");
  const end = parse(endDate, "endDate");
  if (start.getTime() >= end.getTime()) {
    throw new Error("startDate must be before endDate");
  }
  if (end.getTime() - start.getTime() > 30 * 24 * 60 * 60 * 1000) {
    throw new Error("Dexcom query windows must be 30 days or less");
  }
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}
