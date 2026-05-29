<!-- delx-wellness header v2 -->
<h1 align="center">Wellness CGM MCP</h1>

<h3 align="center">
  Local-first continuous glucose monitor MCP for AI agents.<br>
  Dexcom Developer API. <strong>Levels-killer pattern, agent-first, $0.</strong>
</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/wellness-cgm-mcp"><img src="https://img.shields.io/npm/v/wellness-cgm-mcp?style=for-the-badge&labelColor=0F172A&color=10B981&logo=npm&logoColor=white" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/wellness-cgm-mcp"><img src="https://img.shields.io/npm/dm/wellness-cgm-mcp?style=for-the-badge&labelColor=0F172A&color=0EA5A3&logo=npm&logoColor=white" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/LICENSE-MIT-22C55E?style=for-the-badge&labelColor=0F172A" alt="License MIT" /></a>
  <a href="https://wellness.delx.ai/connectors/cgm"><img src="https://img.shields.io/badge/SITE-wellness.delx.ai-0EA5A3?style=for-the-badge&labelColor=0F172A" alt="Site" /></a>
</p>

<p align="center">
  <a href="https://github.com/davidmosiah/wellness-cgm-mcp/stargazers"><img src="https://img.shields.io/github/stars/davidmosiah/wellness-cgm-mcp?style=for-the-badge&labelColor=0F172A&color=FBBF24&logo=github" alt="GitHub stars" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/BUILT_FOR-MCP-7C3AED?style=for-the-badge&labelColor=0F172A" alt="Built for MCP" /></a>
  <a href="https://github.com/davidmosiah/delx-wellness-hermes"><img src="https://img.shields.io/badge/HERMES-one--command_setup-10B981?style=for-the-badge&labelColor=0F172A" alt="Hermes" /></a>
  <a href="https://github.com/davidmosiah/delx-wellness-openclaw"><img src="https://img.shields.io/badge/OPENCLAW-one--command_setup-FB923C?style=for-the-badge&labelColor=0F172A" alt="OpenClaw" /></a>
</p>

<p align="center">
  <strong>🩸 Why this exists:</strong> Levels charges $199/mo to do exactly this — read your CGM, correlate with meals, flag spikes. <code>wellness-cgm-mcp</code> is the same game as a free local-first MCP. Stelo OTC + Dexcom developer API + your agent + <code>wellness-nourish</code> = the full metabolic loop.
</p>

