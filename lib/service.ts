// Write-side service layer: every operation in the Signpost loop.
//
// Each mutation runs in a transaction, and the guard checks (existence, status,
// authorization-relevant invariants) run *inside* that transaction alongside the
// writes and the event-log append. Because better-sqlite3 is synchronous and the
// transaction body never yields, check-and-write is atomic — no time-of-check /
// time-of-use race between a status read and the state change it gates.
import { gateOf, invalidateIdentities, ownerOf } from "./authz";
import { emitEvent } from "./bus";
import { hashSecret, keyHint, type DB } from "./db";
import {
  newActionId,
  newAdminEventId,
  newDecisionId,
  newEventId,
  newKeyId,
  newReceiptId,
  newRequestId,
  newSecret,
  newSessionId,
  now,
} from "./ids";
import { getRequest } from "./queries";
import type {
  GateDecisionKind,
  IdentityKind,
  ReceiptStatus,
  RequestStatus,
  SignpostRequest,
} from "./types";

export class ServiceError extends Error {}

function logEvent(
  db: DB,
  requestId: string,
  type: string,
  actor: string,
  summary: string,
  data: Record<string, unknown> = {},
): void {
  db.prepare(
    `INSERT INTO events (id, request_id, type, actor, summary, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(newEventId(), requestId, type, actor, summary, JSON.stringify(data), now());
  // Wake any long-poll waiters. Safe to call inside the transaction.
  emitEvent();
}

function require_(db: DB, id: string): SignpostRequest {
  const req = getRequest(db, id);
  if (!req) throw new ServiceError(`Request ${id} not found`);
  return req;
}

function expectStatus(req: SignpostRequest, allowed: RequestStatus[]): void {
  if (!allowed.includes(req.status)) {
    throw new ServiceError(
      `Request ${req.id} is "${req.status}"; expected one of ${allowed.join(", ")}`,
    );
  }
}

function activeSession(db: DB, requestId: string): { id: string } {
  const row = db
    .prepare(`SELECT id FROM sessions WHERE request_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`)
    .get(requestId) as { id: string } | undefined;
  if (!row) throw new ServiceError(`No active session for request ${requestId}`);
  return row;
}

function setStatus(db: DB, id: string, status: RequestStatus): void {
  db.prepare(`UPDATE requests SET status = ? WHERE id = ?`).run(status, id);
}

// Input coercion/validation helpers, so malformed payloads raise ServiceError
// (mapped to 400) instead of TypeErrors (which would surface as 500).
function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ServiceError(`${field} is required`);
  }
  return value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is string => typeof s === "string" && s.trim() !== "");
}

// Append-only audit for management actions (identity/owner/key lifecycle). The
// request feed lives in `events`; these have no request, so they live here.
function logAdmin(
  db: DB,
  type: string,
  actor: string,
  target: string | null,
  summary: string,
  data: Record<string, unknown> = {},
): void {
  db.prepare(
    `INSERT INTO admin_events (id, type, actor, target, summary, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(newAdminEventId(), type, actor, target, summary, JSON.stringify(data), now());
}

// --- 0. identities, owners, and keys ----------------------------------------

const IDENTITY_KINDS: IdentityKind[] = ["human", "worker", "org", "team", "service", "gate"];
// Lowercase segments separated by single slashes, e.g. "acme/legal" or "russell".
const IDENTITY_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;

export interface CreateIdentityInput {
  id: string;
  kind?: IdentityKind;
  owner?: string; // defaults to the id itself (a self-owned principal)
  gate?: string | null;
  display_name?: string | null;
  description?: string | null;
}

export interface IssuedKey {
  id: string;
  identity: string;
  secret: string; // shown once, never stored
  prefix: string; // non-secret display hint, e.g. "sk_…aB3d"
  label: string | null;
  created_at: string;
  expires_at: string | null;
}

// Validate/normalize an optional expiry. A missing value means "never expires";
// a malformed or past value is a 400, not a silently-immortal key.
function normalizeExpiry(expires_at: string | null | undefined): string | null {
  if (expires_at === null || expires_at === undefined || expires_at === "") return null;
  const t = Date.parse(expires_at);
  if (Number.isNaN(t)) {
    throw new ServiceError(`invalid expires_at "${expires_at}" (use an ISO 8601 date-time)`);
  }
  if (t <= Date.now()) throw new ServiceError(`expires_at must be in the future`);
  return new Date(t).toISOString();
}

// Insert a key row and log it. No transaction of its own, so callers can run it
// atomically alongside other writes (e.g. createIdentity). Returns the secret,
// which is shown to the caller exactly once and never persisted.
function mintKeyRow(
  db: DB,
  identity: string,
  opts: { label?: string | null; expires_at?: string | null; actor?: string },
): IssuedKey {
  const secret = newSecret();
  const id = newKeyId();
  const ts = now();
  const label = opts.label?.trim() || null;
  const expires_at = normalizeExpiry(opts.expires_at);
  const prefix = keyHint(secret);
  db.prepare(
    `INSERT INTO api_keys (id, identity, hash, label, prefix, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, identity, hashSecret(secret), label, prefix, ts, expires_at);
  logAdmin(db, "key_issued", opts.actor ?? identity, identity, `Issued key ${id}.`, { key: id });
  return { id, identity, secret, prefix, label, created_at: ts, expires_at };
}

// Mint a key for an existing, active identity.
export function issueKey(
  db: DB,
  identity: string,
  opts: { label?: string | null; expires_at?: string | null; actor?: string } = {},
): IssuedKey {
  return db.transaction(() => {
    const ident = db.prepare(`SELECT status FROM identities WHERE id = ?`).get(identity) as
      | { status: string }
      | undefined;
    if (!ident) throw new ServiceError(`Unknown identity ${identity}`);
    if (ident.status === "disabled") throw new ServiceError(`Identity ${identity} is disabled`);
    return mintKeyRow(db, identity, opts);
  })();
}

export function createIdentity(db: DB, input: CreateIdentityInput, actor?: string): IssuedKey {
  const id = requireString(input.id, "id");
  if (!IDENTITY_ID.test(id)) {
    throw new ServiceError(`invalid identity id "${id}" (use lowercase letters, digits, - _ and /)`);
  }
  const owner = input.owner?.trim() || id; // default: self-owned principal
  const selfOwned = owner === id;
  // A top-level principal can be many things (human, org, service); don't guess.
  if (selfOwned && !input.kind) {
    throw new ServiceError(`kind is required for a top-level principal (${id})`);
  }
  const kind = input.kind ?? "worker";
  if (!IDENTITY_KINDS.includes(kind)) throw new ServiceError(`invalid identity kind "${kind}"`);
  const gate = typeof input.gate === "string" && input.gate.trim() ? input.gate.trim() : null;

  const ts = now();
  // Identity insert and the initial key are one transaction: never an identity
  // with no way to authenticate.
  return db.transaction(() => {
    if (db.prepare(`SELECT 1 FROM identities WHERE id = ?`).get(id)) {
      throw new ServiceError(`identity ${id} already exists`);
    }
    // The owner must already exist (unless this is a self-owned principal), so
    // the ownership tree is always well-formed.
    if (!selfOwned && !db.prepare(`SELECT 1 FROM identities WHERE id = ?`).get(owner)) {
      throw new ServiceError(`unknown owner ${owner}`);
    }
    if (gate && !db.prepare(`SELECT 1 FROM identities WHERE id = ?`).get(gate)) {
      throw new ServiceError(`unknown gate ${gate}`);
    }
    db.prepare(
      `INSERT INTO identities (id, kind, owner, display_name, description, gate, status, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
    ).run(id, kind, owner, input.display_name ?? null, input.description ?? null, gate, ts);
    invalidateIdentities(db);
    logAdmin(db, "identity_created", actor ?? owner, id, `Created identity ${id} (owner ${owner}).`, {
      kind,
      owner,
      gate,
    });
    // Hand back an initial key so the new identity can immediately authenticate.
    return mintKeyRow(db, id, { label: "initial", actor });
  })();
}

export interface UpdateIdentityInput {
  display_name?: string | null;
  description?: string | null;
  gate?: string | null;
}

export function updateIdentity(
  db: DB,
  id: string,
  patch: UpdateIdentityInput,
  actor?: string,
): void {
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT id FROM identities WHERE id = ?`).get(id) as
      | { id: string }
      | undefined;
    if (!row) throw new ServiceError(`Unknown identity ${id}`);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.display_name !== undefined) {
      sets.push("display_name = ?");
      vals.push(patch.display_name);
    }
    if (patch.description !== undefined) {
      sets.push("description = ?");
      vals.push(patch.description);
    }
    if (patch.gate !== undefined) {
      const gate = patch.gate && patch.gate.trim() ? patch.gate.trim() : null;
      if (gate && !db.prepare(`SELECT 1 FROM identities WHERE id = ?`).get(gate)) {
        throw new ServiceError(`unknown gate ${gate}`);
      }
      sets.push("gate = ?");
      vals.push(gate);
    }
    if (sets.length === 0) throw new ServiceError("nothing to update");
    db.prepare(`UPDATE identities SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    invalidateIdentities(db);
    logAdmin(db, "identity_updated", actor ?? id, id, `Updated identity ${id}.`, { fields: sets });
  });
  tx();
}

