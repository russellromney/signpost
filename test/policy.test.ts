// Tests for the gate policy engine: evaluation, auto-screening on create, and
// the owner-only policy editing operations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb } from "../lib/db";
import { autoScreen, evaluatePolicy, getPolicy, setPolicy } from "../lib/policy";
import { opGetPolicy, opSetPolicy, opCreateRequest } from "../lib/ops";
import { createRequest, ServiceError } from "../lib/service";
import { getRequest, getRequestDetail } from "../lib/queries";
import { AuthzError } from "../lib/authz";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "signpost-policy-"));
  return { db: createDb(join(dir, "t.db")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("seeded policy: matching tracking request -> allow_with_limits", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "Add launch tracking to the CTA.",
      definition_of_done: ["x"],
    });
    const result = evaluatePolicy(db, getRequest(db, id)!);
    assert.equal(result?.decision, "allow_with_limits");
    assert.equal(result?.rule, "marketing_analytics_requests");
    assert.ok(result!.limits.length > 0);
  } finally {
    cleanup();
  }
});

test("non-matching request falls through to the default decision", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "Rewrite the onboarding email.",
      definition_of_done: ["x"],
    });
    const result = evaluatePolicy(db, getRequest(db, id)!);
    assert.equal(result?.decision, "ask_owner");
    assert.equal(result?.rule, "default");
  } finally {
    cleanup();
  }
});

test("no policy for the recipient -> evaluate returns null (stays manual)", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = createRequest(db, {
      from_id: "russell/coding",
      to_id: "maya/marketing", // no seeded policy
      goal: "anything",
      definition_of_done: ["x"],
    });
    assert.equal(evaluatePolicy(db, getRequest(db, id)!), null);
    assert.equal(autoScreen(db, id), null);
    assert.equal(getRequest(db, id)!.status, "screening");
  } finally {
    cleanup();
  }
});

test("autoScreen auto-accepts a matching request and records provenance", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "Add analytics tracking.",
      definition_of_done: ["x"],
    });
    autoScreen(db, id);
    const detail = getRequestDetail(db, id)!;
    assert.equal(detail.request.status, "accepted");
    assert.equal(detail.decisions[0].auto, true);
    assert.equal(detail.decisions[0].rule, "marketing_analytics_requests");
  } finally {
    cleanup();
  }
});

test("opCreateRequest runs the gate automatically (humans see only exceptions)", () => {
  const { db, cleanup } = freshDb();
  try {
    const matching = opCreateRequest(db, "maya/marketing", {
      to_id: "russell/coding",
      goal: "tracking pixels",
      definition_of_done: ["x"],
    });
    assert.equal(getRequest(db, matching.id)!.status, "accepted");

    const exception = opCreateRequest(db, "maya/marketing", {
      to_id: "russell/coding",
      goal: "delete the database",
      definition_of_done: ["x"],
    });
    assert.equal(getRequest(db, exception.id)!.status, "needs_owner");
  } finally {
    cleanup();
  }
});

test("setPolicy validates; getPolicy round-trips", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.throws(
      () => setPolicy(db, "russell/coding", { default_decision: "banana" as never, rules: [] }),
      ServiceError,
    );
    assert.throws(
      () => setPolicy(db, "russell/coding", { rules: [{ name: "", decision: "allow" }] }),
      ServiceError,
    );
    const saved = setPolicy(db, "russell/coding", {
      default_decision: "deny",
      rules: [{ name: "r1", from: "maya/marketing", allow_goals_matching: ["x"], decision: "allow" }],
    });
    assert.equal(saved.default_decision, "deny");
    assert.equal(getPolicy(db, "russell/coding")!.rules[0].name, "r1");
  } finally {
    cleanup();
  }
});

test("policy editing is owner-only; the identity can read its own", () => {
  const { db, cleanup } = freshDb();
  try {
    // russell owns russell/coding -> may set.
    assert.ok(opSetPolicy(db, "russell", "russell/coding", { default_decision: "deny", rules: [] }));
    // maya may not set someone else's policy.
    assert.throws(
      () => opSetPolicy(db, "maya/marketing", "russell/coding", { rules: [] }),
      AuthzError,
    );
    // The identity itself and its owner may read; an outsider may not.
    assert.ok(opGetPolicy(db, "russell/coding", "russell/coding"));
    assert.ok(opGetPolicy(db, "russell", "russell/coding"));
    assert.throws(() => opGetPolicy(db, "maya/marketing", "russell/coding"), AuthzError);
  } finally {
    cleanup();
  }
});
