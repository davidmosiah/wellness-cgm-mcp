# Changelog

## [Unreleased]

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
