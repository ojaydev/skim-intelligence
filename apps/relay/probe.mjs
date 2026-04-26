// One-shot WS probe — connects to Bayse, then tries each subscribe channel in
// sequence (5s apart), printing every frame received. Used to isolate which
// channel (if any) is reachable from this egress IP.
//
// Run:  node --env-file=.env probe.mjs
// Needs the same BAYSE_PUBLIC_API_KEY / BAYSE_API_SECRET as the relay.

import { createHmac, createHash } from "node:crypto";
import WebSocket from "ws";

const KEY = process.env.BAYSE_PUBLIC_API_KEY;
const SECRET = process.env.BAYSE_API_SECRET;
if (!KEY || !SECRET) {
  console.error("probe: missing BAYSE_PUBLIC_API_KEY / BAYSE_API_SECRET");
  process.exit(1);
}

const REST = "https://relay.bayse.markets";
const WS_URL = "wss://socket.bayse.markets/ws/v1/markets";

function sign(method, path, body = "") {
  const ts = Math.floor(Date.now() / 1000);
  const bodyHash = body
    ? createHash("sha256").update(body).digest("hex")
    : "";
  const payload = `${ts}.${method.toUpperCase()}.${path}.${bodyHash}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64");
  return {
    "X-Public-Key": KEY,
    "X-Timestamp": String(ts),
    "X-Signature": sig,
  };
}

async function fetchEventsSample() {
  const path = "/v1/pm/events";
  const res = await fetch(REST + path, { headers: sign("GET", path) });
  if (!res.ok) throw new Error(`rest_${res.status}`);
  const j = await res.json();
  const events = (j.events ?? []).filter(
    (e) => e.status === "open" && (e.markets ?? []).length > 0,
  );
  if (events.length === 0) throw new Error("no_open_events");
  const top = events[0];
  const marketIds = events
    .flatMap((e) => (e.markets ?? []).map((m) => m.id))
    .slice(0, 10);
  return { eventId: top.id, eventTitle: top.title, marketIds };
}

(async () => {
  console.log("probe: fetching seed for IDs…");
  const { eventId, eventTitle, marketIds } = await fetchEventsSample();
  console.log(`probe: eventId=${eventId} (${eventTitle})`);
  console.log(`probe: marketIds[0..2]=${marketIds.slice(0, 3).join(", ")}…`);

  const trials = [
    { label: "prices", payload: { type: "subscribe", channel: "prices", eventId } },
    { label: "orderbook", payload: { type: "subscribe", channel: "orderbook", marketIds } },
    { label: "activity", payload: { type: "subscribe", channel: "activity", eventId } },
    { label: "asset_prices", payload: { type: "subscribe", channel: "asset_prices", symbols: ["BTCUSDT"] } },
  ];

  const ws = new WebSocket(WS_URL);
  ws.on("open", () => console.log("probe: WS open"));
  ws.on("message", (data) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t) console.log("← RX:", t.slice(0, 400));
    }
  });
  ws.on("close", (c, r) => console.log("probe: WS close", c, String(r).slice(0, 80)));
  ws.on("error", (e) => console.log("probe: WS error", e.message));

  // Wait for `connected`, then run trials sequentially
  await new Promise((resolve) => {
    const handler = (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      if (raw.includes('"type":"connected"')) {
        ws.off("message", handler);
        resolve();
      }
    };
    ws.on("message", handler);
    setTimeout(resolve, 8000); // failsafe
  });

  for (const t of trials) {
    console.log(`\nprobe: → trying channel=${t.label}`);
    console.log("→ TX:", JSON.stringify(t.payload));
    ws.send(JSON.stringify(t.payload));
    await new Promise((r) => setTimeout(r, 6000));
  }

  console.log("\nprobe: closing");
  ws.close();
  setTimeout(() => process.exit(0), 500);
})().catch((err) => {
  console.error("probe: fatal", err);
  process.exit(1);
});
