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
type IdentityRow = { gate: string | null; owner: string; is_admin: boolean };
const identityCache = new WeakMap<object, Map<string, IdentityRow>>();

function identities(db: DB): Map<string, IdentityRow> {
  let m = identityCache.get(db);
  if (!m) {
    m = new Map();
    const rows = db.prepare(`SELECT id, gate, owner, is_admin FROM identities`).all() as Array<{
      id: string;
      gate: string | null;
      owner: string;
      is_admin: number;
    }>;
    for (const r of rows) m.set(r.id, { gate: r.gate, owner: r.owner, is_admin: Boolean(r.is_admin) });
    identityCache.set(db, m);
  }
  return m;
}

// Identities are no longer static (they can be created/disabled at runtime), so
// any write to the identity graph must drop this cache, or role derivation and
// gate/owner lookups would serve stale data.
export function invalidateIdentities(db: DB): void {
  identityCache.delete(db);
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

// --- management authorization (the identity/owner/key graph) -----------------

export function isAdmin(db: DB, caller: string): boolean {
  return Boolean(identities(db).get(caller)?.is_admin);
}

// True if `caller` sits above `target` in the ownership tree: it owns target
// directly, or owns one of target's (transitive) owners. A self-owned identity
// (owner === id) is a root and stops the walk. Admins control everything.
export function controls(db: DB, caller: string, target: string): boolean {
  if (isAdmin(db, caller)) return true;
  const idents = identities(db);
  let cur = target;
  // Bound the walk so a malformed cycle can never spin forever.
  for (let i = 0; i < 64; i++) {
    const row = idents.get(cur);
    if (!row) return false;
    if (row.owner === caller) return true;
    if (row.owner === cur) return false; // reached a root
    cur = row.owner;
  }
  return false;
}

// Who may manage an identity (update it, disable it, mint/revoke its keys):
// an admin, or an owner strictly above it in the tree.
export function canManage(db: DB, caller: string, target: string): boolean {
  return isAdmin(db, caller) || controls(db, caller, target);
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
