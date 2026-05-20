#!/usr/bin/env node
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOLS = new Set([
  "cgm_agent_manifest",
  "cgm_authorize_url",
  "cgm_capabilities",
  "cgm_connection_status",
  "cgm_daily_summary",
  "cgm_data_inventory",
  "cgm_demo",
  "cgm_glucose_now",
  "cgm_glucose_window",
  "cgm_hypo_events",
  "cgm_meal_response",
  "cgm_onboarding",
  "cgm_privacy_audit",
  "cgm_profile_get",
  "cgm_profile_update",
  "cgm_quickstart",
  "cgm_time_in_range",
]);

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, WELLNESS_CGM_QUIET: "1" },
});
const client = new Client({ name: "wellness-cgm-smoke", version: "0.0.1" }, { capabilities: {} });

await client.connect(transport);
const { tools } = await client.listTools();
const got = new Set(tools.map((t) => t.name));
for (const expected of EXPECTED_TOOLS) {
  assert.ok(got.has(expected), `missing tool: ${expected}`);
}
console.log(`✓ all ${EXPECTED_TOOLS.size} tools registered`);

const manifest = JSON.parse((await client.callTool({ name: "cgm_agent_manifest", arguments: {} })).content[0].text);
assert.equal(manifest.name, "wellness-cgm-mcp");
console.log("✓ cgm_agent_manifest valid");

const status = JSON.parse((await client.callTool({ name: "cgm_connection_status", arguments: {} })).content[0].text);
assert.equal(status.ok, true);
assert.ok(status.mode === "mock" || status.mode === "live");
console.log(`✓ cgm_connection_status reports mode=${status.mode}`);

const now = JSON.parse((await client.callTool({ name: "cgm_glucose_now", arguments: {} })).content[0].text);
assert.equal(now.ok, true);
assert.ok(now.latest);
assert.ok(now.latest.mgdl > 40 && now.latest.mgdl < 400, `unexpected mgdl=${now.latest.mgdl}`);
console.log(`✓ cgm_glucose_now returns mgdl=${now.latest.mgdl} (mock=${now.mock})`);

const summary = JSON.parse((await client.callTool({ name: "cgm_daily_summary", arguments: {} })).content[0].text);
assert.equal(summary.ok, true);
assert.ok(summary.summary.gmi_pct > 0);
assert.ok(summary.summary.diabetic_tir.in_range_pct >= 0);
console.log(
  `✓ cgm_daily_summary (mock=${summary.mock}) mean=${summary.summary.mean_mgdl} GMI=${summary.summary.gmi_pct}% TIR70-180=${summary.summary.diabetic_tir.in_range_pct}%`,
);

// Use a 2-hour-ago meal time + the default 4-hour window so the synthetic series covers it.
const meal = JSON.parse(
  (
    await client.callTool({
      name: "cgm_meal_response",
      arguments: {
        meal_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        window_hours: 6,
      },
    })
  ).content[0].text,
);
assert.equal(meal.ok, true, `meal_response not ok: ${JSON.stringify(meal)}`);
assert.ok(["excellent", "good", "moderate", "poor"].includes(meal.response?.band), `unexpected band: ${meal.response?.band}`);
console.log(`✓ cgm_meal_response (mock=${meal.mock}) band=${meal.response.band}`);

const inv = JSON.parse((await client.callTool({ name: "cgm_data_inventory", arguments: {} })).content[0].text);
assert.ok(inv.metrics.length >= 5);
console.log("✓ cgm_data_inventory lists ≥5 metrics");

const privacy = JSON.parse((await client.callTool({ name: "cgm_privacy_audit", arguments: {} })).content[0].text);
assert.ok(privacy.local_storage.includes("wellness-cgm"));
console.log("✓ cgm_privacy_audit returns local-storage path");

const auth = JSON.parse((await client.callTool({ name: "cgm_authorize_url", arguments: {} })).content[0].text);
// Without DEXCOM_CLIENT_ID this should report ok: false but cleanly with a hint
assert.ok(typeof auth.ok === "boolean");
if (!auth.ok) {
  assert.ok(auth.hint, "missing-creds case should include a hint");
  assert.ok(auth.recommended_redirect, "missing-creds case should suggest a redirect URI");
}
console.log(`✓ cgm_authorize_url returns ok=${auth.ok} (with hint when missing creds)`);

const quickstart = JSON.parse((await client.callTool({ name: "cgm_quickstart", arguments: {} })).content[0].text);
assert.equal(quickstart.ok, true);
assert.ok(Array.isArray(quickstart.steps) && quickstart.steps.length === 3);
assert.ok(["mock", "live"].includes(quickstart.current_mode));
console.log(`✓ cgm_quickstart returns 3-step walkthrough (mode=${quickstart.current_mode})`);

