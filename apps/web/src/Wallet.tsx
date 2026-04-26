import { useCallback, useEffect, useState } from "react";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import { getWallet, initDeposit, type WalletState } from "./api";

/**
 * Wallet panel — signed-out shows CTA, signed-in shows balance + deposit form.
 * Safe to render even when Clerk isn't configured (falls through to unsigned view).
 */
export function WalletPanel() {
  return (
    <div className="panel span2">
      <div className="panel-header">
        <div className="panel-title">Wallet · Paystack</div>
        <div className="panel-meta">NGN → USD on-ramp</div>
      </div>
      <SignedOut>
        <WalletSignedOut />
      </SignedOut>
      <SignedIn>
        <WalletSignedIn />
      </SignedIn>
    </div>
  );
}

function WalletSignedOut() {
  return (
    <div className="panel-body">
      <div className="wallet-signed-out">
        <div style={{ marginBottom: 10, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.7 }}>
          Sign in to deposit funds via Paystack and track your paper-trading share of Skim's yield.
        </div>
        <SignInButton mode="modal">
          <button className="sign-in-btn">Sign in to open wallet</button>
        </SignInButton>
      </div>
    </div>
  );
}

function WalletSignedIn() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const w = await getWallet(token);
      setWallet(w);
    } catch (e) {
      setErr(String(e));
    }
  }, [getToken]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const onDeposit = useCallback(async () => {
    const usd = Number(amount);
    if (!usd || usd < 1) {
      setErr("minimum_1_usd");
      return;
    }
    const email = user?.primaryEmailAddress?.emailAddress;
    if (!email) {
      setErr("email_required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("no_token");
      const r = await initDeposit(token, usd, email);
      // Redirect to Paystack checkout
      window.location.href = r.authorization_url;
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }, [amount, user, getToken]);

  return (
    <div className="panel-body">
      <div className="wallet-balance">
        ${(wallet?.balance_usd ?? 0).toFixed(2)}
      </div>
      <div className="wallet-sub">
        balance
        {wallet?.pending_usd ? (
          <span style={{ color: "var(--amber)" }}>
            {" "}· ${wallet.pending_usd.toFixed(2)} pending
          </span>
        ) : null}
      </div>

      <div className="wallet-input-row">
        <input
          className="wallet-input"
          type="number"
          min="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="USD amount"
        />
        <button
          className="btn primary"
          onClick={onDeposit}
          disabled={busy || !user?.primaryEmailAddress?.emailAddress}
        >
          {busy ? "redirecting…" : "deposit via paystack"}
        </button>
      </div>

      {err && (
        <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 8 }}>
          {err}
        </div>
      )}

      <div style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.6 }}>
        Deposits convert USD → NGN at a fixed demo rate and route through
        Paystack's hosted checkout. Your wallet credits once Paystack's webhook
        fires back.
      </div>

      {wallet && wallet.ledger.length > 0 && (
        <div className="wallet-history">
          {wallet.ledger.map((entry) => (
            <div key={entry.id} className="wallet-history-row">
              <span style={{ color: "var(--text-dim)" }}>
                {entry.entry_type}
              </span>
              <span style={{ flex: 1, color: "var(--text-faint)", paddingLeft: 10 }}>
                {entry.description}
              </span>
              <span
                className={`wallet-history-amt ${entry.amount_usd >= 0 ? "pos" : "neg"}`}
              >
                {entry.amount_usd >= 0 ? "+" : ""}${entry.amount_usd.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClerkHeaderSlot() {
  return (
    <div className="clerk-user-slot">
      <SignedOut>
        <SignInButton mode="modal">
          <button className="sign-in-btn">Sign in</button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </div>
  );
}
