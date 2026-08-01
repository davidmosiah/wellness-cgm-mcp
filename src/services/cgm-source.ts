/**
 * Provider-agnostic CGM source.
 *
 * wellness-cgm-mcp supports two real backends — Dexcom (Developer API) and
 * FreeStyle Libre (via LibreLink Up). Both produce the same {@link GlucoseReading}
 * shape, so the ADA TIR / GMI / hypo / meal-response engine is shared and the
 * MCP tools don't need to know which provider is active.
 *
 * Provider selection (in priority order):
 *   1. Explicit `CGM_PROVIDER` env var ("dexcom" | "libre").
 *   2. Auto-detect: if LibreLink Up creds are set and Dexcom is not, use libre.
 *   3. Default: dexcom (preserves pre-0.4 behaviour).
 *
 * Mock mode is preserved: when the resolved provider has no auth configured,
 * `loadReadings` returns synthetic readings tagged `mock: true` — identical to
 * the original Dexcom mock path, so every tool still demos with zero setup.
 */
import { LIBRELINKUP_MAX_WINDOW_HOURS, SUPPORTED_PROVIDERS, type CgmProvider } from "../constants.js";
import { DexcomClient } from "./dexcom-client.js";
import { LibreLinkUpClient } from "./librelink-client.js";
import { mockReadings, type GlucoseReading } from "./glucose-engine.js";

export interface LoadedReadings {
  readings: GlucoseReading[];
  mock: boolean;
  /** Hours the caller asked for. */
  requested_hours: number;
  /**
   * Hours the returned readings actually span (newest − oldest). This is the
   * number every downstream metric is really computed over; `requested_hours`
   * is only an intent.
   */
  covered_hours: number;
  /**
   * Hard ceiling the active provider imposes on a single read, or `null` when
   * it honours arbitrary spans. Libre live reads cap at ~12h.
   */
  provider_max_hours: number | null;
  /** True when the provider ceiling is narrower than what was requested. */
  truncated: boolean;
  /** First/last reading actually returned — same idiom as `cgm_hypo_events`. */
  observed_window: { start: string | null; end: string | null; hours: number };
  /** Provider name used when phrasing the coverage warning. Internal. */
  provider_label?: string;
}

/** What each provider can return in ONE read. `null` = honours arbitrary spans. */
interface ProviderWindowCap {
  hours: number;
  /** Name used in the warning shown to agents. */
  label: string;
}

const PROVIDER_WINDOW_CAP: Record<CgmProvider, ProviderWindowCap | null> = {
  // /llu/connections/{id}/graph has no start/end parameter — always ~12h.
  libre: { hours: LIBRELINKUP_MAX_WINDOW_HOURS, label: "LibreLink Up" },
  // Dexcom v3 /egvs takes explicit startDate/endDate, so the request is honoured.
  dexcom: null,
};

/** Round to 2 decimals (hours are reported with minute-ish precision). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Attach real coverage to a set of readings.
 *
 * `cap` is the provider's structural ceiling (null when it has none); it — not
 * a float comparison against the observed span — decides `truncated`, so a
 * normal read that happens to end 4 minutes short never raises a false alarm.
 */
