import { Hono } from "hono";
import type { Env } from "../env";
import type { MarketSnapshot } from "@skim/shared";
import { buildDepthSvg, renderDepthPng } from "../data/depth-chart";

export const markets = new Hono<{ Bindings: Env }>();

markets.get("/", async (c) => {
  // Read every market:*:snapshot key from KV. For now returns what's there.
  const list = await c.env.CACHE.list({ prefix: "market:" });
  const snapshots: MarketSnapshot[] = [];

  for (const k of list.keys) {
    if (!k.name.endsWith(":snapshot")) continue;
    const raw = await c.env.CACHE.get(k.name, "json");
    if (raw) snapshots.push(raw as MarketSnapshot);
  }

  snapshots.sort((a, b) => b.volume_24h_usd - a.volume_24h_usd);
  return c.json({ count: snapshots.length, snapshots });
});

markets.get("/:id", async (c) => {
  const id = c.req.param("id");
  const snapshot = await c.env.CACHE.get(`market:${id}:snapshot`, "json");
  if (!snapshot) return c.json({ error: "not_found" }, 404);
  return c.json(snapshot);
});

// SVG variant of the depth chart — fast, no WASM, directly renderable in
// the browser. Used by the dashboard to show "what Opus 4.7 is seeing".
markets.get("/:id/depth.svg", async (c) => {
  const id = c.req.param("id");
  const snap = await c.env.CACHE.get<MarketSnapshot>(
    `market:${id}:snapshot`,
    "json",
  );
  if (!snap) return c.text("not_found", 404);
  return new Response(buildDepthSvg(snap), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});

// PNG variant — the exact bytes that are attached to Alpha's message.
markets.get("/:id/depth.png", async (c) => {
  const id = c.req.param("id");
  const snap = await c.env.CACHE.get<MarketSnapshot>(
    `market:${id}:snapshot`,
    "json",
  );
  if (!snap) return c.text("not_found", 404);
  try {
    const png = await renderDepthPng(snap);
    const bytes = Uint8Array.from(atob(png.base64), (ch) => ch.charCodeAt(0));
    return new Response(bytes, {
      headers: {
        "Content-Type": png.mime,
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    return c.json({ error: "render_failed", message: String(err) }, 500);
  }
});
