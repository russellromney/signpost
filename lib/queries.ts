// Read-side helpers: row mappers and inbox/detail queries.
import type { DB } from "./db";
import { rolesOf } from "./authz";
import type {
  EventRecord,
  GateDecision,
  Identity,
  Receipt,
  Role,
  Session,
  SessionAction,
  SignpostRequest,
  RequestStatus,
} from "./types";

type Row = Record<string, unknown>;

const json = (v: unknown): string[] => JSON.parse((v as string) ?? "[]");

function mapRequest(r: Row): SignpostRequest {
  return {
    id: r.id as string,
    from_id: r.from_id as string,
    to_id: r.to_id as string,
    kind: "request",
    goal: r.goal as string,
    context: json(r.context),
    definition_of_done: json(r.definition_of_done),
    constraints: json(r.constraints),
    deadline: (r.deadline as string) ?? null,
    status: r.status as RequestStatus,
    created_at: r.created_at as string,
  };
}

function mapIdentity(r: Row): Identity {
  return {
    id: r.id as string,
    kind: r.kind as Identity["kind"],
    owner: r.owner as string,
    display_name: (r.display_name as string) ?? null,
    description: (r.description as string) ?? null,
    gate: (r.gate as string) ?? null,
    created_at: r.created_at as string,
  };
}

function mapDecision(r: Row): GateDecision {
  return {
    id: r.id as string,
    request_id: r.request_id as string,
    gate: r.gate as string,
    decision: r.decision as GateDecision["decision"],
    scope: (r.scope as GateDecision["scope"]) ?? "request",
    action_id: (r.action_id as string) ?? null,
    limits: json(r.limits),
    reason: json(r.reason),
    route_to: (r.route_to as string) ?? null,
    created_at: r.created_at as string,
  };
}

function mapSession(r: Row): Session {
  return {
    id: r.id as string,
    identity: r.identity as string,
    request_id: r.request_id as string,
    status: r.status as Session["status"],
    created_at: r.created_at as string,
  };
}

function mapAction(r: Row): SessionAction {
  return {
    id: r.id as string,
    session_id: r.session_id as string,
    identity: r.identity as string,
    action: r.action as SessionAction["action"],
    summary: (r.summary as string) ?? null,
    requires_gate: Boolean(r.requires_gate),
    gate_status: (r.gate_status as SessionAction["gate_status"]) ?? null,
    created_at: r.created_at as string,
  };
}

function mapReceipt(r: Row): Receipt {
  return {
    id: r.id as string,
    request_id: r.request_id as string,
    session_id: r.session_id as string,
    status: r.status as Receipt["status"],
    artifacts: json(r.artifacts),
    evidence: json(r.evidence),
    assumptions: json(r.assumptions),
    created_at: r.created_at as string,
  };
}

function mapEvent(r: Row): EventRecord {
  return {
    id: r.id as string,
    request_id: r.request_id as string,
    type: r.type as string,
    actor: r.actor as string,
    summary: r.summary as string,
    data: JSON.parse((r.data as string) ?? "{}"),
    created_at: r.created_at as string,
  };
}

export function listIdentities(db: DB): Identity[] {
  return (db.prepare(`SELECT * FROM identities ORDER BY id`).all() as Row[]).map(mapIdentity);
}

export function getRequest(db: DB, id: string): SignpostRequest | null {
  const r = db.prepare(`SELECT * FROM requests WHERE id = ?`).get(id) as Row | undefined;
  return r ? mapRequest(r) : null;
}

export function identityById(db: DB, id: string): Identity | null {
  const r = db.prepare(`SELECT * FROM identities WHERE id = ?`).get(id) as Row | undefined;
  return r ? mapIdentity(r) : null;
}

export function listRequests(db: DB): SignpostRequest[] {
  return (db.prepare(`SELECT * FROM requests ORDER BY created_at DESC`).all() as Row[]).map(
    mapRequest,
  );
}

// --- Agent-facing reads ------------------------------------------------------

export interface RequestFilter {
  caller?: string; // restrict to requests this identity is party to
  role?: Role; // ...in this specific role
  status?: RequestStatus;
  limit?: number;
}

// List requests with optional filters. Agents use this to find their work,
// e.g. role=worker&status=accepted = "what should I start?".
export function listRequestsFiltered(db: DB, f: RequestFilter = {}): SignpostRequest[] {
  let rows = listRequests(db);
  if (f.status) rows = rows.filter((r) => r.status === f.status);
  if (f.caller) {
    rows = rows.filter((r) => {
      const roles = rolesOf(db, f.caller!, r);
      if (roles.length === 0) return false;
      return f.role ? roles.includes(f.role) : true;
    });
  }
  if (f.limit && f.limit > 0) rows = rows.slice(0, f.limit);
  return rows;
}

// IDs of every request the caller has any role on. Used to scope the event feed.
function visibleRequestIds(db: DB, caller: string): Set<string> {
  const ids = new Set<string>();
  for (const r of listRequests(db)) {
    if (rolesOf(db, caller, r).length > 0) ids.add(r.id);
  }
  return ids;
}

