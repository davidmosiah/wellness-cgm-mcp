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
import { SUPPORTED_PROVIDERS, type CgmProvider } from "../constants.js";
import { DexcomClient } from "./dexcom-client.js";
import { LibreLinkUpClient } from "./librelink-client.js";
import { mockReadings, type GlucoseReading } from "./glucose-engine.js";

export interface LoadedReadings {
  readings: GlucoseReading[];
  mock: boolean;
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
   */
  async loadReadings(hours: number): Promise<LoadedReadings> {
    if (!this.hasAuth()) {
      return { readings: mockReadings(hours), mock: true };
    }
    if (this.provider === "libre") {
      // LibreLink Up returns ~12h of graph data regardless of requested span;
      // we trim to the requested window so callers get the hours they asked for.
      const all = await this.libre!.getGraph();
      const cutoff = Date.now() - hours * 60 * 60 * 1000;
      const readings = all.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
      return { readings, mock: false };
    }
    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    const readings = await this.dexcom!.getEgvs(start.toISOString(), end.toISOString());
    return { readings, mock: false };
  }

  /**
   * Load readings across an explicit [startMs, endMs] window (used by hypo
   * detection). Mock mode synthesises a span that covers the window.
   */
  async loadReadingsWindow(startMs: number, endMs: number): Promise<LoadedReadings> {
    if (!this.hasAuth()) {
      const spanHours = Math.max(1, Math.ceil((endMs - startMs) / (60 * 60 * 1000)));
      return { readings: mockReadings(Math.min(spanHours, 72)), mock: true };
    }
    if (this.provider === "libre") {
      const all = await this.libre!.getGraph();
      const readings = all.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        return t >= startMs && t <= endMs;
      });
      return { readings, mock: false };
    }
    const readings = await this.dexcom!.getEgvs(new Date(startMs).toISOString(), new Date(endMs).toISOString());
    return { readings, mock: false };
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
        },
        notes:
          mode === "live"
            ? ["Live mode — FreeStyle Libre via LibreLink Up. Calls go to Abbott's LibreLink Up API."]
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