// Soft delete: the row stays (audit history is immutable) but the identity can
// no longer authenticate or be addressed.
export function disableIdentity(db: DB, id: string, actor?: string): void {
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT status, is_admin FROM identities WHERE id = ?`).get(id) as
      | { status: string; is_admin: number }
      | undefined;
    if (!row) throw new ServiceError(`Unknown identity ${id}`);
    if (row.is_admin) throw new ServiceError(`Cannot disable an admin identity`);
    if (row.status === "disabled") return; // idempotent
    db.prepare(`UPDATE identities SET status = 'disabled' WHERE id = ?`).run(id);
    invalidateIdentities(db);
    logAdmin(db, "identity_disabled", actor ?? id, id, `Disabled identity ${id}.`);
  });
  tx();
}

// Reverse a soft delete. Soft-disable would be a trap without it.
export function enableIdentity(db: DB, id: string, actor?: string): void {
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT status FROM identities WHERE id = ?`).get(id) as
      | { status: string }
      | undefined;
    if (!row) throw new ServiceError(`Unknown identity ${id}`);
    if (row.status === "active") return; // idempotent
    db.prepare(`UPDATE identities SET status = 'active' WHERE id = ?`).run(id);
    invalidateIdentities(db);
    logAdmin(db, "identity_enabled", actor ?? id, id, `Re-enabled identity ${id}.`);
  });
  tx();
}

