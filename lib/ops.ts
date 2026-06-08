// Authorized operations layer: caller-aware functions that compose
// load-the-request + authorize + mutate + return-detail. This is the single
// place authorization lives, shared by every surface — the REST routes and the
// MCP server both call these, so they can never enforce different rules.
//
// Deliberately free of any `next` import so it runs in a plain Node (MCP) context.
import { assertCan, AuthzError, canManage, isAdmin, rolesOf } from "./authz";
import type { DB } from "./db";
import { autoScreen, getPolicy, setPolicy } from "./policy";
import {
  eventsSince,
  getRequest,
  getRequestDetail,
  identityById,
  inboxFor,
  keyIdentity,
  listAdminEvents,
  listIdentities,
  listKeys,
  listRequestsFiltered,
  type EventFeed,
  type RequestDetail,
} from "./queries";
import {
  askGate,
  closeWithReceipt,
  createIdentity,
  createRequestIdempotent,
  decide,
  disableIdentity,
  enableIdentity,
  issueKey,
  markReadyForRelease,
  postUpdate,
  rejectRelease,
  release,
  resolveCheck,
  respondToCounter,
  respondToInfo,
  revokeKey,
  startSession,
  updateIdentity,
  ServiceError,
  type CreateIdentityInput,
  type CreateRequestInput,
  type DecideInput,
  type IssuedKey,
  type ReceiptInput,
  type UpdateIdentityInput,
} from "./service";
import type {
  AdminEvent,
  ApiKey,
  GatePolicy,
  Identity,
  RequestStatus,
  Role,
  SignpostRequest,
} from "./types";

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

export function opIdentities(db: DB, includeDisabled = false): Identity[] {
  return listIdentities(db, includeDisabled);
}

export function opGetIdentity(db: DB, _caller: string, id: string): Identity {
  const ident = identityById(db, id);
  if (!ident) throw new NotFoundError("not found");
  return ident;
}

// --- identity / owner / key management ---------------------------------------
//
// Authorization is the ownership tree: you manage identities you own (or own
// transitively); an admin manages anything; only an admin mints a new top-level
// principal (a self-owned identity).

export function opCreateIdentity(
  db: DB,
  caller: string,
  input: CreateIdentityInput,
): IssuedKey {
  const owner = input.owner?.trim() || input.id;
  const selfOwned = owner === input.id;
  if (selfOwned) {
    if (!isAdmin(db, caller)) {
      throw new AuthzError(`${caller} may not create a top-level principal (admin only)`);
    }
  } else if (!(owner === caller || canManage(db, caller, owner))) {
    throw new AuthzError(`${caller} may not create an identity owned by ${owner}`);
  }
  return createIdentity(db, input, caller);
}

export function opUpdateIdentity(
  db: DB,
  caller: string,
  id: string,
  patch: UpdateIdentityInput,
): Identity {
  if (!identityById(db, id)) throw new NotFoundError("not found");
  if (!canManage(db, caller, id)) throw new AuthzError(`${caller} may not manage ${id}`);
  updateIdentity(db, id, patch, caller);
  return identityById(db, id)!;
}

export function opDisableIdentity(db: DB, caller: string, id: string): Identity {
  if (!identityById(db, id)) throw new NotFoundError("not found");
  // Disabling yourself is a one-way lockout (you can't re-enable what can't
  // authenticate); require someone else who manages you to do it.
  if (caller === id) throw new AuthzError(`cannot disable yourself`);
  if (!canManage(db, caller, id)) throw new AuthzError(`${caller} may not manage ${id}`);
  disableIdentity(db, id, caller);
  return identityById(db, id)!;
}

export function opEnableIdentity(db: DB, caller: string, id: string): Identity {
  if (!identityById(db, id)) throw new NotFoundError("not found");
  if (!canManage(db, caller, id)) throw new AuthzError(`${caller} may not manage ${id}`);
  enableIdentity(db, id, caller);
  return identityById(db, id)!;
}

