// Authorized operations layer: caller-aware functions that compose
// load-the-request + authorize + mutate + return-detail. This is the single
// place authorization lives, shared by every surface — the REST routes and the
// MCP server both call these, so they can never enforce different rules.
//
// Deliberately free of any `next` import so it runs in a plain Node (MCP) context.
import { assertCan, AuthzError, rolesOf } from "./authz";
import type { DB } from "./db";
import {
  eventsSince,
  getRequest,
  getRequestDetail,
  identityById,
  inboxFor,
  listIdentities,
  listRequestsFiltered,
  type EventFeed,
  type RequestDetail,
} from "./queries";
import {
  askGate,
  closeWithReceipt,
  createRequestIdempotent,
  decide,
  markReadyForRelease,
  postUpdate,
  rejectRelease,
  release,
  resolveCheck,
  respondToInfo,
  startSession,
  ServiceError,
  type CreateRequestInput,
  type DecideInput,
  type ReceiptInput,
} from "./service";
import type { Identity, RequestStatus, Role, SignpostRequest } from "./types";

// Thrown when a request does not exist OR the caller is not party to it. Both map
// to 404 so endpoints never reveal the existence of requests you can't see.
export class NotFoundError extends Error {}

export function loadParty(db: DB, caller: string, id: string): SignpostRequest {
  const r = getRequest(db, id);
  if (!r || rolesOf(db, caller, r).length === 0) throw new NotFoundError("not found");
  return r;
}

function detail(db: DB, id: string): RequestDetail {
  // Non-null: callers always pass an id that exists (we just mutated it).
  return getRequestDetail(db, id)!;
}

// --- reads -------------------------------------------------------------------

export function opWhoami(db: DB, caller: string): Identity | null {
  return identityById(db, caller);
}

export function opIdentities(db: DB): Identity[] {
  return listIdentities(db);
}

export function opInbox(db: DB, caller: string) {
  return inboxFor(db, caller);
}

export function opEvents(
  db: DB,
  caller: string,
  since: number,
  opts: { request?: string; limit?: number } = {},
): EventFeed {
  return eventsSince(db, caller, since, opts);
}

export function opListRequests(
  db: DB,
  caller: string,
  filter: { role?: Role; status?: RequestStatus; limit?: number } = {},
): SignpostRequest[] {
  return listRequestsFiltered(db, { caller, ...filter });
}

export function opGetRequest(db: DB, caller: string, id: string): RequestDetail {
  loadParty(db, caller, id);
  return detail(db, id);
}

// --- writes ------------------------------------------------------------------

// You may only create a request as yourself, so `from` must be the caller.
export function opCreateRequest(
  db: DB,
  caller: string,
  input: Omit<CreateRequestInput, "from_id"> & { from_id?: string },
  idempotencyKey: string | null = null,
): { id: string; replayed: boolean } {
  const from = input.from_id ?? caller;
  if (from !== caller) throw new AuthzError(`${caller} may not create a request as ${from}`);
  return createRequestIdempotent(db, idempotencyKey, { ...input, from_id: from });
}

export function opDecide(db: DB, caller: string, id: string, input: DecideInput): RequestDetail {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "decide", r);
  decide(db, id, input, caller);
  return detail(db, id);
}

export function opRespondInfo(
  db: DB,
  caller: string,
  id: string,
  answers: string[],
): RequestDetail {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "respond_info", r);
  respondToInfo(db, id, answers, caller);
  return detail(db, id);
}

export function opStartSession(
  db: DB,
  caller: string,
  id: string,
): RequestDetail & { session_id: string } {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "start_session", r);
  const session_id = startSession(db, id);
  return { session_id, ...detail(db, id) };
}

export type SessionActionKindInput = "post_update" | "ask_gate" | "complete";

export function opSessionAction(
  db: DB,
  caller: string,
  id: string,
  action: SessionActionKindInput,
  summary?: string,
): RequestDetail {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "session_action", r);
  switch (action) {
    case "post_update":
      postUpdate(db, id, summary ?? "");
      break;
    case "ask_gate":
      askGate(db, id, summary ?? "");
      break;
    case "complete":
      markReadyForRelease(db, id, summary);
      break;
    default:
      throw new ServiceError("action must be post_update, ask_gate, or complete");
  }
  return detail(db, id);
}

export function opResolveCheck(
  db: DB,
  caller: string,
  id: string,
  allow: boolean,
  reason: string[] = [],
): RequestDetail {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "resolve_check", r);
  resolveCheck(db, id, allow, reason, caller);
  return detail(db, id);
}

export function opRelease(db: DB, caller: string, id: string): RequestDetail {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "release", r);
  release(db, id, caller);
  return detail(db, id);
}

export function opRejectRelease(
  db: DB,
  caller: string,
  id: string,
  reason: string,
): RequestDetail {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "reject_release", r);
  rejectRelease(db, id, reason, caller);
  return detail(db, id);
}

export function opClose(
  db: DB,
  caller: string,
  id: string,
  input: ReceiptInput,
): RequestDetail & { receipt_id: string } {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "close", r);
  const receipt_id = closeWithReceipt(db, id, input, caller);
  return { receipt_id, ...detail(db, id) };
}
