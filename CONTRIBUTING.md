# Contributing

Thanks for considering a contribution to wellness-cgm-mcp.

1. **File an issue first** for non-trivial changes.
2. **Branch from `main`**, name it `feat/<thing>` or `fix/<thing>`.
3. **Run `npm test`** before opening a PR.
4. **Update CHANGELOG.md** under `## [Unreleased]`.

## High-leverage areas

- **FreeStyle Libre via LibreLink Up** — community proxy used by xDrip. Big audience: Libre is the most popular CGM globally.
- **Refresh-token rotation** for Dexcom (currently access_token must be re-set manually).
- **Cross-meal correlation** — pull meals from wellness-nourish, glucose from here, return a per-meal report.
- **Threshold alerts** — agent gets notified when glucose stays > X for Y minutes.

## Tone

- Recommendations are advisory, never medical.
- For diabetics, always defer dosing to clinician.

## License

By contributing you agree your changes are released under MIT.
