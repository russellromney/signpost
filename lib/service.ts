// Write-side service layer: every operation in the Signpost loop.
//
// Each mutation runs in a transaction and appends to the event log, so the
// audit trail can never drift from the state it describes. Functions take an
// explicit DB handle, which keeps them trivially testable.
import type { DB } from "./db";
import {
  newActionId,
  newDecisionId,
  newEventId,
  newReceiptId,
  newRequestId,
  newSessionId,
  now,
} from "./ids";
import { getRequest } from "./queries";
import type {
  GateDecisionKind,
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
  if (!input.from_id || !input.to_id) throw new ServiceError("from and to are required");
  if (!input.goal.trim()) throw new ServiceError("goal is required");
  const dod = input.definition_of_done.filter((s) => s.trim());
  if (dod.length === 0) throw new ServiceError("at least one definition of done is required");

  const to = db.prepare(`SELECT gate FROM identities WHERE id = ?`).get(input.to_id) as
    | { gate: string | null }
    | undefined;
  if (!to) throw new ServiceError(`Unknown recipient identity ${input.to_id}`);

  const id = newRequestId();
  const ts = now();
  const gate = to.gate ?? `${input.to_id.split("/")[0]}/gate`;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO requests
        (id, from_id, to_id, kind, goal, context, definition_of_done, constraints, deadline, status, created_at)
       VALUES (@id, @from_id, @to_id, 'request', @goal, @context, @dod, @constraints, @deadline, 'screening', @created_at)`,
    ).run({
      id,
      from_id: input.from_id,
      to_id: input.to_id,
      goal: input.goal.trim(),
      context: JSON.stringify(input.context ?? []),
      dod: JSON.stringify(dod),
      constraints: JSON.stringify(input.constraints ?? []),
      deadline: input.deadline ?? null,
      created_at: ts,
    });
    logEvent(db, id, "request_created", input.from_id, `Request created: ${input.goal.trim()}`, {
      from: input.from_id,
      to: input.to_id,
    });
    logEvent(db, id, "routed_to_gate", gate, `Routed through ${gate} for screening.`, { gate });
  });
  tx();
  return id;
}

// Create-with-idempotency: a repeated call with the same key returns the same
// request instead of creating a duplicate. Lets agents retry safely.
export function createRequestIdempotent(
  db: DB,
  key: string | null,
  input: CreateRequestInput,
): { id: string; replayed: boolean } {
  if (!key) return { id: createRequest(db, input), replayed: false };
  const existing = db
    .prepare(`SELECT request_id FROM idempotency_keys WHERE key = ?`)
    .get(key) as { request_id: string } | undefined;
  if (existing) return { id: existing.request_id, replayed: true };
  const id = createRequest(db, input);
  db.prepare(
    `INSERT INTO idempotency_keys (key, identity, request_id, created_at) VALUES (?, ?, ?, ?)`,
  ).run(key, input.from_id, id, now());
  return { id, replayed: false };
}

// --- 2. gate decisions -------------------------------------------------------

const DECISION_STATUS: Record<GateDecisionKind, RequestStatus> = {
  allow: "accepted",
  allow_with_limits: "accepted",
  deny: "denied",
  ask_sender: "needs_info",
  ask_owner: "needs_owner",
  route: "needs_owner",
  counter: "needs_owner",
};

export interface DecideInput {
  decision: GateDecisionKind;
  limits?: string[];
  reason?: string[];
  route_to?: string | null;
  gate?: string;
}

export function decide(db: DB, requestId: string, input: DecideInput, actor?: string): void {
  const req = require_(db, requestId);
  expectStatus(req, ["screening", "needs_info", "needs_owner"]);

  const gate = actor ?? input.gate ?? `${req.to_id.split("/")[0]}/gate`;
  const nextStatus = DECISION_STATUS[input.decision];
  const ts = now();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO gate_decisions (id, request_id, gate, decision, scope, action_id, limits, reason, route_to, created_at)
       VALUES (?, ?, ?, ?, 'request', NULL, ?, ?, ?, ?)`,
    ).run(
      newDecisionId(),
      requestId,
      gate,
      input.decision,
      JSON.stringify(input.limits ?? []),
      JSON.stringify(input.reason ?? []),
      input.route_to ?? null,
      ts,
    );
    setStatus(db, requestId, nextStatus);
    logEvent(db, requestId, "gate_decision", gate, `Gate decision: ${input.decision}`, {
      decision: input.decision,
      limits: input.limits ?? [],
      reason: input.reason ?? [],
    });
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
  const req = require_(db, requestId);
  expectStatus(req, ["needs_info"]);
  const clean = answers.filter((s) => s.trim());
  if (clean.length === 0) throw new ServiceError("an answer is required");
  const who = actor ?? req.from_id;
  const tx = db.transaction(() => {
    setStatus(db, requestId, "screening");
    logEvent(db, requestId, "info_provided", who, clean.join(" "), { answers: clean });
  });
  tx();
}

// --- 3. session --------------------------------------------------------------

