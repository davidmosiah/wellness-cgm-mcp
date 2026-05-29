/**
 * LibreLink Up client — FreeStyle Libre (the OTC sensor) support.
 *
 * Reads glucose from Abbott's LibreLink Up "follower" companion API — the same
 * API the official LibreLinkUp app talks to. This is the only practical way to
 * read Libre 2 / Libre 3 data programmatically without a hardware NFC scan, and
 * it works with the OTC consumer sensor (no developer-program signup required),
 * which is why it is the biggest lever for "real users with real data".
 *
 * Flow:
 *   1. login(email, password) → JWT auth ticket (+ account-id)
 *   2. getConnections() → list of patients you follow (your own sensor is one)
 *   3. getGraph(patientId) / getCurrent(patientId) → glucose readings (mg/dL)
 *
 * Readings are returned as the same {@link GlucoseReading} shape Dexcom uses,
 * so the entire ADA TIR / GMI / hypo / meal-response engine works unchanged.
 *
 * Auth notes:
 *  - The API requires `product: llu.android` + `version` headers on every call.
 *  - After login the API returns an `accountId`; subsequent calls must send a
 *    SHA-256 hex digest of that accountId in the `account-id` header (added in
 *    the 4.x API). We compute it with the Node `crypto` module.
 *  - Login can return a redirect to a region-specific host; we follow it once.
 *
 * Mock mode: when no LIBRELINKUP_EMAIL / LIBRELINKUP_PASSWORD is configured the
 * tool layer falls back to synthetic readings (same pattern as Dexcom), so the
 * Libre surface can be demoed end-to-end without an Abbott account.
 */
import { createHash } from "node:crypto";
import {
  LIBRELINKUP_DEFAULT_REGION,
  LIBRELINKUP_PRODUCT,
  LIBRELINKUP_VERSION,
  USER_AGENT,
  libreLinkUpBase,
} from "../constants.js";
import type { GlucoseReading } from "./glucose-engine.js";

export interface LibreLinkUpAuth {
  /** JWT bearer token issued by /llu/auth/login. */
  token: string;
  /** Numeric account id; its SHA-256 hex digest goes in the `account-id` header. */
  accountId: string;
  /** Unix-epoch (seconds) expiry of the JWT, when supplied by the API. */
  expires?: number;
}

export interface LibreLinkUpConnection {
  /** patientId — pass to getGraph / getCurrent. */
  patientId: string;
  firstName?: string;
  lastName?: string;
  /** Sensor serial / device label, when present. */
  sensor?: string;
  /** Latest glucose measurement embedded in the connection record, if any. */
  latest?: GlucoseReading;
}

export interface LibreLinkUpClientOptions {
  email?: string;
  password?: string;
  region?: string;
  token?: string;
  accountId?: string;
  patientId?: string;
  fetchImpl?: typeof fetch;
}

/** LibreLink Up encodes trend as 1..5 (FallingQuickly..RisingQuickly). Map to Dexcom-style arrows. */
const TREND_ARROWS = ["", "singleDown", "fortyFiveDown", "flat", "fortyFiveUp", "singleUp"] as const;

function mapTrend(raw: unknown): string | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n >= TREND_ARROWS.length) return undefined;
  return TREND_ARROWS[n];
}

/**
 * LibreLink Up timestamps look like "10/27/2023 8:55:00 AM" (US locale,
 * sensor-local time, no timezone). Parse to an ISO-8601 string. Falls back to
 * the raw value if it can't be parsed so callers always see *something*.
 */
function parseLibreTimestamp(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  // US "MM/DD/YYYY h:mm:ss AM/PM" — normalise to a form Date.parse accepts.
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (m) {
    let hour = Number(m[4]);
    const ampm = (m[7] ?? "").toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const d = new Date(
      Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6])),
    );
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }
  return raw;
}

function toReading(item: Record<string, unknown>): GlucoseReading | null {
  if (!item) return null;
  const mgdl = Number(item.ValueInMgPerDl ?? item.Value ?? item.value ?? 0);
  const ts = parseLibreTimestamp(item.Timestamp ?? item.FactoryTimestamp ?? item.timestamp);
  if (!ts || !Number.isFinite(mgdl) || mgdl <= 0) return null;
  return { timestamp: ts, mgdl, trend: mapTrend(item.TrendArrow ?? item.trend) };
}

