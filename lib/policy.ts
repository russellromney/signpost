// The gate policy engine. The gate is the product, and this is what lets it run
// itself: at request time it evaluates the recipient's policy and decides, so a
// human only sees the requests the policy escalates.
//
// Scope (by design, for now): request-time only. Execution-time and release-time
// checks remain manual. Rules carrying only `triggers` are ignored here.
import { gateOf } from "./authz";
import type { DB } from "./db";
import { getRequest } from "./queries";
import { decide, ServiceError } from "./service";
import type { GateDecisionKind, GatePolicy, PolicyRule, SignpostRequest } from "./types";

const DECISIONS: GateDecisionKind[] = [
  "allow",
  "allow_with_limits",
  "deny",
  "ask_sender",
  "ask_owner",
  "route",
  "counter",
];

export function getPolicy(db: DB, identity: string): GatePolicy | null {
  const row = db.prepare(`SELECT * FROM gate_policies WHERE identity = ?`).get(identity) as
    | { identity: string; default_decision: string; rules: string; updated_at: string }
    | undefined;
  if (!row) return null;
  return {
    identity: row.identity,
    default_decision: row.default_decision as GateDecisionKind,
    rules: JSON.parse(row.rules) as PolicyRule[],
    updated_at: row.updated_at,
  };
}

// Validate and persist a policy. Owner-only enforcement happens in the ops layer.
export function setPolicy(db: DB, identity: string, policy: Partial<GatePolicy>): GatePolicy {
  const def = policy.default_decision ?? "ask_owner";
  if (!DECISIONS.includes(def)) throw new ServiceError(`invalid default_decision "${def}"`);
  const rules = Array.isArray(policy.rules) ? policy.rules : [];
  for (const r of rules) {
    if (!r || typeof r.name !== "string" || !r.name.trim()) {
      throw new ServiceError("each rule needs a name");
    }
    if (!DECISIONS.includes(r.decision)) {
      throw new ServiceError(`rule "${r.name}" has invalid decision "${r.decision}"`);
    }
  }
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO gate_policies (identity, default_decision, rules, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(identity) DO UPDATE SET default_decision = excluded.default_decision,
       rules = excluded.rules, updated_at = excluded.updated_at`,
  ).run(identity, def, JSON.stringify(rules), ts);
  return { identity, default_decision: def, rules, updated_at: ts };
}

export interface PolicyResult {
  decision: GateDecisionKind;
  limits: string[];
  reason: string[];
  rule: string;
}

function ruleMatches(rule: PolicyRule, req: SignpostRequest): boolean {
  // A rule with only triggers is an execution-time rule; skip it at request time.
  if (!rule.from && !rule.allow_goals_matching) return false;
  if (rule.from && rule.from !== req.from_id) return false;
  if (rule.allow_goals_matching && rule.allow_goals_matching.length > 0) {
    const goal = req.goal.toLowerCase();
    if (!rule.allow_goals_matching.some((term) => goal.includes(term.toLowerCase()))) return false;
  }
  return true;
}

// Evaluate the recipient's policy for a request. Returns null when there is no
// policy at all (caller should leave the request for a manual decision).
export function evaluatePolicy(db: DB, req: SignpostRequest): PolicyResult | null {
  const policy = getPolicy(db, req.to_id);
  if (!policy) return null;

  for (const rule of policy.rules) {
    if (ruleMatches(rule, req)) {
      return {
        decision: rule.decision,
        limits: rule.limits ?? [],
        reason: [`Matched policy rule "${rule.name}".`, ...(rule.reason ?? [])],
        rule: rule.name,
      };
    }
  }
  return {
    decision: policy.default_decision,
    limits: [],
    reason: ["No policy rule matched; applied the default decision."],
    rule: "default",
  };
}

// Run the request-time gate automatically. Applies the policy's decision as an
// auto gate decision (attributed to the gate identity). Returns null when there
// is no policy, leaving the request at "screening" for a manual decision.
export function autoScreen(db: DB, requestId: string): PolicyResult | null {
  const req = getRequest(db, requestId);
  if (!req || req.status !== "screening") return null;
  const result = evaluatePolicy(db, req);
  if (!result) return null;
  decide(
    db,
    requestId,
    { decision: result.decision, limits: result.limits, reason: result.reason },
    gateOf(db, req),
    { auto: true, rule: result.rule },
  );
  return result;
}