export function startSession(db: DB, requestId: string): string {
  const req = require_(db, requestId);
  // Idempotent-ish: if a session already exists, surface it rather than dup.
  const existing = db
    .prepare(`SELECT id FROM sessions WHERE request_id = ? AND status = 'active' LIMIT 1`)
    .get(requestId) as { id: string } | undefined;
  if (existing) throw new ServiceError(`Request ${requestId} already has an active session`);
  expectStatus(req, ["accepted"]);
  const id = newSessionId();
  const ts = now();

  const tx = db.transaction(() => {
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
  const req = require_(db, requestId);
  expectStatus(req, ["active"]);
  if (!summary.trim()) throw new ServiceError("update summary is required");
  const session = activeSession(db, requestId);
  const ts = now();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO session_actions (id, session_id, identity, action, summary, requires_gate, gate_status, created_at)
       VALUES (?, ?, ?, 'post_update', ?, 0, NULL, ?)`,
    ).run(newActionId(), session.id, req.to_id, summary.trim(), ts);
    logEvent(db, requestId, "session_update", req.to_id, summary.trim());
  });
  tx();
}

// The execution-time gate. A worker flags a risky step; the request blocks until
// the gate resolves it. This is the second of the gate's three moments.
export function askGate(db: DB, requestId: string, summary: string): string {
  const req = require_(db, requestId);
  expectStatus(req, ["active"]);
  if (!summary.trim()) throw new ServiceError("a description of the risky action is required");
  const session = activeSession(db, requestId);
  const actionId = newActionId();
  const ts = now();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO session_actions (id, session_id, identity, action, summary, requires_gate, gate_status, created_at)
       VALUES (?, ?, ?, 'block', ?, 1, 'pending', ?)`,
    ).run(actionId, session.id, req.to_id, summary.trim(), ts);
    setStatus(db, requestId, "blocked");
    logEvent(db, requestId, "execution_check_requested", req.to_id, summary.trim(), {
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
  const req = require_(db, requestId);
  expectStatus(req, ["blocked"]);
  const session = activeSession(db, requestId);
  const pending = db
    .prepare(
      `SELECT id FROM session_actions WHERE session_id = ? AND gate_status = 'pending' ORDER BY rowid DESC LIMIT 1`,
    )
    .get(session.id) as { id: string } | undefined;
  if (!pending) throw new ServiceError("no pending execution check to resolve");

  const gate = actor ?? `${req.to_id.split("/")[0]}/gate`;
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE session_actions SET gate_status = ? WHERE id = ?`).run(
      allow ? "allowed" : "denied",
      pending.id,
    );
    db.prepare(
      `INSERT INTO gate_decisions (id, request_id, gate, decision, scope, action_id, limits, reason, route_to, created_at)
       VALUES (?, ?, ?, ?, 'execution', ?, '[]', ?, NULL, ?)`,
    ).run(
      newDecisionId(),
      requestId,
      gate,
      allow ? "allow" : "deny",
      pending.id,
      JSON.stringify(reason),
      ts,
    );
    setStatus(db, requestId, "active");
    logEvent(
      db,
      requestId,
      allow ? "execution_check_allowed" : "execution_check_denied",
      gate,
      reason.join(" ") || (allow ? "Risky action allowed." : "Risky action denied."),
      { action: pending.id },
    );
  });
  tx();
}

export function markReadyForRelease(db: DB, requestId: string, summary?: string): void {
  const req = require_(db, requestId);
  expectStatus(req, ["active"]);
  const session = activeSession(db, requestId);
  const ts = now();
  const note = summary?.trim() || "Worker marked the request ready for release.";

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO session_actions (id, session_id, identity, action, summary, requires_gate, gate_status, created_at)
       VALUES (?, ?, ?, 'complete', ?, 0, NULL, ?)`,
    ).run(newActionId(), session.id, req.to_id, note, ts);
    setStatus(db, requestId, "ready_for_release");
    logEvent(db, requestId, "ready_for_release", req.to_id, note);
  });
  tx();
}

// --- 4. release --------------------------------------------------------------

export function release(db: DB, requestId: string, actor = "russell"): void {
  const req = require_(db, requestId);
  expectStatus(req, ["ready_for_release"]);
  const tx = db.transaction(() => {
    setStatus(db, requestId, "released");
    logEvent(db, requestId, "released", actor, "Release check passed. Output released.");
  });
  tx();
}

export function rejectRelease(
  db: DB,
  requestId: string,
  reason: string,
  actor = "russell",
): void {
  const req = require_(db, requestId);
  expectStatus(req, ["ready_for_release"]);
  const note = reason.trim() || "Release rejected. Sent back to the worker.";
  const tx = db.transaction(() => {
    setStatus(db, requestId, "active");
    logEvent(db, requestId, "release_rejected", actor, note);
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
  actor = "russell",
): string {
  const req = require_(db, requestId);
  expectStatus(req, ["released"]);
  const evidence = input.evidence.filter((s) => s.trim());
  if (evidence.length === 0) {
    throw new ServiceError("a receipt needs at least one piece of evidence");
  }
  const session = db
    .prepare(`SELECT id FROM sessions WHERE request_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(requestId) as { id: string } | undefined;
  if (!session) throw new ServiceError("cannot close without a session");

  const id = newReceiptId();
  const ts = now();
  const status = input.status ?? "completed";

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO receipts (id, request_id, session_id, status, artifacts, evidence, assumptions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      requestId,
      session.id,
      status,
      JSON.stringify(input.artifacts ?? []),
      JSON.stringify(evidence),
      JSON.stringify(input.assumptions ?? []),
      ts,
    );
    db.prepare(`UPDATE sessions SET status = 'complete' WHERE id = ?`).run(session.id);
    setStatus(db, requestId, "closed");
    logEvent(db, requestId, "closed", actor, `Closed with receipt ${id} (${status}).`, {
      receipt: id,
      status,
    });
  });
  tx();
  return id;
}
