// Authentication: resolve a bearer token to the identity making the call.
//
// Keys live in `api_keys` as a hash of the secret; we hash the presented token
// and look it up, skipping revoked/expired keys and disabled identities. The
// boundary — "every call is made AS an identity" — is the part that matters.
import { hashSecret, type DB } from "./db";
import { now } from "./ids";

export class AuthError extends Error {}

export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// Resolve a token string to an identity id, or throw AuthError.
export function identityForToken(db: DB, token: string | null): string {
  if (!token) throw new AuthError("missing bearer token");
  const row = db
    .prepare(
      `SELECT k.identity AS identity, i.status AS status
         FROM api_keys k JOIN identities i ON i.id = k.identity
        WHERE k.hash = ? AND k.revoked_at IS NULL
          AND (k.expires_at IS NULL OR k.expires_at > ?)`,
    )
    .get(hashSecret(token), now()) as { identity: string; status: string } | undefined;
  if (!row) throw new AuthError("invalid bearer token");
  if (row.status === "disabled") throw new AuthError("identity is disabled");
  return row.identity;
}

// Convenience for route handlers: read the Authorization header off a Request.
export function authenticate(db: DB, req: Request): string {
  return identityForToken(db, parseBearer(req.headers.get("authorization")));
}
