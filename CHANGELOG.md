# Changelog

## [Unreleased]

## [0.3.0] - 2026-05-11

### Added

- **Shared wellness profile support** — vendored canonical `profile-store` (Delx Wellness `ab83d1a`) at `src/services/profile-store.ts`. Reads/writes `~/.delx-wellness/profile.json` (the same file every Delx Wellness MCP can read).
- `cgm_profile_get` MCP tool — returns the user's shared profile, one-line summary, and missing critical fields. Read-only.
- `cgm_profile_update` MCP tool — persist a partial patch with `explicit_user_intent: true`. Rejects secret-like fields (oauth/token/secret/password/cookie/refresh/api_key/session).
- `cgm_onboarding` MCP tool — returns the 11-question onboarding flow + the current profile + a cross-connector hint that profile feeds diabetes / non-DM context (which TIR profile to surface, 70-180 ADA vs 70-140 metabolic-health).
- `wellness-cgm onboarding [pt-BR|en]` CLI command — emits the flow as JSON on stdout plus a TTY-gated Markdown walkthrough on stderr ("the agent will ask these 11 questions next — non-secret data only, stored at ~/.delx-wellness/profile.json").

### Changed

- Tool count: 12 → 15.
- `recommended_first_calls` now leads with `cgm_profile_get` so agents fetch the user's diabetes context before choosing a TIR profile.

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
