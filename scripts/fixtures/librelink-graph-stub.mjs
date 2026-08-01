/**
 * Test-only LibreLink Up network stub.
 *
 * Preloaded with `node --import` BEFORE dist/index.js boots, so the real
 * LibreLinkUpClient (which captures `globalThis.fetch` in its constructor)
 * talks to this instead of Abbott. That lets the gate exercise the LIVE Libre
 * code path — the one that silently truncated wide windows — with zero network
 * and zero real credentials.
 *
 * Everything here is SYNTHETIC: fake patient id, fake token, generated glucose
 * values. No real health export is ever used in a fixture.
 *
 * The stub reproduces the one behaviour that matters: /graph returns a fixed
 * trailing ~12h window (default; override with LIBRE_STUB_GRAPH_HOURS) no
 * matter how many hours the caller wanted — Abbott's endpoint takes no
 * start/end parameter.
 */
const GRAPH_HOURS = Number(process.env.LIBRE_STUB_GRAPH_HOURS ?? 12);
const INTERVAL_MIN = 5;

/**
 * LibreLink Up emits US-locale "MM/DD/YYYY h:mm:ss AM/PM" with NO timezone —
 * sensor-local wall-clock time, which the client parses in the host's zone.
 * The stub therefore formats with LOCAL components (like a sensor sitting next
 * to the user), so a point "N minutes ago" parses back to that same instant on
 * any machine. Formatting in UTC would shift the whole series by the host's
 * offset and make span assertions timezone-dependent.
 */
function libreTimestamp(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  const h = date.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");
  return `${mm}/${dd}/${yyyy} ${h12}:${min}:${sec} ${ampm}`;
}

function point(minutesAgo) {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  // Deterministic synthetic curve around 100 mg/dL — no real data, ever.
  const mgdl = Math.round(100 + Math.sin(minutesAgo / 45) * 18);
  return { Timestamp: libreTimestamp(d), ValueInMgPerDl: mgdl, TrendArrow: 3 };
}

function graphPayload() {
  const points = Math.round((GRAPH_HOURS * 60) / INTERVAL_MIN);
  const graphData = [];
  // Oldest first; the newest sample lives in `connection`, like the real API.
  for (let i = points; i >= 1; i--) graphData.push(point(i * INTERVAL_MIN));
  return {
    data: {
      connection: { glucoseMeasurement: point(0) },
      graphData,
    },
  };
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  if (!url.includes("libreview.io")) return realFetch(input, init);
  if (url.includes("/llu/auth/login")) {
    return json({
      status: 0,
      data: {
        authTicket: { token: "FIXTURE.NOT.A.REAL.TOKEN", expires: 0 },
        user: { id: "fixture-account-0000" },
      },
    });
  }
  if (url.includes("/graph")) return json(graphPayload());
  if (url.includes("/llu/connections")) {
    return json({ data: [{ patientId: "patient-fixture-0000", firstName: "Synthetic", lastName: "Fixture" }] });
  }
  throw new Error(`librelink-graph-stub: unexpected URL ${url}`);
};
