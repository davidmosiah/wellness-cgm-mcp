# Changelog

## [Unreleased]

## [0.2.0] - 2026-05-10

### Added

- `cgm_quickstart` tool — returns a personalized 3-step walkthrough (sign up → OAuth dance → verify) based on the agent's current state (mock vs live mode, credentials present, etc.).
- `cgm_demo` tool — returns realistic example payloads of `cgm_glucose_now`, `cgm_daily_summary`, and `cgm_meal_response` so agents see the contract before any real call.
- `cgm_authorize_url` now returns a `next[]` step list explaining the OAuth flow, plus a `hint` + `recommended_redirect` when credentials are missing.
- `doctor` CLI returns a `recommendations[]` array tailored to the current state (missing client_id vs missing token vs ready).

### Changed

- `recommended_first_calls` on the agent manifest now leads with `cgm_quickstart`.
- Tool count: 10 → 12.

## [0.1.0] - 2026-05-10

### Added

- Initial release. Local-first CGM MCP server with full Dexcom Developer API support (sandbox + production).
- 10 MCP tools: standard 5 (`cgm_agent_manifest`, `cgm_capabilities`, `cgm_connection_status`, `cgm_privacy_audit`, `cgm_data_inventory`) + CGM-specific 5 (`cgm_glucose_now`, `cgm_glucose_window`, `cgm_daily_summary`, `cgm_meal_response`, `cgm_authorize_url`).
- Glucose math: time-in-range (ADA diabetic 70-180 + Levels-style metabolic-health 70-140), GMI (Bergenstal 2018 formula), CV, mean/median/min/max/stdev.
- Meal response: baseline → peak → return-to-baseline with bands (excellent < 30 / good 30-49 / moderate 50-79 / poor ≥ 80).
- Dexcom OAuth flow scaffolded: `cgm_authorize_url` MCP tool + `wellness-cgm authorize` / `wellness-cgm exchange <code>` CLI helpers.
- **Mock mode by default** — without DEXCOM_ACCESS_TOKEN, every tool returns synthetic 5-minute-interval readings clearly tagged with `mock: true`. Lets agents demo the full surface without setup.
- One-line stderr community CTA on CLI commands (TTY-gated).
- `community` block on the agent manifest.
- FreeStyle Libre via LibreLink Up community proxy listed as v0.2 roadmap.
