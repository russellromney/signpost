// Shared type definitions for the Signpost prototype.
//
// These mirror the JSON Schemas in /schemas, but are the runtime contracts the
// app actually uses. The first prototype supports exactly one request kind
// ("request") and one local owner ("russell").

export type IdentityKind =
  | "human"
  | "worker"
  | "org"
  | "team"
  | "service"
  | "gate";

export interface Identity {
  id: string;
  kind: IdentityKind;
  owner: string;
  display_name: string | null;
  description: string | null;
  gate: string | null;
  created_at: string;
}

// The lifecycle states a request moves through. Kept deliberately small.
export type RequestStatus =
  | "screening" // at the owner's gate, awaiting a decision
  | "needs_info" // gate asked the sender for more information
  | "needs_owner" // gate escalated to the owner to decide
  | "countered" // gate proposed modified terms; awaiting the sender's accept/decline
  | "accepted" // gate allowed work; a session may start
  | "denied" // gate refused; terminal
  | "active" // a worker session is running
  | "blocked" // worker hit a risky step; awaiting an execution-gate check
  | "ready_for_release" // worker says done; awaiting release check
  | "released" // release check passed; awaiting receipt
  | "closed"; // closed with a receipt; terminal

export interface SignpostRequest {
  id: string;
  from_id: string;
  to_id: string;
  kind: "request";
  goal: string;
  context: string[];
  definition_of_done: string[];
  constraints: string[];
  deadline: string | null;
  status: RequestStatus;
  created_at: string;
}

export type GateDecisionKind =
  | "allow"
  | "allow_with_limits"
  | "deny"
  | "ask_sender"
  | "ask_owner"
  | "route"
  | "counter";

// The gate checks three moments in the loop; a decision records which one.
export type GateScope = "request" | "execution" | "release";

export interface GateDecision {
  id: string;
  request_id: string;
  gate: string;
  decision: GateDecisionKind;
  scope: GateScope;
  action_id: string | null;
  auto: boolean; // true if the gate policy made this decision automatically
  rule: string | null; // the policy rule (or "default") that produced an auto decision
  limits: string[];
  reason: string[];
  route_to: string | null;
  created_at: string;
}

// A gate policy: ordered rules the gate evaluates at request time, plus a
// fallback decision when no rule matches.
export interface PolicyRule {
  name: string;
  from?: string; // match only requests from this sender
  allow_goals_matching?: string[]; // match if the goal contains any of these (case-insensitive)
  decision: GateDecisionKind;
  limits?: string[];
  reason?: string[];
  triggers?: string[]; // execution-time hints; not evaluated at request time yet
}

export interface GatePolicy {
  identity: string;
  default_decision: GateDecisionKind;
  rules: PolicyRule[];
  updated_at?: string;
}

export type SessionStatus = "active" | "complete" | "cancelled";

export interface Session {
  id: string;
  identity: string;
  request_id: string;
  status: SessionStatus;
  created_at: string;
}

export type SessionActionKind =
  | "accept"
  | "block"
  | "ask_owner"
  | "ask_sender"
  | "delegate"
  | "post_update"
  | "complete"
  | "cancel";

// When an action needs an execution-time gate check, gate_status tracks it.
export type ActionGateStatus = "pending" | "allowed" | "denied";

export interface SessionAction {
  id: string;
  session_id: string;
  identity: string;
  action: SessionActionKind;
  summary: string | null;
  requires_gate: boolean;
  gate_status: ActionGateStatus | null;
  created_at: string;
}

export type ReceiptStatus = "completed" | "failed" | "cancelled";

export interface Receipt {
  id: string;
  request_id: string;
  session_id: string;
  status: ReceiptStatus;
  artifacts: string[];
  evidence: string[];
  assumptions: string[];
  created_at: string;
}

// The append-only audit log. Every state change writes one row.
export interface EventRecord {
  id: string;
  request_id: string;
  type: string;
  actor: string;
  summary: string;
  data: Record<string, unknown>;
  created_at: string;
  // Monotonic cursor (the row's implicit rowid). Present on feed reads.
  seq?: number;
}

// A caller's relationship to a particular request. Authorization derives from it.
export type Role = "sender" | "worker" | "gate" | "owner";

export interface Identity_Token {
  token: string;
  identity: string;
  created_at: string;
}