export function revokeKey(db: DB, keyId: string, actor?: string): void {
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT identity, revoked_at FROM api_keys WHERE id = ?`).get(keyId) as
      | { identity: string; revoked_at: string | null }
      | undefined;
    if (!row) throw new ServiceError(`Unknown key ${keyId}`);
    if (row.revoked_at) return; // idempotent
    db.prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ?`).run(now(), keyId);
    logAdmin(db, "key_revoked", actor ?? row.identity, row.identity, `Revoked key ${keyId}.`, {
      key: keyId,
    });
  });
  tx();
}

// --- 1. create request -------------------------------------------------------

export interface CreateRequestInput {
  from_id: string;
  to_id: string;
  goal: string;
  definition_of_done: string[];
  constraints?: string[];
  context?: string[];
  deadline?: string | null;
}

export function createRequest(db: DB, input: CreateRequestInput): string {
  const from = requireString(input.from_id, "from");
  const to = requireString(input.to_id, "to");
  const goal = requireString(input.goal, "goal");
  const dod = stringList(input.definition_of_done);
  if (dod.length === 0) throw new ServiceError("at least one definition of done is required");

  const recipient = db.prepare(`SELECT gate, status FROM identities WHERE id = ?`).get(to) as
    | { gate: string | null; status: string }
    | undefined;
  if (!recipient) throw new ServiceError(`Unknown recipient identity ${to}`);
  if (recipient.status === "disabled") throw new ServiceError(`Recipient identity ${to} is disabled`);

  const id = newRequestId();
  const ts = now();
  const gate = recipient.gate ?? `${to.split("/")[0]}/gate`;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO requests
        (id, from_id, to_id, kind, goal, context, definition_of_done, constraints, deadline, status, created_at)
       VALUES (@id, @from_id, @to_id, 'request', @goal, @context, @dod, @constraints, @deadline, 'screening', @created_at)`,
    ).run({
      id,
      from_id: from,
      to_id: to,
      goal,
      context: JSON.stringify(stringList(input.context)),
      dod: JSON.stringify(dod),
      constraints: JSON.stringify(stringList(input.constraints)),
      deadline: typeof input.deadline === "string" ? input.deadline : null,
      created_at: ts,
    });
    logEvent(db, id, "request_created", from, `Request created: ${goal}`, { from, to });
    logEvent(db, id, "routed_to_gate", gate, `Routed through ${gate} for screening.`, { gate });
  });
  tx();
  return id;
}

// Create-with-idempotency: a repeated call with the same (identity, key) returns
// the same request instead of creating a duplicate. The key is scoped to the
// caller so two identities can use the same key without colliding.
export function createRequestIdempotent(
  db: DB,
  key: string | null,
  input: CreateRequestInput,
): { id: string; replayed: boolean } {
  if (!key) return { id: createRequest(db, input), replayed: false };
  const existing = db
    .prepare(`SELECT request_id FROM idempotency_keys WHERE identity = ? AND key = ?`)
    .get(input.from_id, key) as { request_id: string } | undefined;
  if (existing) return { id: existing.request_id, replayed: true };
  const id = createRequest(db, input);
  db.prepare(
    `INSERT INTO idempotency_keys (identity, key, request_id, created_at) VALUES (?, ?, ?, ?)`,
  ).run(input.from_id, key, id, now());
  return { id, replayed: false };
}

// --- 2. gate decisions -------------------------------------------------------

const DECISION_STATUS: Record<GateDecisionKind, RequestStatus> = {
  allow: "accepted",
  allow_with_limits: "accepted",
  deny: "denied",
  ask_sender: "needs_info",
  ask_owner: "needs_owner",
  // route re-addresses the request and sends it back through the new recipient's
  // gate (screening); counter proposes terms the sender must accept or decline.
  route: "screening",
  counter: "countered",
};

export interface DecideInput {
  decision: GateDecisionKind;
  limits?: string[];
  reason?: string[];
  route_to?: string | null;
}

export interface DecideMeta {
  auto?: boolean; // the gate policy made this decision automatically
  rule?: string; // the matched policy rule (or "default")
}

export function decide(
  db: DB,
  requestId: string,
  input: DecideInput,
  actor?: string,
  meta: DecideMeta = {},
): void {
  if (!DECISION_STATUS[input.decision]) {
    throw new ServiceError(`unknown decision "${input.decision}"`);
  }
  const limits = stringList(input.limits);
  const reason = stringList(input.reason);
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["screening", "needs_info", "needs_owner"]);

    // `route` re-addresses the request to a different identity; validate the
    // target before recording anything. `counter` must carry the terms it
    // proposes (limits and/or a reason), or the sender has nothing to weigh.
    let routeTo: string | null = null;
    if (input.decision === "route") {
      routeTo = requireString(input.route_to, "route_to");
      const exists = db.prepare(`SELECT 1 FROM identities WHERE id = ?`).get(routeTo);
      if (!exists) throw new ServiceError(`Unknown route target ${routeTo}`);
      if (routeTo === req.to_id) {
        throw new ServiceError(`Request ${requestId} is already addressed to ${routeTo}`);
      }
    }
    if (input.decision === "counter" && limits.length === 0 && reason.length === 0) {
      throw new ServiceError("a counter must propose limits or a reason");
    }

    // The `gate` column always records the stable gate identity; the event actor
    // records who actually decided (the owner, or the gate itself for an auto
    // decision).
    const gate = gateOf(db, req);
    const who = actor ?? gate;
    db.prepare(
      `INSERT INTO gate_decisions (id, request_id, gate, decision, scope, action_id, auto, rule, limits, reason, route_to, created_at)
       VALUES (?, ?, ?, ?, 'request', NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newDecisionId(),
      requestId,
      gate,
      input.decision,
      meta.auto ? 1 : 0,
      meta.rule ?? null,
      JSON.stringify(limits),
      JSON.stringify(reason),
      routeTo,
      now(),
    );
    const label = meta.auto ? "Auto gate decision" : "Gate decision";
    logEvent(db, requestId, "gate_decision", who, `${label}: ${input.decision}`, {
      decision: input.decision,
      limits,
      reason,
      auto: Boolean(meta.auto),
      rule: meta.rule ?? null,
      route_to: routeTo,
    });

    if (input.decision === "route") {
      // Re-address and send back to screening at the new recipient's gate.
      db.prepare(`UPDATE requests SET to_id = ?, status = 'screening' WHERE id = ?`).run(
        routeTo,
        requestId,
      );
      logEvent(db, requestId, "request_routed", who, `Routed from ${req.to_id} to ${routeTo}.`, {
        from: req.to_id,
        to: routeTo,
      });
    } else {
      setStatus(db, requestId, DECISION_STATUS[input.decision]);
    }
  });
  tx();
}

