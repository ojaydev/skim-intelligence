-- Skim Intelligence — initial schema (D1 / SQLite)
-- Generated: 2026-04-22

CREATE TABLE market_snapshots (
  id            TEXT PRIMARY KEY,
  market_id     TEXT NOT NULL,
  snapshot_data TEXT NOT NULL, -- JSON
  fetched_at    TEXT NOT NULL
);
CREATE INDEX idx_snapshots_market_fetched
  ON market_snapshots(market_id, fetched_at DESC);

CREATE TABLE signals (
  id                 TEXT PRIMARY KEY,
  market_id          TEXT NOT NULL,
  market_title       TEXT NOT NULL,
  opportunity_score  REAL,
  recommendation     TEXT NOT NULL,
  thinking           TEXT,
  reasoning_summary  TEXT,
  strategies_json    TEXT, -- JSON
  risk_flags_json    TEXT, -- JSON array
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_signals_created  ON signals(created_at DESC);
CREATE INDEX idx_signals_market   ON signals(market_id, created_at DESC);

CREATE TABLE risk_decisions (
  id                   TEXT PRIMARY KEY,
  signal_id            TEXT NOT NULL REFERENCES signals(id),
  decision             TEXT NOT NULL, -- approved | modified | rejected
  reason               TEXT,
  modifications_json   TEXT, -- JSON
  hard_limit_triggered TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX idx_risk_signal ON risk_decisions(signal_id);

CREATE TABLE paper_orders (
  id               TEXT PRIMARY KEY,
  signal_id        TEXT NOT NULL,
  risk_decision_id TEXT NOT NULL,
  market_id        TEXT NOT NULL,
  strategy         TEXT NOT NULL, -- mint_burn | market_making | reward_farming
  side             TEXT NOT NULL, -- yes_bid | yes_ask | no_bid | no_ask
  price            REAL NOT NULL,
  notional_usd     REAL NOT NULL,
  status           TEXT NOT NULL, -- open | filled | partial | cancelled
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_orders_market ON paper_orders(market_id, status);

CREATE TABLE paper_fills (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES paper_orders(id),
  fill_price        REAL NOT NULL,
  fill_notional_usd REAL NOT NULL,
  fee_usd           REAL NOT NULL,
  slippage_usd      REAL NOT NULL,
  filled_at         TEXT NOT NULL
);
CREATE INDEX idx_fills_order  ON paper_fills(order_id);
CREATE INDEX idx_fills_filled ON paper_fills(filled_at DESC);

CREATE TABLE paper_positions (
  id                 TEXT PRIMARY KEY,
  market_id          TEXT NOT NULL UNIQUE,
  yes_notional_usd   REAL NOT NULL DEFAULT 0,
  no_notional_usd    REAL NOT NULL DEFAULT 0,
  unrealized_pnl_usd REAL NOT NULL DEFAULT 0,
  realized_pnl_usd   REAL NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL
);

CREATE TABLE epoch_reports (
  id                TEXT PRIMARY KEY,
  epoch_start       TEXT NOT NULL,
  epoch_end         TEXT NOT NULL,
  headline          TEXT,
  attribution_json  TEXT, -- JSON
  top_markets_json  TEXT, -- JSON
  narrative         TEXT,
  share_card_json   TEXT, -- JSON
  net_pnl_usd       REAL,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_epoch_created ON epoch_reports(created_at DESC);

CREATE TABLE event_feed (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload    TEXT NOT NULL, -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_created ON event_feed(created_at DESC);
