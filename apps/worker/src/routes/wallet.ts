import { Hono } from "hono";
import { requireAuth, type AuthVars } from "../auth/clerk";
import type { Env } from "../env";
import {
  createTransferRecipient,
  initDeposit,
  initiateTransfer,
} from "../data/paystack";

export const wallet = new Hono<{ Bindings: Env; Variables: AuthVars }>();

// All wallet routes require a Clerk session.
wallet.use("*", requireAuth);

// ─── GET /api/wallet ───────────────────────────────────────────────────

wallet.get("/", async (c) => {
  const userId = c.get("userId");
  const w = await c.env.DB.prepare(
    `SELECT balance_usd, pending_usd, updated_at FROM wallets WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ balance_usd: number; pending_usd: number; updated_at: string }>();

  const deposits = await c.env.DB.prepare(
    `SELECT id, amount_usd, currency, status, created_at, completed_at
       FROM deposits WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(userId)
    .all();

  const withdrawals = await c.env.DB.prepare(
    `SELECT id, amount_usd, status, created_at, completed_at
       FROM withdrawals WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(userId)
    .all();

  const ledger = await c.env.DB.prepare(
    `SELECT id, entry_type, amount_usd, description, created_at
       FROM ledger_entries WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(userId)
    .all();

  return c.json({
    balance_usd: w?.balance_usd ?? 0,
    pending_usd: w?.pending_usd ?? 0,
    deposits: deposits.results,
    withdrawals: withdrawals.results,
    ledger: ledger.results,
  });
});

// ─── POST /api/wallet/deposits/init ────────────────────────────────────

wallet.post("/deposits/init", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ amount_usd: number; email: string }>();

  if (!body.amount_usd || body.amount_usd < 1) {
    return c.json({ error: "minimum_deposit_1_usd" }, 400);
  }
  if (!body.email) {
    return c.json({ error: "email_required" }, 400);
  }

  const depositId = crypto.randomUUID();
  const reference = `skim_dep_${depositId}`;

  try {
    const init = await initDeposit(c.env, {
      email: body.email,
      amountUsd: body.amount_usd,
      reference,
      metadata: { user_id: userId, deposit_id: depositId },
    });

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO deposits
        (id, user_id, paystack_reference, amount_usd, amount_ngn, currency, status, authorization_url, created_at)
       VALUES (?, ?, ?, ?, ?, 'NGN', 'pending', ?, ?)`,
    )
      .bind(
        depositId,
        userId,
        reference,
        body.amount_usd,
        init.amount_ngn,
        init.authorization_url,
        now,
      )
      .run();
    await c.env.DB.prepare(
      `UPDATE wallets SET pending_usd = pending_usd + ?, updated_at = ? WHERE user_id = ?`,
    )
      .bind(body.amount_usd, now, userId)
      .run();

    return c.json({
      deposit_id: depositId,
      authorization_url: init.authorization_url,
      reference,
      amount_ngn: init.amount_ngn,
    });
  } catch (err) {
    console.error("wallet: init deposit failed", err);
    return c.json({ error: "paystack_unavailable", message: String(err) }, 503);
  }
});

// ─── POST /api/wallet/withdraw ─────────────────────────────────────────
// Minimum viable — requires business Paystack account activation.

wallet.post("/withdraw", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    amount_usd: number;
    bank_account_number: string;
    bank_code: string;
    account_holder_name: string;
  }>();

  if (!body.amount_usd || body.amount_usd < 1)
    return c.json({ error: "minimum_withdraw_1_usd" }, 400);

  // Balance check
  const w = await c.env.DB.prepare(
    `SELECT balance_usd FROM wallets WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ balance_usd: number }>();
  if (!w || w.balance_usd < body.amount_usd) {
    return c.json({ error: "insufficient_balance", balance: w?.balance_usd ?? 0 }, 400);
  }

  const withdrawalId = crypto.randomUUID();
  const reference = `skim_wd_${withdrawalId}`;
  const now = new Date().toISOString();

  try {
    const recipient = await createTransferRecipient(c.env, {
      name: body.account_holder_name,
      bankAccountNumber: body.bank_account_number,
      bankCode: body.bank_code,
    });
    const transfer = await initiateTransfer(c.env, {
      recipientCode: recipient.recipient_code,
      amountUsd: body.amount_usd,
      reference,
    });

    await c.env.DB.prepare(
      `INSERT INTO withdrawals
        (id, user_id, paystack_transfer_code, amount_usd, recipient_code,
         bank_account_number, bank_code, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        withdrawalId,
        userId,
        transfer.transfer_code,
        body.amount_usd,
        recipient.recipient_code,
        body.bank_account_number,
        body.bank_code,
        transfer.status,
        now,
      )
      .run();

    // Debit wallet immediately; ledger entry
    await c.env.DB.prepare(
      `UPDATE wallets SET balance_usd = balance_usd - ?, updated_at = ? WHERE user_id = ?`,
    )
      .bind(body.amount_usd, now, userId)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO ledger_entries (user_id, entry_type, amount_usd, ref_id, description, created_at)
       VALUES (?, 'withdrawal', ?, ?, ?, ?)`,
    )
      .bind(
        userId,
        -body.amount_usd,
        withdrawalId,
        `Withdrawal to ****${body.bank_account_number.slice(-4)}`,
        now,
      )
      .run();

    return c.json({
      withdrawal_id: withdrawalId,
      status: transfer.status,
      reference,
    });
  } catch (err) {
    console.error("wallet: withdraw failed", err);
    return c.json(
      { error: "paystack_unavailable", message: String(err) },
      503,
    );
  }
});
