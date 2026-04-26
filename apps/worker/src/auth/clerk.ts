import { verifyToken } from "@clerk/backend";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../env";

// ════════════════════════════════════════════════════════════════════════
// Clerk auth middleware.
// Frontend sends the Clerk session JWT as `Authorization: Bearer <token>`.
// We verify via Clerk's JWKS (using their backend helper) and attach userId.
// ════════════════════════════════════════════════════════════════════════

export interface AuthVars {
  userId: string;
}

type AuthContext = Context<{ Bindings: Env; Variables: AuthVars }>;

/**
 * Required auth — 401s if no valid Clerk session.
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVars;
}> = async (c, next) => {
  if (!c.env.CLERK_SECRET_KEY) {
    return c.json({ error: "auth_not_configured" }, 503);
  }
  const token = extractBearer(c);
  if (!token) return c.json({ error: "unauthorized" }, 401);

  try {
    const verified = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
    });
    const userId = String(verified.sub ?? "");
    if (!userId) return c.json({ error: "invalid_token" }, 401);
    c.set("userId", userId);
    await ensureUser(c, userId);
    return next();
  } catch (err) {
    console.warn("clerk: token verify failed", err);
    return c.json({ error: "invalid_token" }, 401);
  }
};

function extractBearer(c: Context): string | null {
  const auth = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * Upsert user row in D1 + ensure a wallet exists.
 * Called on every authenticated request (cheap — INSERT OR IGNORE).
 */
async function ensureUser(c: AuthContext, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)`,
  )
    .bind(userId, now, now)
    .run();
  await c.env.DB.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`)
    .bind(now, userId)
    .run();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO wallets (user_id, updated_at) VALUES (?, ?)`,
  )
    .bind(userId, now)
    .run();
}