const demo = JSON.parse((await client.callTool({ name: "cgm_demo", arguments: {} })).content[0].text);
assert.equal(demo.is_demo, true);
assert.ok(demo.sample.cgm_glucose_now);
assert.ok(demo.sample.cgm_daily_summary);
assert.ok(demo.sample.cgm_meal_response);
console.log(`✓ cgm_demo returns 3 sample payloads`);

// --- cgm_time_in_range: full-window default ---
const tirFull = JSON.parse(
  (await client.callTool({ name: "cgm_time_in_range", arguments: {} })).content[0].text,
);
assert.equal(tirFull.ok, true);
assert.equal(tirFull.target_range.low, 70);
assert.equal(tirFull.target_range.high, 180);
assert.ok(tirFull.tir.count > 0, "default TIR should have readings");
assert.ok(tirFull.tir.in_range_pct >= 0 && tirFull.tir.in_range_pct <= 100);
console.log(
  `✓ cgm_time_in_range (full window, ADA 70-180): count=${tirFull.tir.count}, in_range=${tirFull.tir.in_range_pct}%`,
);

// --- cgm_time_in_range: explicit time window (last 3 hours) ---
const startTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const endTime = new Date().toISOString();
const tirWindow = JSON.parse(
  (await client.callTool({
    name: "cgm_time_in_range",
    arguments: { start_time: startTime, end_time: endTime },
  })).content[0].text,
);
assert.equal(tirWindow.ok, true);
assert.ok(tirWindow.tir.count > 0, "3-hour window should contain readings");
assert.ok(
  tirWindow.tir.count < tirFull.tir.count,
  `3-hour window count (${tirWindow.tir.count}) should be less than full window (${tirFull.tir.count})`,
);
assert.equal(tirWindow.requested_window.start_time, startTime);
assert.equal(tirWindow.requested_window.end_time, endTime);
console.log(
  `✓ cgm_time_in_range (3h window): count=${tirWindow.tir.count} (vs full ${tirFull.tir.count})`,
);

// --- cgm_time_in_range: tight target range surfaces lower in-range % ---
const tirTight = JSON.parse(
  (await client.callTool({
    name: "cgm_time_in_range",
    arguments: { target_low: 80, target_high: 110 },
  })).content[0].text,
);
assert.equal(tirTight.ok, true);
assert.equal(tirTight.target_range.low, 80);
assert.equal(tirTight.target_range.high, 110);
// Tight 80-110 should yield lower or equal in-range % than default 70-180.
assert.ok(
  tirTight.tir.in_range_pct <= tirFull.tir.in_range_pct,
  `tight range in_range_pct (${tirTight.tir.in_range_pct}) should be <= default (${tirFull.tir.in_range_pct})`,
);
console.log(
  `✓ cgm_time_in_range (custom range 80-110): in_range=${tirTight.tir.in_range_pct}% vs default ${tirFull.tir.in_range_pct}%`,
);

// --- cgm_time_in_range: out-of-data window returns count=0 + helpful note ---
const tirEmpty = JSON.parse(
  (await client.callTool({
    name: "cgm_time_in_range",
    arguments: {
      start_time: "2020-01-01T00:00:00Z",
      end_time: "2020-01-01T01:00:00Z",
    },
  })).content[0].text,
);
assert.equal(tirEmpty.ok, true);
assert.equal(tirEmpty.tir.count, 0, "ancient window should have no readings");
assert.equal(
  tirEmpty.tir.readings_in_window,
  0,
  "empty window should report readings_in_window=0",
);
assert.ok(tirEmpty.tir.total_readings > 0, "total_readings should reflect data loaded pre-filter");
assert.equal(tirEmpty.tir.mean_glucose, 0, "mean_glucose should be 0 for empty window");
assert.equal(tirEmpty.tir.median_glucose, 0, "median_glucose should be 0 for empty window");
assert.equal(tirEmpty.tir.gmi, 0, "gmi should be 0 for empty window");
assert.ok(
  tirEmpty.notes.some((n) => /widen|window/i.test(n)),
  "empty window should include a guidance note",
);
console.log(`✓ cgm_time_in_range (empty window): readings_in_window=0 + guidance note + no crash`);

// --- cgm_time_in_range: explicit numeric fields (total_readings, readings_in_window, mean, median, gmi) ---
assert.equal(tirFull.tir.total_readings, tirFull.tir.readings_in_window, "all-data: total === in_window");
assert.ok(tirFull.tir.mean_glucose > 0, "mean_glucose populated");
assert.ok(tirFull.tir.median_glucose > 0, "median_glucose populated");
assert.ok(tirFull.tir.gmi > 0, "gmi populated");
// GMI sanity: ADA Bergenstal 2018 formula → 3.31 + 0.02392 * mean
const expectedGmi = Math.round((3.31 + 0.02392 * tirFull.tir.mean_glucose) * 100) / 100;
assert.equal(
  tirFull.tir.gmi,
  expectedGmi,
  `gmi ${tirFull.tir.gmi} should match ADA formula 3.31 + 0.02392 × ${tirFull.tir.mean_glucose} = ${expectedGmi}`,
);
console.log(
  `✓ cgm_time_in_range numeric fields: total=${tirFull.tir.total_readings}, mean=${tirFull.tir.mean_glucose}, median=${tirFull.tir.median_glucose}, gmi=${tirFull.tir.gmi}`,
);

