#!/usr/bin/env node
/**
 * Regression gate for the LibreLink Up window-truncation defect (fixed in 0.5.0).
 *
 * The bug: in LIVE Libre mode, `/graph` hands back a fixed trailing ~12h no
 * matter what was asked for, but the payloads kept echoing the REQUESTED span.
 * `cgm_daily_summary(hours: 72)` returned `window_hours: 72` next to GMI
 * (estimated A1C), CV and two time-in-range profiles — all computed over half a
 * day — and carried no timestamp at all, so an agent could not detect it.
 *
 * This gate boots the real MCP server over stdio with a preloaded network stub
 * (scripts/fixtures/librelink-graph-stub.mjs) so the LIVE Libre path runs with
 * synthetic data and no Abbott account. It asserts:
 *   1. live libre + hours=72  → payload declares the COVERED window + a note.
 *   2. live libre + hours=6   → no note (window fits under the ~12h ceiling).
 *   3. mock mode  + hours=72  → still honest (~72h covered), no note.
 *
 * All fixture data is synthetic. No real health export is ever used here.
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const STUB = pathToFileURL(new URL("./fixtures/librelink-graph-stub.mjs", import.meta.url).pathname).href;

/** Env for a live-Libre server: fake credentials, never a real account. */
const LIVE_LIBRE_ENV = {
  CGM_PROVIDER: "libre",
  LIBRELINKUP_EMAIL: "fixture@example.invalid",
  LIBRELINKUP_PASSWORD: "synthetic-fixture-password",
  LIBRELINKUP_PATIENT_ID: "patient-fixture-0000",
  LIBRELINKUP_REGION: "eu",
};

/** Env for mock mode: libre selected, but no credentials at all. */
const MOCK_LIBRE_ENV = { CGM_PROVIDER: "libre" };

function baseEnv() {
  const env = { ...process.env, WELLNESS_CGM_QUIET: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("LIBRELINKUP_") || key.startsWith("DEXCOM_") || key === "CGM_PROVIDER") delete env[key];
  }
  return env;
}

