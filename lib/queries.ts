// Read-side helpers: row mappers and inbox/detail queries.
import type { DB } from "./db";
import type {
  EventRecord,
  GateDecision,
  Identity,
  Receipt,
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

export function listRequests(db: DB): SignpostRequest[] {
  return (db.prepare(`SELECT * FROM requests ORDER BY created_at DESC`).all() as Row[]).map(
    mapRequest,
  );
}

// The inbox views from the spec. A request appears in exactly one bucket.
export const INBOX_VIEWS: Array<{ key: string; label: string; statuses: RequestStatus[] }> = [
  { key: "needs_gate", label: "Needs Gate Decision", statuses: ["screening"] },
  { key: "active", label: "Active", statuses: ["accepted", "active"] },
  { key: "needs_human", label: "Needs Human", statuses: ["needs_info", "needs_owner"] },
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
