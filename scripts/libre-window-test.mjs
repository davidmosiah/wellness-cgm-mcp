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

/**
 * `observed_window` is a published payload shape, so its KEY SET is a contract,
 * not an implementation detail.
 *
 * Two variants exist on purpose:
 *   - hours-based tools (glucose_window / daily_summary / time_in_range / demo)
 *     emit { start, end, hours };
 *   - cgm_hypo_events emits { start, end, days, hours } — `days` is what
 *     `events_per_day` is divided by and predates 0.5.0, so it is kept for
 *     existing consumers, and `hours` was added on top because a ~12h Libre
 *     read rounds to "1 day" and hides the truncation.
 *
 * Asserting only "hours is a number" cannot catch dropping `days` (the base
 * coverage object already carries hours), and asserting only "days exists"
 * cannot catch losing the hours override. Both variants are pinned exactly, so
 * deleting either side of the merge in cgm_hypo_events fails this gate.
 */
function assertObservedWindowShape(payload, label, { days = false } = {}) {
  const observed = payload.observed_window;
  assert.ok(observed && typeof observed === "object", `${label} must expose observed_window`);
  const expected = days ? ["days", "end", "hours", "start"] : ["end", "hours", "start"];
  assert.deepEqual(
    Object.keys(observed).sort(),
    expected,
    `${label} observed_window shape drifted — consumers read these keys. Got ${JSON.stringify(
      Object.keys(observed).sort(),
    )}, expected ${JSON.stringify(expected)}`,
  );
  assert.equal(typeof observed.start, "string", `${label} observed_window.start must be an ISO string`);
  assert.equal(typeof observed.end, "string", `${label} observed_window.end must be an ISO string`);
  assert.equal(
    typeof observed.hours,
    "number",
    `${label} observed_window.hours must be a number (days alone cannot express a 12h span)`,
  );
  if (days) {
    assert.equal(
      typeof observed.days,
      "number",
      `${label} observed_window.days must be preserved — events_per_day is built on it`,
    );
  }
}

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
assertObservedWindowShape(win72, "cgm_glucose_window(72h, live libre)");
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
assertObservedWindowShape(sum72, "cgm_daily_summary(72h, live libre)");
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
assert.equal(tir72.hours_requested, 72, "cgm_time_in_range must report hours_requested like the other windowed tools");
assert.ok(
  tir72.observed_window && typeof tir72.observed_window.start === "string",
  "cgm_time_in_range must expose observed_window — same contract as glucose_window/daily_summary",
);
assertObservedWindowShape(tir72, "cgm_time_in_range(72h, live libre)");
console.log(`✓ cgm_time_in_range(72h, live libre): hours_covered=${tir72.hours_covered} + note`);

// The fourth blind path: cgm_hypo_events asks for an explicit [from, to] span
// and carries a medical disclaimer. "Any hypos in the last 3 days?" answered
// from ~12h of data, with no coverage field, is the same defect as above.
const hypoFrom = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
const hypoTo = new Date().toISOString();
const hypo72 = await call(live, "cgm_hypo_events", { from: hypoFrom, to: hypoTo });
assert.equal(hypo72.ok, true, `hypo_events not ok: ${JSON.stringify(hypo72)}`);
assert.equal(hypo72.mock, false, "hypo_events must be in LIVE mode for this case");
assert.equal(typeof hypo72.hours_covered, "number", "cgm_hypo_events must declare hours_covered");
assert.ok(
  hypo72.hours_covered > 10 && hypo72.hours_covered <= 13,
  `hypo_events hours_covered should be the real ~12h span, got ${hypo72.hours_covered}`,
);
assert.ok(
  hypo72.hours_requested >= 71 && hypo72.hours_requested <= 72,
  `hypo_events must report the requested span too, got ${hypo72.hours_requested}`,
);
assert.equal(
  hypo72.window_truncated_by_provider,
  true,
  "hypo_events must flag that the provider could not cover the requested 72h",
);
assert.ok(
  hypo72.observed_window && typeof hypo72.observed_window.start === "string",
  "hypo_events must keep observed_window",
);
assert.equal(
  typeof hypo72.observed_window.hours,
  "number",
  "hypo_events observed_window must carry hours (days alone cannot express a 12h span)",
);
// The compatibility decision under test: hypo_events merges the engine's
// day-based window with the hour-based coverage. Dropping either half changes
// the payload shape for consumers — this pins both.
assertObservedWindowShape(hypo72, "cgm_hypo_events(72h ask, live libre)", { days: true });
assert.equal(
  hypo72.observed_window.hours,
  hypo72.hours_covered,
  "hypo_events observed_window.hours must be the covered span, not the requested one",
);
assert.ok(hasTruncationNote(hypo72), `cgm_hypo_events must emit a coverage note; got ${JSON.stringify(hypo72.notes)}`);
console.log(
  `✓ cgm_hypo_events(72h ask, live libre): hours_covered=${hypo72.hours_covered} truncated=${hypo72.window_truncated_by_provider} + note`,
);

// The compact shape drops the per-event array — coverage must survive it.
const hypo72Summary = await call(live, "cgm_hypo_events", {
  from: hypoFrom,
  to: hypoTo,
  response_format: "summary",
});
assert.equal(hypo72Summary.events, undefined, "summary format still omits the event array");
assert.equal(
  typeof hypo72Summary.hours_covered,
  "number",
  "hypo_events response_format=summary must still declare hours_covered",
);
assert.ok(hasTruncationNote(hypo72Summary), "hypo_events response_format=summary must still emit the coverage note");
assertObservedWindowShape(hypo72Summary, "cgm_hypo_events(response_format=summary)", { days: true });

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

const mockHypo = await call(mock, "cgm_hypo_events", {
  from: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
  to: new Date().toISOString(),
});
assert.equal(mockHypo.ok, true);
assert.equal(mockHypo.mock, true);
assert.ok(mockHypo.hours_covered > 71, `mock hypo_events must genuinely cover ~72h, got ${mockHypo.hours_covered}`);
assert.equal(mockHypo.window_truncated_by_provider, false, "mock mode is not provider-truncated");
assertObservedWindowShape(mockHypo, "cgm_hypo_events(72h, mock)", { days: true });
assert.equal(hasTruncationNote(mockHypo), false, "mock hypo_events must NOT emit a truncation note");
console.log(`✓ mock hypo_events 72h stays honest: hours_covered=${mockHypo.hours_covered}, no note`);

// cgm_demo is documentation: its sample payload is what an agent reads to learn
// the contract. A sample without the coverage fields teaches the pre-0.5.0 shape.
const demo = await call(mock, "cgm_demo", {});
const demoSummary = demo.sample.cgm_daily_summary;
assert.equal(
  typeof demoSummary.hours_covered,
  "number",
  "cgm_demo sample.cgm_daily_summary must show hours_covered — it is the documented shape",
);
assert.ok(
  demoSummary.observed_window && typeof demoSummary.observed_window.start === "string",
  "cgm_demo sample.cgm_daily_summary must show observed_window",
);
assertObservedWindowShape(demoSummary, "cgm_demo sample.cgm_daily_summary");
assert.equal(demoSummary.window_truncated_by_provider, false, "the synthetic demo window is never truncated");
console.log(`✓ cgm_demo sample matches the live contract: hours_covered=${demoSummary.hours_covered}`);

await mock.close();

console.log("\nlibre window-coverage test passed.");
