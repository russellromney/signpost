// Shared plumbing for the /v1 route handlers: authentication and a single
// error-to-HTTP mapping so every endpoint behaves consistently.
import { NextResponse } from "next/server";
import { authenticate, AuthError } from "./auth";
import { AuthzError, rolesOf } from "./authz";
import { getDb, type DB } from "./db";
import { getRequest } from "./queries";
import { ServiceError } from "./service";
import type { SignpostRequest } from "./types";

// Raised when a request does not exist OR the caller is not party to it. Both
// map to 404 so endpoints never reveal the existence of requests you can't see.
export class NotFoundError extends Error {}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(err: unknown) {
  if (err instanceof AuthError) return json({ error: err.message }, 401);
  if (err instanceof NotFoundError) return json({ error: err.message }, 404);
  if (err instanceof AuthzError) return json({ error: err.message }, 403);
  if (err instanceof ServiceError) return json({ error: err.message }, 400);
  const message = err instanceof Error ? err.message : "Unexpected error";
  return json({ error: message }, 500);
}

// Load a request the caller is party to, or throw NotFoundError. Use this before
// authorizing a specific action: a non-party gets 404 (existence hidden), while a
// party with the wrong role gets 403 from the subsequent assertCan.
export function loadParty(db: DB, caller: string, id: string): SignpostRequest {
  const r = getRequest(db, id);
  if (!r || rolesOf(db, caller, r).length === 0) throw new NotFoundError("not found");
  return r;
}

export interface Ctx {
  db: DB;
  caller: string;
}

// Wrap a handler: resolve the bearer token to a caller, run, map any error.
export async function authed(
  req: Request,
  fn: (ctx: Ctx) => Promise<Response> | Response,
): Promise<Response> {
  try {
    const db = getDb();
    const caller = authenticate(db, req);
    return await fn({ db, caller });
  } catch (err) {
    return errorResponse(err);
  }
}

// Best-effort JSON body parse (tolerates empty bodies).
export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}
