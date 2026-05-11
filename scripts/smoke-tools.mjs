#!/usr/bin/env node
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOLS = new Set([
  "cgm_agent_manifest",
  "cgm_capabilities",
  "cgm_connection_status",
  "cgm_privacy_audit",
  "cgm_data_inventory",
  "cgm_quickstart",
  "cgm_demo",
  "cgm_glucose_now",
  "cgm_glucose_window",
  "cgm_daily_summary",
  "cgm_meal_response",
  "cgm_authorize_url",
  "cgm_profile_get",
  "cgm_profile_update",
  "cgm_onboarding",
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

await client.close();
console.log("\nall smoke checks passed.");