function withCoverage(
  readings: GlucoseReading[],
  requestedHours: number,
  mock: boolean,
  cap: ProviderWindowCap | null,
): LoadedReadings {
  const times = readings
    .map((r) => new Date(r.timestamp).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const start = times.length > 0 ? new Date(times[0]).toISOString() : null;
  const end = times.length > 0 ? new Date(times[times.length - 1]).toISOString() : null;
  const coveredHours = times.length > 1 ? round2((times[times.length - 1] - times[0]) / (60 * 60 * 1000)) : 0;
  return {
    readings,
    mock,
    requested_hours: requestedHours,
    covered_hours: coveredHours,
    provider_max_hours: cap?.hours ?? null,
    truncated: cap !== null && requestedHours > cap.hours,
    observed_window: { start, end, hours: coveredHours },
    provider_label: cap?.label,
  };
}

/**
 * Human-readable warnings for a load. Empty when the load covered what it was
 * asked for. Handlers that expose no timestamps (cgm_daily_summary) depend on
 * this being surfaced — without it the caller cannot tell a 3-day metric from a
 * half-day one.
 */
export function coverageNotes(loaded: LoadedReadings): string[] {
  if (!loaded.truncated) return [];
  const label = loaded.provider_label ?? "This provider";
  return [
    `${label} returns ~${loaded.provider_max_hours}h of graph data per read and ignores wider spans; ` +
      `requested ${loaded.requested_hours}h, covered ${loaded.covered_hours}h. ` +
      `Every metric here describes the covered window only — do not report it as a ${loaded.requested_hours}h result.`,
  ];
}

export interface CgmSourceStatus {
  ok: true;
  provider: CgmProvider;
  /** Why this provider was chosen. */
  selected_by: "env" | "auto" | "default";
  mode: "live" | "mock";
  /** Provider-specific detail (env, region, configured flags). */
  detail: Record<string, unknown>;
  notes: string[];
}

function resolveProvider(): { provider: CgmProvider; selected_by: "env" | "auto" | "default" } {
  const raw = (process.env.CGM_PROVIDER ?? "").trim().toLowerCase();
  if (raw && (SUPPORTED_PROVIDERS as readonly string[]).includes(raw)) {
    return { provider: raw as CgmProvider, selected_by: "env" };
  }
  const libreConfigured = Boolean(
    (process.env.LIBRELINKUP_EMAIL && process.env.LIBRELINKUP_PASSWORD) || process.env.LIBRELINKUP_TOKEN,
  );
  const dexcomConfigured = Boolean(process.env.DEXCOM_ACCESS_TOKEN);
  if (libreConfigured && !dexcomConfigured) {
    return { provider: "libre", selected_by: "auto" };
  }
  return { provider: "dexcom", selected_by: "default" };
}

/**
 * A uniform CGM source over whichever provider is active. Construct with
 * `CgmSource.resolve()` to honour env-based provider selection, or pass an
 * explicit provider for tests.
 */
export class CgmSource {
  readonly provider: CgmProvider;
  readonly selectedBy: "env" | "auto" | "default";
  private readonly dexcom?: DexcomClient;
  private readonly libre?: LibreLinkUpClient;

  private constructor(
    provider: CgmProvider,
    selectedBy: "env" | "auto" | "default",
    clients: { dexcom?: DexcomClient; libre?: LibreLinkUpClient } = {},
  ) {
    this.provider = provider;
    this.selectedBy = selectedBy;
    if (provider === "libre") {
      this.libre = clients.libre ?? new LibreLinkUpClient();
    } else {
      this.dexcom = clients.dexcom ?? new DexcomClient();
    }
  }

  static resolve(): CgmSource {
    const { provider, selected_by } = resolveProvider();
    return new CgmSource(provider, selected_by);
  }

  /** Test/explicit constructor — pick a provider directly. */
  static forProvider(
    provider: CgmProvider,
    clients: { dexcom?: DexcomClient; libre?: LibreLinkUpClient } = {},
  ): CgmSource {
    return new CgmSource(provider, "env", clients);
  }

  hasAuth(): boolean {
    return this.provider === "libre" ? Boolean(this.libre?.hasAuth()) : Boolean(this.dexcom?.hasAuth());
  }

  mode(): "live" | "mock" {
    return this.hasAuth() ? "live" : "mock";
  }

  /**
   * Load readings over the last `hours`. Falls back to synthetic mock data when
   * the active provider has no auth configured.
   *
   * The result always states how many hours it actually COVERS
   * (`covered_hours` / `observed_window`), because one provider cannot honour
   * every request: a Libre live read is capped at ~12h. Callers must report the
   * covered window, never the requested one.
   */
  async loadReadings(hours: number): Promise<LoadedReadings> {
    if (!this.hasAuth()) {
      // Mock mode synthesises exactly the requested span — no provider cap applies.
      return withCoverage(mockReadings(hours), hours, true, null);
    }
    if (this.provider === "libre") {
      // LibreLink Up's /graph takes no start/end parameter: it returns its own
      // fixed trailing ~12h. Trimming here can only NARROW that window (when
      // `hours` < 12); it can never widen it, so anything above the cap comes
      // back short — which is exactly what `withCoverage` records.
      const all = await this.libre!.getGraph();
      const cutoff = Date.now() - hours * 60 * 60 * 1000;
      const readings = all.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
      return withCoverage(readings, hours, false, PROVIDER_WINDOW_CAP.libre);
    }
    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    const readings = await this.dexcom!.getEgvs(start.toISOString(), end.toISOString());
    return withCoverage(readings, hours, false, PROVIDER_WINDOW_CAP.dexcom);
  }

  /**
   * Load readings across an explicit [startMs, endMs] window (used by hypo
   * detection). Mock mode synthesises a span that covers the window.
   */
  async loadReadingsWindow(startMs: number, endMs: number): Promise<LoadedReadings> {
    const requestedHours = Math.max(0, (endMs - startMs) / (60 * 60 * 1000));
    if (!this.hasAuth()) {
      const spanHours = Math.max(1, Math.ceil(requestedHours));
      return withCoverage(mockReadings(Math.min(spanHours, 72)), requestedHours, true, null);
    }
    if (this.provider === "libre") {
      const all = await this.libre!.getGraph();
      const readings = all.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        return t >= startMs && t <= endMs;
      });
      return withCoverage(readings, requestedHours, false, PROVIDER_WINDOW_CAP.libre);
    }
    const readings = await this.dexcom!.getEgvs(new Date(startMs).toISOString(), new Date(endMs).toISOString());
    return withCoverage(readings, requestedHours, false, PROVIDER_WINDOW_CAP.dexcom);
  }

  status(): CgmSourceStatus {
    const mode = this.mode();
    if (this.provider === "libre") {
      const c = this.libre!;
      return {
        ok: true,
        provider: "libre",
        selected_by: this.selectedBy,
        mode,
        detail: {
          region: c.region,
          credentials_configured: c.hasAuth(),
          patient_id_pinned: Boolean(c.fixedPatientId),
          max_window_hours: mode === "live" ? LIBRELINKUP_MAX_WINDOW_HOURS : null,
        },
        notes:
          mode === "live"
            ? [
                "Live mode — FreeStyle Libre via LibreLink Up. Calls go to Abbott's LibreLink Up API.",
                `LibreLink Up returns at most ~${LIBRELINKUP_MAX_WINDOW_HOURS}h of history per read. Requests for a wider window come back short; glucose tools report the covered span in hours_covered / observed_window. For multi-day metrics use Dexcom.`,
              ]
            : [
                "Mock mode — set LIBRELINKUP_EMAIL and LIBRELINKUP_PASSWORD to enable live Libre reads.",
                "Run 'wellness-cgm libre-login' to verify credentials and list your connected sensor.",
              ],
      };
    }
    const c = this.dexcom!;
    return {
      ok: true,
      provider: "dexcom",
      selected_by: this.selectedBy,
      mode,
      detail: {
        env: c.env,
        client_id_configured: Boolean(c.clientId),
        access_token_configured: c.hasAuth(),
      },
      notes:
        mode === "live"
          ? ["Live mode — calls go to the Dexcom API."]
          : [
              "Mock mode — set DEXCOM_ACCESS_TOKEN to enable live reads. Run 'wellness-cgm authorize' to start the OAuth flow.",
            ],
    };
  }
}
