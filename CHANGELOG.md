# Changelog

## [0.4.1] - 2026-07-16

### Fixed

- Added executable provider-boundary contracts for Dexcom v3 and LibreLink Up, including endpoints, auth headers, identifier encoding, and canonical glucose mapping.
- Dexcom EGV windows now require valid ISO 8601 date-times, normalize offsets to UTC, reject reversed ranges, and enforce the official 30-day maximum before network I/O.
- Updated the transitive Hono security override to 4.12.30.

## [Unreleased]

## [0.4.0] - 2026-05-29

### Added

- **FreeStyle Libre support via LibreLink Up — the OTC sensor.** wellness-cgm-mcp now reads from two real backends: Dexcom (Developer API) **and** FreeStyle Libre (Libre 2 / Libre 3) through Abbott's LibreLink Up companion API. Libre is the biggest lever for "real users with real data" because the consumer OTC sensor needs no developer-program signup — just the same email/password you use in the LibreLinkUp follower app.
  - New `LibreLinkUpClient` (`services/librelink-client.ts`): `login()` → `getConnections()` → `getGraph()` / `getCurrent()`. Handles the 4.x `account-id` SHA-256 header, regional shards (`LIBRELINKUP_REGION`, default `eu`) with one auto-followed login redirect, US-locale timestamp parsing, and trend-arrow mapping. Returns the same `GlucoseReading` shape as Dexcom, so **the entire ADA TIR / GMI / hypo / meal-response engine is reused unchanged**.
  - New provider-agnostic `CgmSource` (`services/cgm-source.ts`) backs every glucose tool. Provider is chosen by `CGM_PROVIDER` (`dexcom` | `libre`), else auto-detected (Libre when `LIBRELINKUP_*` creds are set and `DEXCOM_ACCESS_TOKEN` is not), else defaults to Dexcom — preserving pre-0.4 behaviour. Every glucose tool response now includes a `provider` field.
  - New MCP tools: `cgm_libre_status` (region + config + mock/live) and `cgm_libre_login` (authenticate + list followed sensors, never returns the token; mock-mode demo without an Abbott account). Tool count: 17 → 19.
  - New CLI command `wellness-cgm libre-login`. `doctor` now reports `cgm_provider` + `librelinkup_credentials`. `cgm_capabilities` lists `libre` as configured when its creds are present; `cgm_connection_status` reports the active provider and how it was selected.
  - Env vars: `CGM_PROVIDER`, `LIBRELINKUP_EMAIL`, `LIBRELINKUP_PASSWORD`, `LIBRELINKUP_REGION`, `LIBRELINKUP_PATIENT_ID`, `LIBRELINKUP_TOKEN`, `LIBRELINKUP_ACCOUNT_ID`.
  - Verified in mock mode (synthetic readings + the two new tools register and return data) and via a stubbed-fetch end-to-end test that parses a realistic LibreLink Up graph payload into `GlucoseReading[]` and runs it through the shared ADA TIR/GMI engine. **Validation against a real LibreLink Up account is still pending** before an npm release.

### Changed

- Backward compatible: existing Dexcom env vars, tools, and the mock fallback are unchanged. `cgm_connection_status` keeps its legacy `env` / `client_id_configured` / `access_token_configured` fields and adds provider-aware fields on top.

## [0.3.3] - 2026-05-20

### Added

- **`cgm_hypo_events` MCP tool — hypoglycemia event detection from CGM readings.** Returns contiguous below-threshold runs lasting ≥ `min_duration_minutes` as discrete events, each with `started_at`, `ended_at`, `duration_minutes`, `min_glucose_mg_dl`, `mean_glucose_mg_dl`, `severity` (`level_1` < 70 ADA Level 1; `level_2` < 54 ADA Level 2), and `recovery_time_minutes` (minutes from event end to first reading ≥ threshold + 10). Also returns `total_events`, `total_minutes_below`, `mean_min_glucose`, `events_per_day`, a `summary` string, and `recommendations` grounded in what was actually observed (level_2 count, daily frequency, slow recovery). Every response carries a prominent `medical_disclaimer`: *"NOT medical advice. Do not use for treatment decisions. Hypo events should be discussed with your clinician."*
- Inputs: `from` (ISO), `to` (ISO), `threshold_mg_dl` (default 70), `severe_threshold_mg_dl` (default 54), `min_duration_minutes` (default 15), `response_format` (`"structured"` default | `"summary"` omits event array).
- New pure function `detectHypoEvents()` in `services/glucose-engine.ts`. Validated by synthetic 5-minute-interval glucose streams: a 20-min Level 1 event, an 18-min Level 2 event, and a 10-min spike that correctly does NOT count.
- `cgm_data_inventory` now surfaces `hypo_thresholds` (level 1 = 70 mg/dL, level 2 = 54 mg/dL, min duration 15 min, ADA source).
- `cgm_capabilities` adds `hypo_events_level_1`, `hypo_events_level_2`, `minutes_below_threshold`, `recovery_time_minutes` to the metric catalog.
- New agent_rule documenting the medical-disclaimer requirement for `cgm_hypo_events`.
- Tool count: 16 → 17.

