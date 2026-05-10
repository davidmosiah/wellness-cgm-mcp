# Security Policy

## Reporting

Email **mosiahdavid@gmail.com** with details and reproduction. Do not open a public issue.

## Scope

CGM data is medical-record sensitive. The relevant security surfaces:

- Dexcom OAuth tokens stored in env vars (never logged).
- Local cache directory under `~/.wellness-cgm`.
- HTTP transport (`--http`) bound to `127.0.0.1` by default.
- Outbound calls to sandbox-api.dexcom.com / api.dexcom.com.

If you find token leaks, unintended outbound destinations, or unexpected behaviors with sensitive data, please report.

## Out of scope

- Dexcom API vulnerabilities — report to Dexcom.
- LibreLink Up risks — that integration is not in v0.1.