// --- cgm_time_in_range: time_window="wake" vs "all" differ when overnight readings exist ---
const tirWake = JSON.parse(
  (await client.callTool({ name: "cgm_time_in_range", arguments: { time_window: "wake" } })).content[0]
    .text,
);
const tirSleep = JSON.parse(
  (await client.callTool({ name: "cgm_time_in_range", arguments: { time_window: "sleep" } })).content[0]
    .text,
);
assert.equal(tirWake.ok, true);
assert.equal(tirSleep.ok, true);
assert.equal(tirWake.tir.hour_of_day_filter?.preset, "wake");
assert.equal(tirSleep.tir.hour_of_day_filter?.preset, "sleep");
// wake-window readings + sleep-window readings should sum to roughly the all-day count
// (small tolerance for exact boundary readings at 06:00 / 22:00).
assert.ok(
  Math.abs(tirWake.tir.readings_in_window + tirSleep.tir.readings_in_window - tirFull.tir.readings_in_window) <= 2,
  `wake (${tirWake.tir.readings_in_window}) + sleep (${tirSleep.tir.readings_in_window}) should ≈ all (${tirFull.tir.readings_in_window})`,
);
console.log(
  `✓ cgm_time_in_range wake/sleep split: wake=${tirWake.tir.readings_in_window} sleep=${tirSleep.tir.readings_in_window} all=${tirFull.tir.readings_in_window}`,
);

// --- cgm_time_in_range: explicit start_hour/end_hour overrides preset ---
const tirCustomHours = JSON.parse(
  (await client.callTool({
    name: "cgm_time_in_range",
    arguments: { start_hour: 8, end_hour: 12 },
  })).content[0].text,
);
assert.equal(tirCustomHours.ok, true);
assert.equal(tirCustomHours.tir.hour_of_day_filter?.start_hour, 8);
assert.equal(tirCustomHours.tir.hour_of_day_filter?.end_hour, 12);
console.log(
  `✓ cgm_time_in_range custom hours 08-12: readings_in_window=${tirCustomHours.tir.readings_in_window}`,
);

// --- GMI formula spot-check: pure-math test (not via tool) ---
// ADA / Bergenstal 2018: GMI(%) = 3.31 + 0.02392 × mean_glucose_mg_dL
// At mean=154 mg/dL → GMI ≈ 3.31 + 0.02392 * 154 = 3.31 + 3.68368 ≈ 6.99368 → rounds to 6.99
// At mean=183 mg/dL → GMI ≈ 3.31 + 0.02392 * 183 ≈ 7.68 (matches Bergenstal table)
const gmi154 = Math.round((3.31 + 0.02392 * 154) * 100) / 100;
const gmi183 = Math.round((3.31 + 0.02392 * 183) * 100) / 100;
assert.equal(gmi154, 6.99, `GMI at 154 mg/dL should be 6.99 (got ${gmi154})`);
assert.ok(gmi183 >= 7.6 && gmi183 <= 7.75, `GMI at 183 mg/dL should be ~7.68 (got ${gmi183})`);
console.log(`✓ GMI formula (ADA Bergenstal 2018): mean=154→GMI=${gmi154}, mean=183→GMI=${gmi183}`);

// --- cgm_hypo_events: registered, returns medical_disclaimer, schema-correct ---
const hypoSmoke = JSON.parse(
  (
    await client.callTool({
      name: "cgm_hypo_events",
      arguments: {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
      },
    })
  ).content[0].text,
);
assert.equal(hypoSmoke.ok, true, `hypo events tool not ok: ${JSON.stringify(hypoSmoke)}`);
assert.ok(typeof hypoSmoke.medical_disclaimer === "string", "medical_disclaimer should be a string");
assert.ok(/NOT medical advice/i.test(hypoSmoke.medical_disclaimer), "disclaimer should warn NOT medical advice");
assert.ok(Array.isArray(hypoSmoke.events), "events should be an array");
assert.equal(typeof hypoSmoke.total_events, "number");
assert.equal(typeof hypoSmoke.total_minutes_below, "number");
assert.equal(typeof hypoSmoke.mean_min_glucose, "number");
assert.equal(typeof hypoSmoke.events_per_day, "number");
assert.equal(typeof hypoSmoke.summary, "string");
assert.ok(Array.isArray(hypoSmoke.recommendations));
assert.equal(hypoSmoke.thresholds.level_1_mg_dl, 70);
assert.equal(hypoSmoke.thresholds.level_2_mg_dl, 54);
console.log(`✓ cgm_hypo_events registered + medical_disclaimer present (total_events=${hypoSmoke.total_events})`);