## [0.3.2] - 2026-05-19

### Added

- **`cgm_time_in_range` MCP tool — TIR with explicit window + hour-of-day + target-range support.** Previously TIR was only available through `cgm_daily_summary` (whole-window, ADA 70-180 hard-coded). The new tool accepts:
  - `start_time` / `end_time` (ISO-8601, optional — defaults to full data set) so the caller can compute TIR for mealtime windows (e.g. 7am-10am), overnight windows (e.g. 23:00-07:00), or arbitrary date-ranges.
  - `target_low` / `target_high` (mg/dL, optional — defaults to 70-180 ADA) so the caller can compute tighter targets (e.g. 80-110 Levels-style metabolic-health).
  - `hours` (1-72, optional — defaults to 24) controls how much data is loaded before filtering.
  - `time_window` (`"all"` | `"wake"` | `"sleep"`) preset for recurring hour-of-day filtering. `"wake"` = 06:00-22:00, `"sleep"` = 22:00-06:00 (wraps midnight). Default `"all"`.
  - Explicit `start_hour` / `end_hour` (0-24, UTC) for custom hour-of-day windows that override the preset — supports midnight-wrap ranges (e.g. 22→6).
  Returns TIR%, time-below-range%, time-above-range%, AND new explicit numeric fields: `total_readings` (pre-filter), `readings_in_window`, `mean_glucose`, `median_glucose`, and `gmi` (Glucose Management Indicator / estimated A1C per ADA-Bergenstal 2018: `GMI(%) = 3.31 + 0.02392 × mean_mg_dL`). Helpful guidance note when the window is empty (`readings_in_window = 0`) or undersized (<12 readings) — empty windows no longer crash and consistently return zeros.
- New `timeInRangeWindow()` pure function in `services/glucose-engine.ts` with `TimeWindowPreset` type and explicit hour-of-day resolver. Validated by 9 smoke assertions covering: full-window default, explicit 3-hour window, tight 80-110 target, ancient out-of-data window, explicit numeric fields, GMI formula accuracy via the tool, wake-vs-sleep preset split, custom `start_hour`/`end_hour`, and GMI sanity at known means (154 mg/dL, 183 mg/dL).
- Tool count: 15 → 16.

### Changed

- `TimeInRangeWindowResult` extended with `total_readings`, `readings_in_window`, `mean_glucose`, `median_glucose`, `gmi`, and `hour_of_day_filter`. Existing `count` / `in_range_pct` / `below_pct` / `above_pct` / `range` / `buckets` fields preserved for backwards compatibility.

## [0.3.1] - 2026-05-11

### Fixed

- **Profile-store regex no longer false-positives on common wellness words.** Split `SECRET_PATTERNS` into `SECRET_KEY_PATTERNS` (broad, for field names like `oauth_token`) and `SECRET_VALUE_PATTERNS` (high-specificity, only credential shapes: JWTs, `Bearer <token>`, `sk_live_`, `sk-proj-`, `xoxb-`, `github_pat_`, raw `Authorization:` headers). Previously legitimate text like "5 training sessions per week", "limit cookies", "I need to refresh my approach", or "secret sauce: more sleep" was rejected.
- **Partial-profile reads no longer crash downstream.** `readProfileFile` now structurally merges with `DEFAULT_PROFILE` when legacy Hermes/OpenClaw files lacked sub-objects. Previously `buildProfileSummary` and `missingCriticalFields` would throw.
- **Onboarding `privacy_note` no longer hard-codes a single connector path.** Lists multiple example paths so the message reads correctly from every connector.

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
