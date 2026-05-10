# AGENTS.md — wellness-cgm-mcp

## What this is

A local-first MCP server that exposes continuous-glucose-monitor data to AI agents. v0.1 ships full Dexcom Developer API support (sandbox + production). FreeStyle Libre via LibreLink Up is roadmapped for v0.2.

## Source layout

- `src/index.ts` — MCP entry. stdio + Streamable HTTP.
- `src/constants.ts` — Versions, Dexcom URLs, TIR thresholds.
- `src/services/dexcom-client.ts` — Dexcom OAuth flow + EGV fetch.
- `src/services/glucose-engine.ts` — Pure-function math: TIR, GMI, CV, meal response, mock readings generator.
- `src/services/{capabilities,privacy-audit,agent-manifest}.ts` — Standard manifest surfaces.
- `src/tools/cgm-tools.ts` — 10 MCP tools.
- `src/cli/commands.ts` — `doctor`, `setup`, `status`, `authorize`, `exchange`.

## Mock mode

Without `DEXCOM_ACCESS_TOKEN`, all glucose tools return synthetic 5-minute-interval readings tagged with `mock: true`. The synthetic series simulates a baseline of 95 mg/dL with breakfast and lunch spikes so the math (TIR, GMI, meal response) returns plausible values. This lets agents demo the full tool surface without setup.

## OAuth flow (v0.1)

1. User signs up at developer.dexcom.com and creates a project (sandbox is free).
2. User sets `DEXCOM_CLIENT_ID`, `DEXCOM_CLIENT_SECRET`, `DEXCOM_REDIRECT_URI`.
3. `wellness-cgm authorize` prints the OAuth URL.
4. User opens it, grants access, copies the auth code from the redirect URL.
5. `wellness-cgm exchange <auth_code>` swaps the code for `access_token` + `refresh_token`.
6. User sets `DEXCOM_ACCESS_TOKEN`. The MCP flips from mock → live mode automatically.

Refresh-token rotation lands in v0.2.

## Time-in-range

We surface TWO TIR profiles in every summary:

- **Diabetic** (70-180 mg/dL) — ADA standard for adults with diabetes.
- **Metabolic health** (70-140 mg/dL) — Levels-style for non-DM users.

Agents should surface BOTH so the user picks the one that fits their context.

## GMI formula

Bergenstal 2018: `GMI(%) = 3.31 + 0.02392 × mean(mg/dL)`. We surface this as an estimated A1C — clearly labelled as an estimate, not a lab measurement.

## Adding FreeStyle Libre in v0.2

LibreLink Up is the community proxy used by xDrip and others. Implementation:

1. Add `src/services/libre-client.ts` with login + glucose fetch.
2. Wire `cgm_glucose_now` etc. via the configured provider (`WELLNESS_CGM_DEFAULT_PROVIDER`).
3. Be very explicit about ToS: LibreLink Up is unofficial. Document the risk in privacy audit.

## Safety

- Never recommend insulin/medication adjustments. Defer to clinician.
- Mock mode clearly tagged on every response.
- Treat all readings as medical-record sensitive.