// --- cgm_hypo_events: response_format="summary" drops events array ---
const hypoSummary = JSON.parse(
  (
    await client.callTool({
      name: "cgm_hypo_events",
      arguments: {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
        response_format: "summary",
      },
    })
  ).content[0].text,
);
assert.equal(hypoSummary.ok, true);
assert.equal(hypoSummary.events, undefined, "response_format=summary should drop events array");
console.log("✓ cgm_hypo_events response_format=summary drops events array");

// --- cgm_hypo_events: invalid window rejected ---
const hypoBad = JSON.parse(
  (
    await client.callTool({
      name: "cgm_hypo_events",
      arguments: { from: "not-a-date", to: new Date().toISOString() },
    })
  ).content[0].text,
);
assert.equal(hypoBad.ok, false, "invalid from should be rejected");
console.log("✓ cgm_hypo_events rejects invalid window");

// --- detectHypoEvents pure-function test: synthetic stream with known events ---
const { detectHypoEvents } = await import("../dist/services/glucose-engine.js");
const synth = [];
const t0 = Date.parse("2026-05-01T00:00:00Z");
function r(min, mg) { synth.push({ timestamp: new Date(t0 + min * 60_000).toISOString(), mgdl: mg }); }
// 00:00 - 00:30 normal (in range)
for (let m = 0; m <= 30; m += 5) r(m, 95);
// 00:35 - 00:55 Level 1 hypo lasting 20 min (5 readings at 5-min intervals: 35,40,45,50,55)
for (let m = 35; m <= 55; m += 5) r(m, 65);
// 01:00 - 01:30 recovery — back in range
for (let m = 60; m <= 90; m += 5) r(m, 105);
// 02:00 - 02:18 Level 2 hypo lasting 18 min (~4 readings starting at 120: 120,125,130,135,138)
for (const m of [120, 125, 130, 135, 138]) r(m, 50);
// 02:20 - 03:00 recovery again
for (let m = 140; m <= 180; m += 5) r(m, 110);
// 03:10 brief 10-min spike below 70 (should NOT count — too short for default 15-min min)
for (const m of [190, 195, 200]) r(m, 65); // 10 minute span = does NOT meet min_duration_minutes default
for (let m = 205; m <= 240; m += 5) r(m, 100);

const detected = detectHypoEvents(synth, {
  from: "2026-05-01T00:00:00Z",
  to: "2026-05-01T04:00:00Z",
});
assert.equal(detected.total_events, 2, `expected 2 events (Level 1 + Level 2), got ${detected.total_events}`);
assert.equal(detected.events[0].severity, "level_1", `first event should be level_1, got ${detected.events[0].severity}`);
assert.equal(detected.events[0].duration_minutes, 20, `first event duration 20 min, got ${detected.events[0].duration_minutes}`);
assert.equal(detected.events[1].severity, "level_2", `second event should be level_2, got ${detected.events[1].severity}`);
assert.equal(detected.events[1].duration_minutes, 18, `second event duration 18 min, got ${detected.events[1].duration_minutes}`);
assert.equal(detected.events[0].min_glucose_mg_dl, 65);
assert.equal(detected.events[1].min_glucose_mg_dl, 50);
// Recovery: after first hypo (last reading 00:55 at 65), recovery target = 70+10=80, first reading at 01:00 is 105 → 5 min
assert.equal(detected.events[0].recovery_time_minutes, 5);
console.log(`✓ detectHypoEvents synthetic: 2 events (level_1 20min, level_2 18min); 10-min spike correctly ignored`);

// Edge: 10-min spike forced down to count → with min_duration_minutes=5 it should count
const detectedShort = detectHypoEvents(synth, {
  from: "2026-05-01T00:00:00Z",
  to: "2026-05-01T04:00:00Z",
  min_duration_minutes: 5,
});
assert.ok(detectedShort.total_events >= 3, `with min_duration=5 should now catch the brief spike (got ${detectedShort.total_events})`);
console.log(`✓ detectHypoEvents min_duration_minutes=5 catches the brief 10-min spike (total=${detectedShort.total_events})`);

// Edge: empty stream
const empty = detectHypoEvents([], { from: "2026-05-01T00:00:00Z", to: "2026-05-02T00:00:00Z" });
assert.equal(empty.total_events, 0);
assert.ok(/No hypoglycemia events detected/i.test(empty.summary));
console.log("✓ detectHypoEvents empty stream → 0 events + clean summary");

await client.close();
console.log("\nall smoke checks passed.");