async function connect(extraEnv, { stub }) {
  const transport = new StdioClientTransport({
    command: "node",
    args: stub ? ["--import", STUB, "dist/index.js"] : ["dist/index.js"],
    env: { ...baseEnv(), ...extraEnv },
  });
  const client = new Client({ name: "wellness-cgm-libre-window-test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

const call = async (client, name, args) =>
  JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

const hasTruncationNote = (payload) =>
  Array.isArray(payload.notes) && payload.notes.some((n) => /covered/i.test(n) && /LibreLink Up/i.test(n));

// ---------------------------------------------------------------------------
// 1. LIVE libre, hours=72 — the actual defect.
// ---------------------------------------------------------------------------
const live = await connect(LIVE_LIBRE_ENV, { stub: true });

const win72 = await call(live, "cgm_glucose_window", { hours: 72 });
assert.equal(win72.ok, true, `glucose_window not ok: ${JSON.stringify(win72)}`);
assert.equal(win72.mock, false, "stubbed credentials must put the server in LIVE mode, not mock");
assert.equal(win72.provider, "libre");
assert.ok(win72.count > 0, "stub should yield readings");
assert.equal(typeof win72.hours_covered, "number", "cgm_glucose_window must declare hours_covered");
assert.ok(
  win72.hours_covered > 10 && win72.hours_covered <= 13,
  `hours_covered should be the real ~12h span, got ${win72.hours_covered}`,
);
assert.equal(win72.hours_requested ?? win72.hours, 72, "the requested span must still be reported, as requested");
assert.ok(
  win72.observed_window && typeof win72.observed_window.start === "string",
  "cgm_glucose_window must expose observed_window.start (same idiom as cgm_hypo_events)",
);
assert.ok(hasTruncationNote(win72), `cgm_glucose_window must emit a coverage note; got ${JSON.stringify(win72.notes)}`);
console.log(
  `✓ cgm_glucose_window(72h, live libre): hours_covered=${win72.hours_covered} + note ("${win72.notes[0].slice(0, 64)}…")`,
);

// The blind one: no readings array, no timestamps — only these fields can warn.
const sum72 = await call(live, "cgm_daily_summary", { hours: 72 });
assert.equal(sum72.ok, true, `daily_summary not ok: ${JSON.stringify(sum72)}`);
assert.equal(sum72.mock, false, "daily_summary must be in LIVE mode for this case");
assert.ok(sum72.summary.gmi_pct > 0, "summary must still compute");
assert.equal(typeof sum72.hours_covered, "number", "cgm_daily_summary must declare hours_covered");
assert.ok(
  sum72.hours_covered > 10 && sum72.hours_covered <= 13,
  `daily_summary hours_covered should be ~12h, got ${sum72.hours_covered}`,
);
assert.ok(
  sum72.hours_covered < sum72.window_hours,
  "daily_summary must show covered < requested instead of silently claiming the requested window",
);
assert.ok(
  sum72.observed_window && typeof sum72.observed_window.start === "string",
  "cgm_daily_summary must expose observed_window so a timestamp-less caller can verify the span",
);
assert.ok(hasTruncationNote(sum72), `cgm_daily_summary must emit a coverage note; got ${JSON.stringify(sum72.notes)}`);
console.log(
  `✓ cgm_daily_summary(72h, live libre): window_hours=${sum72.window_hours} hours_covered=${sum72.hours_covered} GMI=${sum72.summary.gmi_pct}% + note`,
);

// cgm_time_in_range loads the same truncated series behind loaded_window_hours.
const tir72 = await call(live, "cgm_time_in_range", { hours: 72 });
assert.equal(tir72.ok, true);
assert.equal(typeof tir72.hours_covered, "number", "cgm_time_in_range must declare hours_covered");
assert.ok(tir72.hours_covered < tir72.loaded_window_hours, "time_in_range covered must be < loaded window");
assert.ok(hasTruncationNote(tir72), `cgm_time_in_range must emit a coverage note; got ${JSON.stringify(tir72.notes)}`);
console.log(`✓ cgm_time_in_range(72h, live libre): hours_covered=${tir72.hours_covered} + note`);

// ---------------------------------------------------------------------------
// 2. LIVE libre, hours=6 — inside the ceiling. Must stay quiet (no false alarm).
// ---------------------------------------------------------------------------
const win6 = await call(live, "cgm_glucose_window", { hours: 6 });
assert.equal(win6.ok, true);
assert.equal(win6.mock, false);
assert.ok(win6.hours_covered > 5 && win6.hours_covered <= 6, `6h request should cover ~6h, got ${win6.hours_covered}`);
assert.equal(hasTruncationNote(win6), false, `hours<=12 must NOT emit a truncation note; got ${JSON.stringify(win6.notes)}`);

const sum6 = await call(live, "cgm_daily_summary", { hours: 6 });
assert.equal(sum6.ok, true);
assert.ok(sum6.hours_covered > 5 && sum6.hours_covered <= 6);
assert.equal(hasTruncationNote(sum6), false, "hours<=12 daily_summary must NOT emit a truncation note");
console.log(`✓ live libre 6h (inside the ~12h ceiling): hours_covered=${win6.hours_covered}, no note on either handler`);

await live.close();

// ---------------------------------------------------------------------------
// 3. Mock mode — already honest before the fix; prove it stayed that way.
// ---------------------------------------------------------------------------
const mock = await connect(MOCK_LIBRE_ENV, { stub: false });

const mockWin = await call(mock, "cgm_glucose_window", { hours: 72 });
assert.equal(mockWin.ok, true);
assert.equal(mockWin.mock, true, "no credentials → mock mode");
assert.ok(mockWin.hours_covered > 71, `mock must genuinely cover ~72h, got ${mockWin.hours_covered}`);
assert.equal(hasTruncationNote(mockWin), false, "mock mode must NOT emit a truncation note");

const mockSum = await call(mock, "cgm_daily_summary", { hours: 72 });
assert.equal(mockSum.ok, true);
assert.equal(mockSum.mock, true);
assert.ok(mockSum.hours_covered > 71, `mock daily_summary must cover ~72h, got ${mockSum.hours_covered}`);
assert.equal(hasTruncationNote(mockSum), false, "mock daily_summary must NOT emit a truncation note");
console.log(`✓ mock mode 72h stays honest: hours_covered=${mockSum.hours_covered}, no note (no regression)`);

await mock.close();

console.log("\nlibre window-coverage test passed.");
