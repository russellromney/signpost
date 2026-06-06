// Authorization: what a caller may do is derived from their *role in the
// request*, not from a separate permissions table. This is where "humans are
// exception handlers" becomes code — the gate role can be held by a human or a
// policy engine, and the rules are identical either way.
import type { DB } from "./db";
import type { Role, SignpostRequest } from "./types";

export class AuthzError extends Error {}

// Identities never change at runtime in the prototype (they're seeded once at
// startup; there is no create-identity endpoint), so we load them once per DB
// connection and cache the gate/owner lookup. This removes the N+1 queries that
// gateOf/ownerOf would otherwise cause on every feed poll and inbox read.
const identityCache = new WeakMap<object, Map<string, { gate: string | null; owner: string }>>();

function identities(db: DB): Map<string, { gate: string | null; owner: string }> {
  let m = identityCache.get(db);
  if (!m) {
    m = new Map();
    const rows = db.prepare(`SELECT id, gate, owner FROM identities`).all() as Array<{
      id: string;
      gate: string | null;
      owner: string;
    }>;
    for (const r of rows) m.set(r.id, { gate: r.gate, owner: r.owner });
    identityCache.set(db, m);
  }
  return m;
}

// The gate identity that screens a request: the recipient's configured gate,
// falling back to "<owner>/gate".
export function gateOf(db: DB, req: SignpostRequest): string {
  const row = identities(db).get(req.to_id);
  if (row?.gate) return row.gate;
  return `${req.to_id.split("/")[0]}/gate`;
}

export function ownerOf(db: DB, req: SignpostRequest): string {
  return identities(db).get(req.to_id)?.owner ?? req.to_id.split("/")[0];
}

// Every role the caller holds on this request. An identity can hold several
// (e.g. russell is both owner and, when he clicks Allow, the gate).
export function rolesOf(db: DB, caller: string, req: SignpostRequest): Role[] {
  const roles: Role[] = [];
  if (caller === req.from_id) roles.push("sender");
  if (caller === req.to_id) roles.push("worker");
  if (caller === gateOf(db, req)) roles.push("gate");
  if (caller === ownerOf(db, req)) roles.push("owner");
  return roles;
}

// Which roles may perform each action in the loop.
export const ACTION_ROLES: Record<string, Role[]> = {
  decide: ["gate", "owner"],
  respond_info: ["sender"],
  respond_counter: ["sender"],
  start_session: ["worker"],
  session_action: ["worker"],
  resolve_check: ["gate", "owner"],
  release: ["gate", "owner"],
  reject_release: ["gate", "owner"],
  close: ["worker", "owner"],
};

export function can(db: DB, caller: string, action: string, req: SignpostRequest): boolean {
  const allowed = ACTION_ROLES[action];
  if (!allowed) return false;
  const held = rolesOf(db, caller, req);
  return held.some((r) => allowed.includes(r));
}

// Throwing guard used by the API layer.
export function assertCan(
  db: DB,
  caller: string,
  action: string,
  req: SignpostRequest,
): void {
  if (!can(db, caller, action, req)) {
    const held = rolesOf(db, caller, req);
    const need = ACTION_ROLES[action]?.join(" or ") ?? "a known action";
    throw new AuthzError(
      `${caller} may not ${action} on ${req.id} (role ${held.join(",") || "none"}; needs ${need})`,
    );
  }
}
