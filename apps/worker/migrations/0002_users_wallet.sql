-- Consumer layer: Clerk user sync + Paystack deposits/payouts + ledger

CREATE TABLE users (
  id          TEXT PRIMARY KEY,     -- Clerk user_id (e.g. user_2abc…)
  email       TEXT,
  display_name TEXT,
  image_url   TEXT,
  country     TEXT,
  created_at  TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE wallets (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  balance_usd  REAL NOT NULL DEFAULT 0,
  pending_usd  REAL NOT NULL DEFAULT 0,  -- deposits awaiting webhook
  updated_at   TEXT NOT NULL
);

CREATE TABLE deposits (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  paystack_reference  TEXT UNIQUE,
  amount_usd          REAL NOT NULL,
  amount_ngn          REAL,
  currency            TEXT NOT NULL DEFAULT 'NGN',
  status              TEXT NOT NULL,     -- pending | completed | failed
  authorization_url   TEXT,
  created_at          TEXT NOT NULL,
  completed_at        TEXT
);
CREATE INDEX idx_deposits_user ON deposits(user_id, created_at DESC);
CREATE INDEX idx_deposits_ref  ON deposits(paystack_reference);

CREATE TABLE withdrawals (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id),
  paystack_transfer_code  TEXT,
  amount_usd              REAL NOT NULL,
  amount_ngn              REAL,
  recipient_code          TEXT,     -- Paystack transferrecipient code
  bank_account_number     TEXT,
  bank_code               TEXT,
  status                  TEXT NOT NULL,  -- pending | otp_required | completed | failed
  reason                  TEXT,
  created_at              TEXT NOT NULL,
  completed_at            TEXT
);
CREATE INDEX idx_withdrawals_user ON withdrawals(user_id, created_at DESC);

CREATE TABLE ledger_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  entry_type  TEXT NOT NULL,      -- deposit | withdrawal | trade_pnl | reward | fee | adjustment
  amount_usd  REAL NOT NULL,      -- signed: + credits, − debits
  ref_id      TEXT,               -- FK into deposits/withdrawals/paper_fills etc.
  description TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_ledger_user ON ledger_entries(user_id, created_at DESC);