export interface EventFeed {
  events: EventRecord[];
  cursor: number; // pass back as `since` to get only newer events
}

// Cursor-based feed over the append-only log, scoped to what the caller can see.
// This single primitive powers "check in" and "check messages" without a chat box.
export function eventsSince(
  db: DB,
  caller: string,
  since = 0,
  opts: { request?: string; limit?: number } = {},
): EventFeed {
  const visible = visibleRequestIds(db, caller);
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 500) : 100;
  const rows = db
    .prepare(`SELECT rowid AS seq, * FROM events WHERE rowid > ? ORDER BY rowid LIMIT ?`)
    .all(since, limit) as Row[];

  const events: EventRecord[] = [];
  for (const row of rows) {
    const rid = row.request_id as string;
    if (!visible.has(rid)) continue;
    if (opts.request && rid !== opts.request) continue;
    events.push({ ...mapEvent(row), seq: row.seq as number });
  }
  const cursor = rows.length > 0 ? (rows[rows.length - 1].seq as number) : since;
  return { events, cursor };
}

// Per-identity inbox: actionable items bucketed by the caller's role on each
// request. This is the agent's "what needs me right now?".
export function inboxFor(db: DB, caller: string): Record<string, SignpostRequest[]> {
  const buckets: Record<string, SignpostRequest[]> = {
    needs_decision: [], // gate/owner: screening or escalated
    needs_exec_check: [], // gate/owner: worker is blocked on a risky step
    needs_release_check: [], // gate/owner: ready_for_release
    needs_info: [], // sender: gate asked you for more info
    ready_to_start: [], // worker: accepted, start a session
    active: [], // worker: a session is running
    awaiting_receipt: [], // worker: released, write the receipt
    waiting: [], // sender: in flight, nothing for you to do
    done: [], // closed or denied
  };
  for (const r of listRequests(db)) {
    const roles = rolesOf(db, caller, r);
    if (roles.length === 0) continue;
    const gateish = roles.includes("gate") || roles.includes("owner");
    const worker = roles.includes("worker");
    const sender = roles.includes("sender");

    if (r.status === "closed" || r.status === "denied") buckets.done.push(r);
    else if (gateish && (r.status === "screening" || r.status === "needs_owner"))
      buckets.needs_decision.push(r);
    else if (gateish && r.status === "blocked") buckets.needs_exec_check.push(r);
    else if (gateish && r.status === "ready_for_release") buckets.needs_release_check.push(r);
    else if (sender && r.status === "needs_info") buckets.needs_info.push(r);
    else if (worker && r.status === "accepted") buckets.ready_to_start.push(r);
    else if (worker && (r.status === "active" || r.status === "blocked")) buckets.active.push(r);
    else if (worker && r.status === "released") buckets.awaiting_receipt.push(r);
    else buckets.waiting.push(r);
  }
  return buckets;
}

// The inbox views from the spec. A request appears in exactly one bucket.
export const INBOX_VIEWS: Array<{ key: string; label: string; statuses: RequestStatus[] }> = [
  { key: "needs_gate", label: "Needs Gate Decision", statuses: ["screening"] },
  { key: "active", label: "Active", statuses: ["accepted", "active"] },
  { key: "needs_human", label: "Needs Human", statuses: ["needs_info", "needs_owner", "blocked"] },
  { key: "ready", label: "Ready For Release", statuses: ["ready_for_release", "released"] },
  { key: "done", label: "Done", statuses: ["closed", "denied"] },
];

export function inbox(db: DB): Record<string, SignpostRequest[]> {
  const all = listRequests(db);
  const out: Record<string, SignpostRequest[]> = {};
  for (const view of INBOX_VIEWS) {
    out[view.key] = all.filter((r) => view.statuses.includes(r.status));
  }
  return out;
}

export interface RequestDetail {
  request: SignpostRequest;
  decisions: GateDecision[];
  session: Session | null;
  actions: SessionAction[];
  receipt: Receipt | null;
  events: EventRecord[];
}

export function getRequestDetail(db: DB, id: string): RequestDetail | null {
  const request = getRequest(db, id);
  if (!request) return null;

  const decisions = (
    db.prepare(`SELECT * FROM gate_decisions WHERE request_id = ? ORDER BY created_at`).all(id) as Row[]
  ).map(mapDecision);

  const sessionRow = db
    .prepare(`SELECT * FROM sessions WHERE request_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(id) as Row | undefined;
  const session = sessionRow ? mapSession(sessionRow) : null;

  const actions = session
    ? (
        db
          .prepare(`SELECT * FROM session_actions WHERE session_id = ? ORDER BY created_at`)
          .all(session.id) as Row[]
      ).map(mapAction)
    : [];

  const receiptRow = db
    .prepare(`SELECT * FROM receipts WHERE request_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(id) as Row | undefined;
  const receipt = receiptRow ? mapReceipt(receiptRow) : null;

  const events = (
    db.prepare(`SELECT * FROM events WHERE request_id = ? ORDER BY rowid`).all(id) as Row[]
  ).map(mapEvent);

  return { request, decisions, session, actions, receipt, events };
}
