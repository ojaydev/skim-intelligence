import { initWasm, Resvg } from "@resvg/resvg-wasm";
// Wrangler bundles .wasm imports as WebAssembly.Module via the default
// "CompiledWasm" rule (rules section, globs ['**/*.wasm']).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — Wrangler-handled side-effect-free module import
import resvgWasm from "./resvg.wasm";
import type { MarketSnapshot } from "@skim/shared";

// ════════════════════════════════════════════════════════════════════════
// Depth chart renderer — converts a MarketSnapshot into a PNG showing
// the shape of YES/NO liquidity. The resulting image is fed to Alpha as
// an image block so Opus 4.7 can visually reason about the order book
// shape, not just the raw numbers.
// ════════════════════════════════════════════════════════════════════════

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(resvgWasm as WebAssembly.Module);
  }
  return wasmReady;
}

export function buildDepthSvg(snap: MarketSnapshot): string {
  const W = 800;
  const H = 400;
  const MARGIN = { t: 36, r: 24, b: 48, l: 64 };
  const inner = { w: W - MARGIN.l - MARGIN.r, h: H - MARGIN.t - MARGIN.b };

  const bg = "#080808";
  const axis = "#1c1c1c";
  const grid = "#141414";
  const text = "#f7f4ef";
  const dim = "rgba(247,244,239,0.35)";
  const yesColor = "#3dffa0";
  const noColor = "#ff4e4e";
  const midLine = "#35e7ff";

  const yes = {
    bid: snap.best_bid,
    ask: snap.best_ask,
    bidDepth: snap.yes_bid_depth_usd,
    askDepth: snap.yes_ask_depth_usd,
  };
  const no = {
    bid: 1 - snap.best_ask,
    ask: 1 - snap.best_bid,
    bidDepth: snap.no_bid_depth_usd,
    askDepth: snap.no_ask_depth_usd,
  };

  // X axis: price 0..1. Y axis: USD depth.
  const maxDepth = Math.max(
    yes.bidDepth,
    yes.askDepth,
    no.bidDepth,
    no.askDepth,
    100,
  );

  const x = (p: number) => MARGIN.l + p * inner.w;
  const y = (depth: number) =>
    MARGIN.t + inner.h - (depth / maxDepth) * inner.h;

  // Gridlines
  const grids: string[] = [];
  for (let p = 0.1; p < 1; p += 0.1) {
    grids.push(
      `<line x1="${x(p)}" y1="${MARGIN.t}" x2="${x(p)}" y2="${MARGIN.t + inner.h}" stroke="${grid}" stroke-width="1" />`,
    );
  }
  for (let i = 1; i <= 4; i++) {
    const yp = MARGIN.t + (inner.h / 4) * i;
    grids.push(
      `<line x1="${MARGIN.l}" y1="${yp}" x2="${W - MARGIN.r}" y2="${yp}" stroke="${grid}" stroke-width="1" />`,
    );
  }

  // Depth bars (rendered as thin vertical rects at each price level).
  // We only have one-level granularity from the snapshot, so render each
  // as a wide column representing that cumulative depth.
  const barW = inner.w * 0.02;

  const bar = (
    price: number,
    depth: number,
    color: string,
    label: string,
  ) => {
    const cx = x(price);
    const yTop = y(depth);
    const height = MARGIN.t + inner.h - yTop;
    return `
<rect x="${cx - barW / 2}" y="${yTop}" width="${barW}" height="${height}" fill="${color}" fill-opacity="0.65" />
<text x="${cx}" y="${yTop - 6}" fill="${text}" font-family="monospace" font-size="10" text-anchor="middle">$${Math.round(depth).toLocaleString()}</text>
<text x="${cx}" y="${MARGIN.t + inner.h + 14}" fill="${dim}" font-family="monospace" font-size="10" text-anchor="middle">${label}@${price.toFixed(3)}</text>`;
  };

  // Mid-price line
  const midX = x(snap.mid_price);
  const midMarker = `
<line x1="${midX}" y1="${MARGIN.t}" x2="${midX}" y2="${MARGIN.t + inner.h}" stroke="${midLine}" stroke-width="1.2" stroke-dasharray="4,4" />
<text x="${midX}" y="${MARGIN.t - 8}" fill="${midLine}" font-family="monospace" font-size="11" text-anchor="middle">mid ${snap.mid_price.toFixed(3)}</text>`;

  // Axis labels
  const xLabels = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (p) =>
        `<text x="${x(p)}" y="${MARGIN.t + inner.h + 30}" fill="${dim}" font-family="monospace" font-size="10" text-anchor="middle">${p.toFixed(2)}</text>`,
    )
    .join("");
  const yLabels = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const val = maxDepth * f;
      return `<text x="${MARGIN.l - 8}" y="${MARGIN.t + inner.h - f * inner.h + 3}" fill="${dim}" font-family="monospace" font-size="10" text-anchor="end">$${Math.round(val).toLocaleString()}</text>`;
    })
    .join("");

  // Title + legend
  const title = escapeXml(snap.title.slice(0, 80));
  const subtitle = `spread ${(snap.spread_pct * 100).toFixed(2)}%  ·  vol24 $${Math.round(snap.volume_24h_usd).toLocaleString()}  ·  ${snap.data_quality}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="${bg}" />

  ${grids.join("")}
  <rect x="${MARGIN.l}" y="${MARGIN.t}" width="${inner.w}" height="${inner.h}" fill="none" stroke="${axis}" stroke-width="1" />

  ${bar(yes.bid, yes.bidDepth, yesColor, "YB")}
  ${bar(yes.ask, yes.askDepth, yesColor, "YA")}
  ${bar(no.bid, no.bidDepth, noColor, "NB")}
  ${bar(no.ask, no.askDepth, noColor, "NA")}

  ${midMarker}

  ${xLabels}
  ${yLabels}

  <text x="${MARGIN.l}" y="20" fill="${text}" font-family="Georgia,serif" font-size="13" font-weight="500">${title}</text>
  <text x="${W - MARGIN.r}" y="20" fill="${dim}" font-family="monospace" font-size="10" text-anchor="end">${subtitle}</text>

  <text x="${W - MARGIN.r}" y="${H - 10}" fill="${yesColor}" font-family="monospace" font-size="9" text-anchor="end">YES · green</text>
  <text x="${W - MARGIN.r - 90}" y="${H - 10}" fill="${noColor}" font-family="monospace" font-size="9" text-anchor="end">NO · red</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render the snapshot as a PNG (base64) for inclusion in Alpha's message.
 * Uses resvg-wasm which ships a pure-WASM SVG renderer compatible with
 * Cloudflare Workers.
 */
export async function renderDepthPng(
  snap: MarketSnapshot,
): Promise<{ base64: string; mime: "image/png" }> {
  await ensureWasm();
  const svg = buildDepthSvg(snap);
  const resvg = new Resvg(svg, {
    // Avoid font loads for speed — our labels use web-safe Georgia/monospace
    font: { loadSystemFonts: false },
    background: "#080808",
  });
  const pngData = resvg.render().asPng();
  const base64 = base64FromUint8(pngData);
  return { base64, mime: "image/png" };
}

function base64FromUint8(u8: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      Array.from(u8.subarray(i, i + CHUNK)),
    );
  }
  return btoa(s);
}