export class LibreLinkUpClient {
  readonly email?: string;
  readonly password?: string;
  /** Active LibreLink Up region shard. May be updated once if login redirects. */
  region: string;
  readonly fixedPatientId?: string;
  private token?: string;
  private accountId?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: LibreLinkUpClientOptions = {}) {
    this.email = opts.email ?? process.env.LIBRELINKUP_EMAIL;
    this.password = opts.password ?? process.env.LIBRELINKUP_PASSWORD;
    this.region = opts.region ?? process.env.LIBRELINKUP_REGION ?? LIBRELINKUP_DEFAULT_REGION;
    this.fixedPatientId = opts.patientId ?? process.env.LIBRELINKUP_PATIENT_ID;
    this.token = opts.token ?? process.env.LIBRELINKUP_TOKEN;
    this.accountId = opts.accountId ?? process.env.LIBRELINKUP_ACCOUNT_ID;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** True when we have enough to authenticate: either email+password or an existing token. */
  hasAuth(): boolean {
    return Boolean((this.email && this.password) || this.token);
  }

  /** True once we hold a live bearer token. */
  isLoggedIn(): boolean {
    return Boolean(this.token);
  }

  private base(region?: string): string {
    return libreLinkUpBase(region ?? this.region);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      product: LIBRELINKUP_PRODUCT,
      version: LIBRELINKUP_VERSION,
      "User-Agent": USER_AGENT,
      ...extra,
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    // The 4.x API requires the SHA-256 hex of the account id once known.
    if (this.accountId) h["account-id"] = createHash("sha256").update(this.accountId).digest("hex");
    return h;
  }

  /**
   * Authenticate against LibreLink Up. Stores the bearer token + account id on
   * the client and returns them. Follows one regional redirect if the API asks.
   */
  async login(): Promise<LibreLinkUpAuth> {
    if (this.token && this.accountId) {
      return { token: this.token, accountId: this.accountId };
    }
    if (!this.email || !this.password) {
      throw new Error("LIBRELINKUP_EMAIL and LIBRELINKUP_PASSWORD required to log in to LibreLink Up");
    }
    let region = this.region;
    // Up to one redirect hop (login can shard you to a regional host).
    for (let hop = 0; hop < 2; hop++) {
      const res = await this.fetchImpl(`${this.base(region)}/llu/auth/login`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ email: this.email, password: this.password }),
      });
      if (!res.ok) throw new Error(`LibreLink Up login failed: HTTP ${res.status}`);
      const json = (await res.json()) as { status?: number; data?: Record<string, unknown> };
      const data = json.data ?? {};
      // status 2 + data.redirect => retry on the region-specific host.
      const redirectRegion = (data.region as string | undefined) ?? undefined;
      if (data.redirect === true && redirectRegion && redirectRegion !== region) {
        region = redirectRegion;
        continue;
      }
      const auth = (data.authTicket ?? data.AuthTicket) as Record<string, unknown> | undefined;
      const user = (data.user ?? data.User) as Record<string, unknown> | undefined;
      const token = String(auth?.token ?? "");
      const accountId = String(user?.id ?? data.id ?? "");
      if (!token) throw new Error("LibreLink Up login returned no auth token (check credentials/region)");
      this.token = token;
      this.accountId = accountId || undefined;
      this.region = region;
      return {
        token,
        accountId,
        expires: typeof auth?.expires === "number" ? (auth.expires as number) : undefined,
      };
    }
    throw new Error("LibreLink Up login redirect loop — set LIBRELINKUP_REGION explicitly");
  }

  /** List the patients (sensors) this account follows. The account's own sensor is one of them. */
  async getConnections(): Promise<LibreLinkUpConnection[]> {
    if (!this.token) await this.login();
    const res = await this.fetchImpl(`${this.base()}/llu/connections`, { headers: this.headers() });
    if (!res.ok) throw new Error(`LibreLink Up connections failed: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return (json.data ?? []).map((c) => {
      const measurement = (c.glucoseMeasurement ?? c.GlucoseMeasurement) as Record<string, unknown> | undefined;
      return {
        patientId: String(c.patientId ?? c.PatientId ?? ""),
        firstName: c.firstName ? String(c.firstName) : undefined,
        lastName: c.lastName ? String(c.lastName) : undefined,
        sensor: c.sensor ? String((c.sensor as Record<string, unknown>).sn ?? "") || undefined : undefined,
        latest: measurement ? toReading(measurement) ?? undefined : undefined,
      };
    });
  }

  /** Resolve the patientId to query: explicit override, else the first connection. */
  async resolvePatientId(): Promise<string> {
    if (this.fixedPatientId) return this.fixedPatientId;
    const conns = await this.getConnections();
    if (conns.length === 0 || !conns[0].patientId) {
      throw new Error("No LibreLink Up connections found — accept a sharing invite or set LIBRELINKUP_PATIENT_ID");
    }
    return conns[0].patientId;
  }

  /**
   * Fetch the recent glucose graph for a patient (~12h of historical points plus
   * the current measurement). Returns chronologically-sorted GlucoseReadings.
   */
  async getGraph(patientId?: string): Promise<GlucoseReading[]> {
    if (!this.token) await this.login();
    const id = patientId ?? (await this.resolvePatientId());
    const res = await this.fetchImpl(`${this.base()}/llu/connections/${encodeURIComponent(id)}/graph`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`LibreLink Up graph failed: HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: { connection?: Record<string, unknown>; graphData?: Array<Record<string, unknown>> };
    };
    const data = json.data ?? {};
    const points = (data.graphData ?? []).map(toReading).filter((r): r is GlucoseReading => r !== null);
    // The connection block carries the single most-recent measurement; include it.
    const current = data.connection
      ? toReading(
          (data.connection.glucoseMeasurement ?? data.connection.GlucoseMeasurement) as Record<string, unknown>,
        )
      : null;
    const all = current ? [...points, current] : points;
    return all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /** Return the single most-recent reading for a patient (last point of the graph). */
  async getCurrent(patientId?: string): Promise<GlucoseReading | null> {
    const readings = await this.getGraph(patientId);
    return readings.length > 0 ? readings[readings.length - 1] : null;
  }
}