// An identity may manage its own keys (rotate, list, revoke) — self-service key
// rotation — in addition to anyone who manages it in the ownership tree.
function canManageKeys(db: DB, caller: string, identity: string): boolean {
  return caller === identity || canManage(db, caller, identity);
}

export function opListKeys(db: DB, caller: string, id: string): ApiKey[] {
  if (!identityById(db, id)) throw new NotFoundError("not found");
  if (!canManageKeys(db, caller, id)) {
    throw new AuthzError(`${caller} may not manage keys for ${id}`);
  }
  return listKeys(db, id);
}

export function opIssueKey(
  db: DB,
  caller: string,
  id: string,
  opts: { label?: string | null; expires_at?: string | null } = {},
): IssuedKey {
  if (!identityById(db, id)) throw new NotFoundError("not found");
  if (!canManageKeys(db, caller, id)) {
    throw new AuthzError(`${caller} may not issue keys for ${id}`);
  }
  return issueKey(db, id, { ...opts, actor: caller });
}

export function opRevokeKey(db: DB, caller: string, keyId: string): { revoked: string } {
  const identity = keyIdentity(db, keyId);
  if (!identity) throw new NotFoundError("not found");
  if (!canManageKeys(db, caller, identity)) {
    throw new AuthzError(`${caller} may not revoke keys for ${identity}`);
  }
  revokeKey(db, keyId, caller);
  return { revoked: keyId };
}

// The management audit. With an identity, returns that identity's events (anyone
// who manages it, or itself, may read). Without one, admin-only and global.
export function opAdminEvents(
  db: DB,
  caller: string,
  opts: { identity?: string; limit?: number } = {},
): AdminEvent[] {
  if (opts.identity) {
    if (!identityById(db, opts.identity)) throw new NotFoundError("not found");
    if (!canManageKeys(db, caller, opts.identity)) {
      throw new AuthzError(`${caller} may not read the audit for ${opts.identity}`);
    }
    return listAdminEvents(db, { target: opts.identity, limit: opts.limit });
  }
  if (!isAdmin(db, caller)) throw new AuthzError(`admin only`);
  return listAdminEvents(db, { limit: opts.limit });
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
  const result = createRequestIdempotent(db, idempotencyKey, { ...input, from_id: from });
  // Run the request-time gate immediately: the policy auto-decides known cases
  // and only exceptions are left for a human. Skip on idempotent replay.
  if (!result.replayed) autoScreen(db, result.id);
  return result;
}

export function opDecide(db: DB, caller: string, id: string, input: DecideInput): RequestDetail {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "decide", r);
  decide(db, id, input, caller);
  // A route re-addresses the request and sends it back to screening; run the new
  // recipient's gate immediately, exactly as on creation.
  if (input.decision === "route") autoScreen(db, id);
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

// The sender accepts or declines a gate's counter-offer.
export function opRespondCounter(
  db: DB,
  caller: string,
  id: string,
  accept: boolean,
): RequestDetail {
  const r = loadParty(db, caller, id);
  assertCan(db, caller, "respond_counter", r);
  respondToCounter(db, id, accept, caller);
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

// --- gate policy -------------------------------------------------------------

function ownerOfIdentity(db: DB, identity: string): string {
  return identityById(db, identity)?.owner ?? identity.split("/")[0];
}

// The identity itself or its owner may read the policy.
export function opGetPolicy(db: DB, caller: string, identity: string): GatePolicy | null {
  if (caller !== identity && caller !== ownerOfIdentity(db, identity)) {
    throw new AuthzError(`${caller} may not read the policy for ${identity}`);
  }
  return getPolicy(db, identity);
}

// Only the owner may change an identity's gate policy.
export function opSetPolicy(
  db: DB,
  caller: string,
  identity: string,
  policy: Partial<GatePolicy>,
): GatePolicy {
  if (!identityById(db, identity)) throw new NotFoundError("not found");
  if (caller !== ownerOfIdentity(db, identity)) {
    throw new AuthzError(`${caller} may not set the policy for ${identity}`);
  }
  return setPolicy(db, identity, policy);
}
