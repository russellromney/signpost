// The Signpost tool set, defined independently of the MCP transport so it can be
// unit-tested directly. Each tool is a thin wrapper over lib/ops — the same
// authorized layer the REST API uses — so the MCP surface enforces identical
// rules. `ctx.caller` is the authenticated identity (resolved from a token).
import { z } from "zod";

import type { DB } from "../lib/db";
import * as ops from "../lib/ops";
import type {
  GateDecisionKind,
  GatePolicy,
  ReceiptStatus,
  RequestStatus,
  Role,
} from "../lib/types";

export interface ToolCtx {
  db: DB;
  caller: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  run: (ctx: ToolCtx, args: Record<string, unknown>) => unknown;
}

const s = (v: unknown) => (typeof v === "string" ? v : "");
const sList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const num = (v: unknown) => (typeof v === "number" ? v : 0);

export const TOOLS: ToolDef[] = [
  {
    name: "whoami",
    description: "Return the identity you are authenticated as.",
    inputSchema: {},
    run: ({ db, caller }) => ops.opWhoami(db, caller),
  },
  {
    name: "list_identities",
    description: "List all identities in the system.",
    inputSchema: {},
    run: ({ db }) => ops.opIdentities(db),
  },
  {
    name: "inbox",
    description: "Your actionable work, bucketed by your role on each request.",
    inputSchema: {},
    run: ({ db, caller }) => ops.opInbox(db, caller),
  },
  {
    name: "events",
    description:
      "Cursor feed over the audit log, scoped to you. Pass `since` to get only newer events; `request` to filter one request.",
    inputSchema: {
      since: z.number().int().optional(),
      request: z.string().optional(),
      limit: z.number().int().optional(),
    },
    run: ({ db, caller }, a) =>
      ops.opEvents(db, caller, num(a.since), {
        request: a.request ? s(a.request) : undefined,
        limit: a.limit ? num(a.limit) : undefined,
      }),
  },
  {
    name: "list_requests",
    description:
      "List requests you are party to. Filter by role (sender|worker|gate|owner) and status.",
    inputSchema: {
      role: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().optional(),
    },
    run: ({ db, caller }, a) =>
      ops.opListRequests(db, caller, {
        role: a.role ? (s(a.role) as Role) : undefined,
        status: a.status ? (s(a.status) as RequestStatus) : undefined,
        limit: a.limit ? num(a.limit) : undefined,
      }),
  },
  {
    name: "get_request",
    description: "Full state of one request (decisions, session, receipt, events).",
    inputSchema: { id: z.string() },
    run: ({ db, caller }, a) => ops.opGetRequest(db, caller, s(a.id)),
  },
  {
    name: "create_request",
    description:
      "Send a request to an identity. It routes through the recipient's gate (which may auto-decide).",
    inputSchema: {
      to: z.string(),
      goal: z.string(),
      definition_of_done: z.array(z.string()),
      constraints: z.array(z.string()).optional(),
      context: z.array(z.string()).optional(),
      deadline: z.string().optional(),
      idempotency_key: z.string().optional(),
    },
    run: ({ db, caller }, a) =>
      ops.opCreateRequest(
        db,
        caller,
        {
          to_id: s(a.to),
          goal: s(a.goal),
          definition_of_done: sList(a.definition_of_done),
          constraints: sList(a.constraints),
          context: sList(a.context),
          deadline: a.deadline ? s(a.deadline) : null,
        },
        a.idempotency_key ? s(a.idempotency_key) : null,
      ),
  },
  {
    name: "decide",
    description:
      "Gate decision on a request (request-time gate): allow | allow_with_limits | deny | ask_sender | ask_owner.",
    inputSchema: {
      id: z.string(),
      decision: z.string(),
      limits: z.array(z.string()).optional(),
      reason: z.array(z.string()).optional(),
    },
    run: ({ db, caller }, a) =>
      ops.opDecide(db, caller, s(a.id), {
        decision: s(a.decision) as GateDecisionKind,
        limits: sList(a.limits),
        reason: sList(a.reason),
      }),
  },
  {
    name: "respond_info",
    description: "As the sender, answer a gate's ask_sender. Re-enters the gate.",
    inputSchema: { id: z.string(), answers: z.array(z.string()) },
    run: ({ db, caller }, a) => ops.opRespondInfo(db, caller, s(a.id), sList(a.answers)),
  },
  {
    name: "start_session",
    description: "As the worker, claim an accepted request and start a session.",
    inputSchema: { id: z.string() },
    run: ({ db, caller }, a) => ops.opStartSession(db, caller, s(a.id)),
  },
  {
    name: "post_update",
    description: "As the worker, post a progress note on the active session.",
    inputSchema: { id: z.string(), summary: z.string() },
    run: ({ db, caller }, a) => ops.opSessionAction(db, caller, s(a.id), "post_update", s(a.summary)),
  },
  {
    name: "ask_gate",
    description:
      "As the worker, flag a risky step. The request blocks until the gate resolves the check.",
    inputSchema: { id: z.string(), summary: z.string() },
    run: ({ db, caller }, a) => ops.opSessionAction(db, caller, s(a.id), "ask_gate", s(a.summary)),
  },
  {
    name: "complete",
    description: "As the worker, mark the request ready for release.",
    inputSchema: { id: z.string(), summary: z.string().optional() },
    run: ({ db, caller }, a) => ops.opSessionAction(db, caller, s(a.id), "complete", s(a.summary)),
  },
  {
    name: "resolve_check",
    description: "As the gate, resolve a pending execution check (allow=true lets the worker proceed).",
    inputSchema: { id: z.string(), allow: z.boolean(), reason: z.array(z.string()).optional() },
    run: ({ db, caller }, a) =>
      ops.opResolveCheck(db, caller, s(a.id), a.allow !== false, sList(a.reason)),
  },
  {
    name: "release",
    description: "As the gate/owner, pass the release check and release the output.",
    inputSchema: { id: z.string() },
    run: ({ db, caller }, a) => ops.opRelease(db, caller, s(a.id)),
  },
  {
    name: "reject_release",
    description: "As the gate/owner, reject the release and send it back to the worker.",
    inputSchema: { id: z.string(), reason: z.string().optional() },
    run: ({ db, caller }, a) => ops.opRejectRelease(db, caller, s(a.id), s(a.reason)),
  },
  {
    name: "close",
    description: "Close a released request with a receipt (evidence is required).",
    inputSchema: {
      id: z.string(),
      evidence: z.array(z.string()),
      status: z.string().optional(),
      artifacts: z.array(z.string()).optional(),
      assumptions: z.array(z.string()).optional(),
    },
    run: ({ db, caller }, a) =>
      ops.opClose(db, caller, s(a.id), {
        evidence: sList(a.evidence),
        status: a.status ? (s(a.status) as ReceiptStatus) : "completed",
        artifacts: sList(a.artifacts),
        assumptions: sList(a.assumptions),
      }),
  },
  {
    name: "get_policy",
    description: "Read an identity's gate policy (you must be the identity or its owner).",
    inputSchema: { identity: z.string() },
    run: ({ db, caller }, a) => ops.opGetPolicy(db, caller, s(a.identity)),
  },
  {
    name: "set_policy",
    description: "Replace an identity's gate policy (owner only).",
    inputSchema: {
      identity: z.string(),
      default_decision: z.string().optional(),
      rules: z.array(z.unknown()).optional(),
    },
    run: ({ db, caller }, a) =>
      ops.opSetPolicy(db, caller, s(a.identity), {
        default_decision: a.default_decision ? (s(a.default_decision) as GateDecisionKind) : undefined,
        rules: Array.isArray(a.rules) ? (a.rules as GatePolicy["rules"]) : undefined,
      }),
  },
];