// The sender responds to a counter. Accepting applies the proposed terms (the
// request proceeds as accepted, under the limits recorded on the counter
// decision); declining ends the request. Mirrors respondToInfo for ask_sender.
export function respondToCounter(
  db: DB,
  requestId: string,
  accept: boolean,
  actor?: string,
): void {
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["countered"]);
    const who = actor ?? req.from_id;
    setStatus(db, requestId, accept ? "accepted" : "denied");
    logEvent(
      db,
      requestId,
      accept ? "counter_accepted" : "counter_declined",
      who,
      accept
        ? "Sender accepted the gate's counter; proceeding under the proposed terms."
        : "Sender declined the gate's counter; request closed.",
      { accept },
    );
  });
  tx();
}

// The sender responds to an ask_sender. Re-enters the gate for screening.
export function respondToInfo(
  db: DB,
  requestId: string,
  answers: string[],
  actor?: string,
): void {
  const clean = stringList(answers);
  if (clean.length === 0) throw new ServiceError("an answer is required");
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["needs_info"]);
    setStatus(db, requestId, "screening");
    logEvent(db, requestId, "info_provided", actor ?? req.from_id, clean.join(" "), {
      answers: clean,
    });
  });
  tx();
}

// --- 3. session --------------------------------------------------------------

export function startSession(db: DB, requestId: string): string {
  const id = newSessionId();
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["accepted"]);
    // A request only reaches "accepted" with no active session, but guard anyway:
    // starting a second session is rejected (not silently merged).
    const existing = db
      .prepare(`SELECT id FROM sessions WHERE request_id = ? AND status = 'active' LIMIT 1`)
      .get(requestId) as { id: string } | undefined;
    if (existing) throw new ServiceError(`Request ${requestId} already has an active session`);

    const ts = now();
    db.prepare(
      `INSERT INTO sessions (id, identity, request_id, status, created_at) VALUES (?, ?, ?, 'active', ?)`,
    ).run(id, req.to_id, requestId, ts);
    db.prepare(
      `INSERT INTO session_actions (id, session_id, identity, action, summary, requires_gate, gate_status, created_at)
       VALUES (?, ?, ?, 'accept', ?, 0, NULL, ?)`,
    ).run(newActionId(), id, req.to_id, "Session accepted the request and started work.", ts);
    setStatus(db, requestId, "active");
    logEvent(db, requestId, "session_started", req.to_id, `Session ${id} started.`, {
      session: id,
    });
  });
  tx();
  return id;
}

