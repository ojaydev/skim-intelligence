# Bayse Relay

Tiny Node service that holds the upstream Bayse WebSocket and forwards orderbook updates to the Skim worker.

## Why this exists

Bayse's WAF returns 403 on signed REST requests from Cloudflare egress and silently drops `subscribe` frames on its WebSocket. Running this relay on a non-blocked IP (residential VPS, home server, your laptop) is the production fix for getting Bayse data into the worker without depending on a dashboard browser tab.

## Quick start

```bash
cd apps/relay
cp .env.example .env
# Fill in BAYSE_PUBLIC_API_KEY, BAYSE_API_SECRET, WORKER_URL, RELAY_SECRET

npm install            # or: pnpm install
node --env-file=.env index.mjs
```

You should see:

```
relay: fetching Bayse events…
relay: seeded N events / M markets
relay: opening Bayse WS for K markets…
relay: WS open, awaiting connected frame
relay: subscribing to orderbook channel
```

Confirm health:

```bash
curl localhost:3000/healthz
```

## Required env vars

| Var | Notes |
|---|---|
| `BAYSE_PUBLIC_API_KEY` | Same key the worker uses |
| `BAYSE_API_SECRET` | Same secret the worker uses |
| `WORKER_URL` | `https://skim-intelligence.<account>.workers.dev` |
| `RELAY_SECRET` | Shared with worker. Generate: `openssl rand -hex 32` |

## Worker side

Set the matching secret on the worker:

```bash
cd apps/worker
wrangler secret put RELAY_SECRET
# paste the same value you used in apps/relay/.env
```

Once `RELAY_SECRET` is set on the worker, the seed and orderbook ingest endpoints reject any request without a matching `X-Relay-Auth` header. The browser bridge (`useBayseBridge`) will stop being able to push data — that's intentional. The relay is now the single source of truth for Bayse.

## Hosting

The relay needs an IP that Bayse hasn't blocked. Cloud regions in major hyperscalers (AWS, GCP, Azure, Cloudflare) are commonly blocked by trading APIs. Safer hosts:

- A residential VPS provider (Contabo, OVH bare metal, etc.)
- A home server / Raspberry Pi behind a residential connection
- A laptop you keep awake (fragile but works for a demo)

Verify before relying on it: from the host, run `curl https://relay.bayse.markets/health` and ensure you don't get a 403/blocked response.

## systemd unit

```ini
[Unit]
Description=Bayse Relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/bayse-relay
EnvironmentFile=/opt/bayse-relay/.env
ExecStart=/usr/bin/node index.mjs
Restart=always
RestartSec=5
User=relay

[Install]
WantedBy=multi-user.target
```

## /healthz fields

```json
{
  "ok": true,
  "ws_connected": true,
  "markets_subscribed": 10,
  "frames_received": 1284,
  "frames_forwarded": 532,
  "frames_dropped_debounce": 752,
  "seed_age_ms": 720000,
  "last_frame_age_ms": 124,
  "last_error": null
}
```

`ok` is `true` when the WS is connected and we received a frame within the last 60s. Wire this into your monitoring (UptimeRobot, BetterStack, etc.) if you care about uptime.

## Troubleshooting

- **`bayse_rest_403`** — your host IP is blocked by Bayse. Try a different egress.
- **`worker_401: unauthorized`** — `RELAY_SECRET` mismatch between relay and worker.
- **`worker_404: unknown_market`** — race between seed write and frame arrival; should self-heal on the next frame.
- **WS connects but `frames_received: 0`** — Bayse silently dropping subscribes. Likely the host IP is partially blocked. Try a different egress.