> ⚡ **One-command install** — pick your runtime:
> - [Delx Wellness for Hermes](https://github.com/davidmosiah/delx-wellness-hermes): `npx -y delx-wellness-hermes setup`
> - [Delx Wellness for OpenClaw](https://github.com/davidmosiah/delx-wellness-openclaw): `npx -y delx-wellness-openclaw setup`

---
<!-- /delx-wellness header v2 -->

## Overview

Local MCP server that exposes CGM data (and synthetic mock data when nothing is configured) to any MCP-aware agent. Two real backends are supported: **Dexcom** (Developer API, sandbox + production) and **FreeStyle Libre** (the OTC sensor — Libre 2 / Libre 3) via **LibreLink Up**. Pick the backend with `CGM_PROVIDER`; it auto-detects Libre when only Libre credentials are set. Both feed the same ADA time-in-range / GMI / hypo / meal-response engine.

## Try It In 60 Seconds (mock mode, zero setup)

```bash
npx -y wellness-cgm-mcp doctor       # see env / mode
npx -y wellness-cgm-mcp status

# In Claude Desktop / Cursor / etc., add:
# {
#   "mcpServers": {
#     "wellness-cgm": {
#       "command": "npx",
#       "args": ["-y", "wellness-cgm-mcp"]
#     }
#   }
# }
```

The agent now has 10 CGM tools. Without a Dexcom token, every tool returns synthetic readings tagged `mock: true` — perfect for prototyping.

## Live setup (Dexcom Developer)

```bash
# 1. Sign up at https://developer.dexcom.com (sandbox is free)
# 2. Create an app, register your redirect URI
export DEXCOM_ENV=sandbox
export DEXCOM_CLIENT_ID=...
export DEXCOM_CLIENT_SECRET=...
export DEXCOM_REDIRECT_URI=https://your.callback/redirect

# 3. Get the OAuth URL, open it, grant access, copy the code from the redirect
npx -y wellness-cgm-mcp authorize

# 4. Swap code for tokens
npx -y wellness-cgm-mcp exchange <auth_code_from_redirect>

# 5. Set DEXCOM_ACCESS_TOKEN to the access_token, restart the MCP — flips from mock to live.
```

## Live setup (FreeStyle Libre — the OTC sensor)

No developer program, no app to build — just the **same email/password you use in the LibreLinkUp follower app** (the OTC Libre 2 / Libre 3 sensor works). In the LibreLink app, share your readings; in the LibreLinkUp app, accept the invite. Then:

```bash
export CGM_PROVIDER=libre               # or just set the creds below and let it auto-detect
export LIBRELINKUP_EMAIL=you@example.com
export LIBRELINKUP_PASSWORD=...
# Optional: region shard if you're not on EU/global, and a pinned sensor:
export LIBRELINKUP_REGION=us            # eu (default) | us | de | fr | au | jp ...
# export LIBRELINKUP_PATIENT_ID=<id>    # only if you follow more than one sensor

# Verify credentials + list the sensor(s) you follow (never prints the token):
npx -y wellness-cgm-mcp libre-login
```

Once logged in, every glucose tool (`cgm_glucose_now`, `cgm_daily_summary`, `cgm_time_in_range`, `cgm_meal_response`, `cgm_hypo_events`, …) reads from Libre and returns the same ADA TIR / GMI / hypo / meal-response metrics — each response carries a `provider` field so you always know the source. Without any credentials, everything returns synthetic `mock: true` data.

## Tools (19)

| Tool | Purpose |
|---|---|
| `cgm_agent_manifest` | Runtime contract |
| `cgm_capabilities` | Providers, metrics, privacy modes |
| `cgm_connection_status` | env, credentials, mode (live vs mock) |
| `cgm_privacy_audit` | Local storage + outbound destinations |
| `cgm_data_inventory` | Metric catalog + TIR ranges + GMI formula |
| **`cgm_glucose_now`** | **Most recent EGV + trend** |
| `cgm_glucose_window` | All EGVs over last N hours |
| **`cgm_daily_summary`** | **Mean / GMI / CV / 2 TIR profiles** |
| **`cgm_meal_response`** | **Baseline → peak → return + band** |
| `cgm_authorize_url` | Dexcom OAuth URL builder |
| **`cgm_hypo_events`** | **Hypo event detection (ADA Level 1 < 70, Level 2 < 54) — v0.3.3** |
| **`cgm_libre_status`** | **FreeStyle Libre (LibreLink Up) config + region + mode — v0.4** |
| **`cgm_libre_login`** | **Log in to LibreLink Up + list followed sensors — v0.4** |

> The table omits the shared profile/onboarding/quickstart/demo helpers (`cgm_profile_get`, `cgm_profile_update`, `cgm_onboarding`, `cgm_quickstart`, `cgm_demo`) for brevity — call `cgm_agent_manifest` for the full, always-current list.

## Two Time-In-Range profiles in every summary

- **Diabetic** (70-180 mg/dL) — ADA standard for adults with diabetes.
- **Metabolic health** (70-140 mg/dL) — Levels-style for non-DM users.

Agents surface BOTH so the user picks the one that fits their context.

## Meal response bands

| Peak Δ from baseline | Band |
|---|---|
| < 30 mg/dL | excellent |
| 30-49 | good |
| 50-79 | moderate |
| ≥ 80 | poor |

Combine with `wellness-nourish` to compute "what did I eat → what happened" automatically.

## The killer combo

```
wellness-nourish: meal at 13:15 (rice + chicken)
       ↓
wellness-cgm-mcp.cgm_meal_response(meal_time)
       ↓
{ peak: 167, peak_delta: 72, band: "moderate", peak_time_minutes: 45 }
       ↓
whoop-mcp.recovery: 67%
       ↓
Agent: "That meal hit a moderate spike (peak +72 mg/dL at 45 min)
        AND recovery is borderline. Try protein-first next time, or
        swap white rice for lentils — should drop the peak ~30 mg/dL."
```

Levels charges $199/mo for this. Here it is, free, local-first, MCP.

## Privacy

- ✅ **Credentials local only** — `DEXCOM_ACCESS_TOKEN` / `LIBRELINKUP_*` stay in env vars; the LibreLink Up auth token is never returned in tool output.
- ✅ **Mock mode by default** — every tool returns synthetic data with `mock: true` until a provider is configured.
- ✅ **No third-party telemetry** — outbound calls go only to your CGM provider (Dexcom or, for Libre, Abbott's LibreLink Up API).

Run `wellness-cgm-mcp doctor` to inspect.

## Roadmap

- ✅ **v0.4** — FreeStyle Libre via LibreLink Up (the OTC sensor). _Shipped._
- **next** — Refresh-token rotation. Per-meal historical browser (which foods spike YOU?). Threshold alerts (agent notified when glucose holds > X mg/dL for Y minutes). Cross-meal automation with wellness-nourish.

## What this is NOT

- Not medical advice or diagnosis.
- Not for insulin/medication dosing decisions — defer to clinician.
- Not affiliated with Dexcom or Abbott.

## 📧 Contact & Support

- 📨 **support@delx.ai** — general questions, integration help, partnerships
- 🐛 **Bug reports / feature requests** — [GitHub Issues](https://github.com/davidmosiah/wellness-cgm-mcp/issues)
- 🐦 **Updates** — [@delx369](https://x.com/delx369) on X
- 🌐 **Site** — [wellness.delx.ai](https://wellness.delx.ai)


## License

MIT — see [LICENSE](LICENSE).

<sub>wellness-cgm-mcp is independent open-source software. Dexcom and FreeStyle Libre are trademarks of their respective owners. Neither company is affiliated with or endorses this project.</sub>