export function postUpdate(db: DB, requestId: string, summary: string): void {
  const text = requireString(summary, "update summary");
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["active"]);
    const session = activeSession(db, requestId);
    db.prepare(
      `INSERT INTO session_actions (id, session_id, identity, action, summary, requires_gate, gate_status, created_at)
       VALUES (?, ?, ?, 'post_update', ?, 0, NULL, ?)`,
    ).run(newActionId(), session.id, req.to_id, text.trim(), now());
    logEvent(db, requestId, "session_update", req.to_id, text.trim());
  });
  tx();
}

// The execution-time gate. A worker flags a risky step; the request blocks until
// the gate resolves it. This is the second of the gate's three moments.
export function askGate(db: DB, requestId: string, summary: string): string {
  const text = requireString(summary, "a description of the risky action");
  const actionId = newActionId();
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["active"]);
    const session = activeSession(db, requestId);
    db.prepare(
      `INSERT INTO session_actions (id, session_id, identity, action, summary, requires_gate, gate_status, created_at)
       VALUES (?, ?, ?, 'block', ?, 1, 'pending', ?)`,
    ).run(actionId, session.id, req.to_id, text.trim(), now());
    setStatus(db, requestId, "blocked");
    logEvent(db, requestId, "execution_check_requested", req.to_id, text.trim(), {
      action: actionId,
    });
  });
  tx();
  return actionId;
}

// The gate resolves a pending execution check. Allow lets the worker proceed;
// deny refuses the risky step (the worker continues without it).
export function resolveCheck(
  db: DB,
  requestId: string,
  allow: boolean,
  reason: string[] = [],
  actor?: string,
): void {
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["blocked"]);
    const session = activeSession(db, requestId);
    const pending = db
      .prepare(
        `SELECT id FROM session_actions WHERE session_id = ? AND gate_status = 'pending' ORDER BY rowid DESC LIMIT 1`,
      )
      .get(session.id) as { id: string } | undefined;
    if (!pending) throw new ServiceError("no pending execution check to resolve");

    const gate = gateOf(db, req);
    const who = actor ?? gate;
    db.prepare(`UPDATE session_actions SET gate_status = ? WHERE id = ?`).run(
      allow ? "allowed" : "denied",
      pending.id,
    );
    db.prepare(
      `INSERT INTO gate_decisions (id, request_id, gate, decision, scope, action_id, limits, reason, route_to, created_at)
       VALUES (?, ?, ?, ?, 'execution', ?, '[]', ?, NULL, ?)`,
    ).run(newDecisionId(), requestId, gate, allow ? "allow" : "deny", pending.id, JSON.stringify(reason), now());
    setStatus(db, requestId, "active");
    logEvent(
      db,
      requestId,
      allow ? "execution_check_allowed" : "execution_check_denied",
      who,
      reason.join(" ") || (allow ? "Risky action allowed." : "Risky action denied."),
      { action: pending.id },
    );
  });
  tx();
}

