import type { Env } from "../env";

// ════════════════════════════════════════════════════════════════════════
// Paystack client — Nigerian-first payments.
// Docs: https://paystack.com/docs/api
//
// Transactions (deposits):
//   POST /transaction/initialize     → returns authorization_url for checkout
//   GET  /transaction/verify/:ref    → confirms state post-redirect
//   Webhook: event=charge.success    → credit wallet (signature HMAC-SHA512)
//
// Transfers (payouts):
//   POST /transferrecipient          → creates recipient (once per bank acct)
//   POST /transfer                   → initiates payout
//   Webhook: event=transfer.success
// ════════════════════════════════════════════════════════════════════════

const PAYSTACK_BASE = "https://api.paystack.co";

// Approximate USD↔NGN — replace with live FX in production.
export const USD_TO_NGN = 1600;

function paystackHeaders(env: Env, contentType = true): Record<string, string> {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new Error("paystack_not_configured");
  }
  const h: Record<string, string> = {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
  };
  if (contentType) h["Content-Type"] = "application/json";
  return h;
}

// ─── Transactions (Deposits) ───────────────────────────────────────────

export interface InitDepositInput {
  email: string;
  amountUsd: number;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitDepositResult {
  reference: string;
  authorization_url: string;
  access_code: string;
  amount_ngn: number;
}

export async function initDeposit(
  env: Env,
  input: InitDepositInput,
): Promise<InitDepositResult> {
  const amountKobo = Math.round(input.amountUsd * USD_TO_NGN * 100); // kobo
  const body = {
    email: input.email,
    amount: amountKobo,
    currency: "NGN",
    reference: input.reference,
    callback_url: input.callbackUrl,
    metadata: input.metadata,
  };
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: paystackHeaders(env),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`paystack_init_${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data: {
      authorization_url: string;
      access_code: string;
      reference: string;
    };
  };
  if (!json.status) throw new Error(`paystack_init_failed: ${json.message}`);
  return {
    reference: json.data.reference,
    authorization_url: json.data.authorization_url,
    access_code: json.data.access_code,
    amount_ngn: amountKobo / 100,
  };
}

export async function verifyDeposit(
  env: Env,
  reference: string,
): Promise<{
  status: string;
  amount_ngn: number;
  paid_at: string | null;
  customer_email?: string;
}> {
  const res = await fetch(
    `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: paystackHeaders(env, false),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error(`paystack_verify_${res.status}`);
  const json = (await res.json()) as {
    status: boolean;
    data: {
      status: string;
      amount: number;
      paid_at: string | null;
      customer: { email: string };
    };
  };
  return {
    status: json.data.status,
    amount_ngn: json.data.amount / 100,
    paid_at: json.data.paid_at,
    customer_email: json.data.customer?.email,
  };
}

// ─── Webhook verification ─────────────────────────────────────────────
// Paystack signs request bodies with HMAC-SHA512 using the SECRET_KEY.
// Header: `x-paystack-signature` (hex digest).

export async function verifyWebhookSignature(
  env: Env,
  rawBody: string,
  providedSig: string,
): Promise<boolean> {
  if (!env.PAYSTACK_SECRET_KEY) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const computed = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time-ish comparison
  if (computed.length !== providedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ providedSig.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Transfers (Payouts) ──────────────────────────────────────────────
// Note: requires an approved Paystack business account. For sandbox,
// these endpoints return 400s until activated.

export interface CreateRecipientInput {
  name: string;
  bankAccountNumber: string;
  bankCode: string;
}

export async function createTransferRecipient(
  env: Env,
  input: CreateRecipientInput,
): Promise<{ recipient_code: string }> {
  const res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
    method: "POST",
    headers: paystackHeaders(env),
    body: JSON.stringify({
      type: "nuban",
      name: input.name,
      account_number: input.bankAccountNumber,
      bank_code: input.bankCode,
      currency: "NGN",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as {
    status: boolean;
    data: { recipient_code: string };
    message?: string;
  };
  if (!json.status) throw new Error(`paystack_recipient: ${json.message}`);
  return { recipient_code: json.data.recipient_code };
}

export async function initiateTransfer(
  env: Env,
  input: {
    recipientCode: string;
    amountUsd: number;
    reference: string;
    reason?: string;
  },
): Promise<{ transfer_code: string; status: string }> {
  const amountKobo = Math.round(input.amountUsd * USD_TO_NGN * 100);
  const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
    method: "POST",
    headers: paystackHeaders(env),
    body: JSON.stringify({
      source: "balance",
      amount: amountKobo,
      recipient: input.recipientCode,
      reason: input.reason ?? "Skim withdrawal",
      reference: input.reference,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as {
    status: boolean;
    data: { transfer_code: string; status: string };
    message?: string;
  };
  if (!json.status) throw new Error(`paystack_transfer: ${json.message}`);
  return { transfer_code: json.data.transfer_code, status: json.data.status };
}
