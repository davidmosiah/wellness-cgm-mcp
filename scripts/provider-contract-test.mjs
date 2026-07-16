import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { DexcomClient } from "../dist/services/dexcom-client.js";
import { LibreLinkUpClient } from "../dist/services/librelink-client.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

{
  const calls = [];
  const client = new DexcomClient({
    env: "production",
    accessToken: "dex-secret",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ records: [{ systemTime: "2026-07-16T12:00:00Z", value: 111, trend: "flat", futureField: 7 }] });
    },
  });
  const records = await client.getEgvs("2026-07-16T08:00:00-03:00", "2026-07-16T09:00:00-03:00");
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://api.dexcom.com/v3/users/self/egvs");
  assert.equal(url.searchParams.get("startDate"), "2026-07-16T11:00:00.000Z");
  assert.equal(url.searchParams.get("endDate"), "2026-07-16T12:00:00.000Z");
  assert.equal(calls[0].init.headers.Authorization, "Bearer dex-secret");
  assert.deepEqual(records, [{ timestamp: "2026-07-16T12:00:00Z", mgdl: 111, trend: "flat" }]);
}

{
  let fetchCount = 0;
  const client = new DexcomClient({ accessToken: "dex-secret", fetchImpl: async () => {
    fetchCount += 1;
    return jsonResponse({ records: [] });
  } });
  await assert.rejects(client.getEgvs("not-a-date", "2026-07-16T12:00:00Z"), /valid ISO 8601 date-time/);
  await assert.rejects(client.getEgvs("2026-07-17T12:00:00Z", "2026-07-16T12:00:00Z"), /before endDate/);
  await assert.rejects(client.getEgvs("2026-06-01T12:00:00Z", "2026-07-16T12:00:00Z"), /30 days or less/);
  assert.equal(fetchCount, 0, "invalid Dexcom ranges must fail before network I/O");
}

{
  const calls = [];
  const client = new LibreLinkUpClient({
    token: "libre-secret",
    accountId: "account-123",
    region: "eu",
    patientId: "patient/a",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ data: { graphData: [{ Timestamp: "07/16/2026 10:00:00 AM", ValueInMgPerDl: 105, TrendArrow: 3 }] } });
    },
  });
  const records = await client.getGraph();
  assert.equal(calls[0].url, "https://api.libreview.io/llu/connections/patient%2Fa/graph");
  assert.equal(calls[0].init.headers.Authorization, "Bearer libre-secret");
  assert.equal(calls[0].init.headers["account-id"], createHash("sha256").update("account-123").digest("hex"));
  assert.equal(records[0].mgdl, 105);
  assert.equal(records[0].trend, "flat");
}

console.log("provider contract test passed (Dexcom v3 + LibreLink Up)");