export function markReadyForRelease(db: DB, requestId: string, summary?: string): void {
  const note = summary?.trim() || "Worker marked the request ready for release.";
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["active"]);
    const session = activeSession(db, requestId);
    db.prepare(
      `INSERT INTO session_actions (id, session_id, identity, action, summary, requires_gate, gate_status, created_at)
       VALUES (?, ?, ?, 'complete', ?, 0, NULL, ?)`,
    ).run(newActionId(), session.id, req.to_id, note, now());
    setStatus(db, requestId, "ready_for_release");
    logEvent(db, requestId, "ready_for_release", req.to_id, note);
  });
  tx();
}

// --- 4. release --------------------------------------------------------------

// The release-time gate is the third moment; record it as a typed gate decision
// (scope='release') as well as an event, so all three moments leave a decision.
export function release(db: DB, requestId: string, actor?: string): void {
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["ready_for_release"]);
    const gate = gateOf(db, req);
    const who = actor ?? ownerOf(db, req);
    db.prepare(
      `INSERT INTO gate_decisions (id, request_id, gate, decision, scope, action_id, limits, reason, route_to, created_at)
       VALUES (?, ?, ?, 'allow', 'release', NULL, '[]', '[]', NULL, ?)`,
    ).run(newDecisionId(), requestId, gate, now());
    setStatus(db, requestId, "released");
    logEvent(db, requestId, "released", who, "Release check passed. Output released.");
  });
  tx();
}

export function rejectRelease(db: DB, requestId: string, reason: string, actor?: string): void {
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["ready_for_release"]);
    const gate = gateOf(db, req);
    const who = actor ?? ownerOf(db, req);
    const note = reason.trim() || "Release rejected. Sent back to the worker.";
    db.prepare(
      `INSERT INTO gate_decisions (id, request_id, gate, decision, scope, action_id, limits, reason, route_to, created_at)
       VALUES (?, ?, ?, 'deny', 'release', NULL, '[]', ?, NULL, ?)`,
    ).run(newDecisionId(), requestId, gate, JSON.stringify([note]), now());
    setStatus(db, requestId, "active");
    logEvent(db, requestId, "release_rejected", who, note);
  });
  tx();
}

// --- 5. receipt --------------------------------------------------------------

export interface ReceiptInput {
  status?: ReceiptStatus;
  artifacts?: string[];
  evidence: string[];
  assumptions?: string[];
}

export function closeWithReceipt(
  db: DB,
  requestId: string,
  input: ReceiptInput,
  actor?: string,
): string {
  const evidence = stringList(input.evidence);
  if (evidence.length === 0) {
    throw new ServiceError("a receipt needs at least one piece of evidence");
  }
  const id = newReceiptId();
  const status = input.status ?? "completed";
  const tx = db.transaction(() => {
    const req = require_(db, requestId);
    expectStatus(req, ["released"]);
    const session = db
      .prepare(`SELECT id FROM sessions WHERE request_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(requestId) as { id: string } | undefined;
    if (!session) throw new ServiceError("cannot close without a session");

    db.prepare(
      `INSERT INTO receipts (id, request_id, session_id, status, artifacts, evidence, assumptions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      requestId,
      session.id,
      status,
      JSON.stringify(stringList(input.artifacts)),
      JSON.stringify(evidence),
      JSON.stringify(stringList(input.assumptions)),
      now(),
    );
    db.prepare(`UPDATE sessions SET status = 'complete' WHERE id = ?`).run(session.id);
    setStatus(db, requestId, "closed");
    logEvent(db, requestId, "closed", actor ?? ownerOf(db, req), `Closed with receipt ${id} (${status}).`, {
      receipt: id,
      status,
    });
  });
  tx();
  return id;
}
