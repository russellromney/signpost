// Authentication: resolve a bearer token to the identity making the call.
//
// Prototype-grade: one static token per identity, stored in the tokens table
// and seeded deterministically (see tokenFor in db.ts). A real deployment would
// issue rotating secrets, but the boundary — "every call is made AS an identity"
// — is the part that matters and is real here.
import type { DB } from "./db";

export class AuthError extends Error {}

export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// Resolve a token string to an identity id, or throw AuthError.
export function identityForToken(db: DB, token: string | null): string {
  if (!token) throw new AuthError("missing bearer token");
  const row = db.prepare(`SELECT identity FROM tokens WHERE token = ?`).get(token) as
    | { identity: string }
    | undefined;
  if (!row) throw new AuthError("invalid bearer token");
  return row.identity;
}

// Convenience for route handlers: read the Authorization header off a Request.
export function authenticate(db: DB, req: Request): string {
  return identityForToken(db, parseBearer(req.headers.get("authorization")));
}
