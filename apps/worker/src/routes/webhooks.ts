import { Hono } from "hono";
import type { Env } from "../env";
import { verifyWebhookSignature } from "../data/paystack";

export const webhooks = new Hono<{ Bindings: Env }>();

// ─── Paystack webhook ─────────────────────────────────────────────────
// Docs: https://paystack.com/docs/payments/webhooks
// Events of interest:
//   charge.success  → deposit completed → credit wallet
//   transfer.success → withdrawal completed
//   transfer.failed  → refund + mark withdrawal failed

webhooks.post("/paystack", async (c) => {
  const sig = c.req.header("x-paystack-signature") ?? "";
  const raw = await c.req.text();

  const ok = await verifyWebhookSignature(c.env, raw, sig);
  if (!ok) {
    console.warn("paystack webhook: bad signature");
    return c.json({ error: "bad_signature" }, 401);
  }

  let payload: {
    event: string;
    data: {
      reference?: string;
      transfer_code?: string;
      status?: string;
      amount?: number;
      metadata?: Record<string, unknown>;
      customer?: { email?: string };
    };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "bad_payload" }, 400);
  }

  switch (payload.event) {
    case "charge.success":
      return handleChargeSuccess(c.env, payload.data);
    case "transfer.success":
      return handleTransferOutcome(c.env, payload.data, "completed");
    case "transfer.failed":
    case "transfer.reversed":
      return handleTransferOutcome(c.env, payload.data, "failed");
    default:
      // Return 200 so Paystack doesn't retry for events we ignore
      return c.json({ ok: true, ignored: payload.event });
  }
});

async function handleChargeSuccess(
  env: Env,
  data: {
    reference?: string;
    amount?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<Response> {
  if (!data.reference) return Response.json({ error: "missing_ref" }, { status: 400 });

  const deposit = await env.DB.prepare(
    `SELECT id, user_id, amount_usd, status FROM deposits WHERE paystack_reference = ?`,
  )
    .bind(data.reference)
    .first<{ id: string; user_id: string; amount_usd: number; status: string }>();

  if (!deposit) return Response.json({ ok: true, warning: "unknown_deposit" });
  if (deposit.status === "completed")
    return Response.json({ ok: true, note: "idempotent" });

  const now = new Date().toISOString();
  // Atomic-ish: update deposit → move pending → balance → ledger entry
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE deposits SET status = 'completed', completed_at = ? WHERE id = ?`,
    ).bind(now, deposit.id),
    env.DB.prepare(
      `UPDATE wallets
         SET balance_usd = balance_usd + ?,
             pending_usd = MAX(0, pending_usd - ?),
             updated_at = ?
         WHERE user_id = ?`,
    ).bind(deposit.amount_usd, deposit.amount_usd, now, deposit.user_id),
    env.DB.prepare(
      `INSERT INTO ledger_entries (user_id, entry_type, amount_usd, ref_id, description, created_at)
       VALUES (?, 'deposit', ?, ?, 'Paystack deposit', ?)`,
    ).bind(deposit.user_id, deposit.amount_usd, deposit.id, now),
  ]);

  return Response.json({ ok: true, credited: deposit.amount_usd });
}

async function handleTransferOutcome(
  env: Env,
  data: { transfer_code?: string; reference?: string },
  finalStatus: "completed" | "failed",
): Promise<Response> {
  const code = data.transfer_code;
  if (!code) return Response.json({ error: "missing_transfer_code" }, { status: 400 });

  const row = await env.DB.prepare(
    `SELECT id, user_id, amount_usd, status FROM withdrawals WHERE paystack_transfer_code = ?`,
  )
    .bind(code)
    .first<{ id: string; user_id: string; amount_usd: number; status: string }>();
  if (!row) return Response.json({ ok: true, warning: "unknown_transfer" });
  if (row.status === "completed" || row.status === "failed") {
    return Response.json({ ok: true, note: "idempotent" });
  }

  const now = new Date().toISOString();
  if (finalStatus === "failed") {
    // Refund the wallet + mark withdrawal failed
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE withdrawals SET status = 'failed', completed_at = ? WHERE id = ?`,
      ).bind(now, row.id),
      env.DB.prepare(
        `UPDATE wallets SET balance_usd = balance_usd + ?, updated_at = ? WHERE user_id = ?`,
      ).bind(row.amount_usd, now, row.user_id),
      env.DB.prepare(
        `INSERT INTO ledger_entries (user_id, entry_type, amount_usd, ref_id, description, created_at)
         VALUES (?, 'adjustment', ?, ?, 'Withdrawal failed — refunded', ?)`,
      ).bind(row.user_id, row.amount_usd, row.id, now),
    ]);
  } else {
    await env.DB.prepare(
      `UPDATE withdrawals SET status = 'completed', completed_at = ? WHERE id = ?`,
    )
      .bind(now, row.id)
      .run();
  }

  return Response.json({ ok: true, status: finalStatus });
}
