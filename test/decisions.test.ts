// Tests for the two gate decisions that re-shape a request rather than simply
// admitting or refusing it: `route` (re-address to another identity) and
// `counter` (propose terms the sender must accept or decline).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb } from "../lib/db";
import { createRequest, decide, respondToCounter, startSession, ServiceError } from "../lib/service";
import { setPolicy } from "../lib/policy";
import { can, AuthzError } from "../lib/authz";
import { opCreateRequest, opDecide, opRespondCounter } from "../lib/ops";
import { getRequest, getRequestDetail } from "../lib/queries";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "signpost-dec-"));
  const db = createDb(join(dir, "test.db"));
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function seed(db: ReturnType<typeof createDb>, to = "russell/coding", goal = "Refactor billing.") {
  return createRequest(db, {
    from_id: "maya/marketing",
    to_id: to,
    goal,
    definition_of_done: ["Done."],
  });
}

// --- route -------------------------------------------------------------------

test("route re-addresses the request and sends it back to screening", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seed(db, "russell", "Review the contract."); // russell has no policy
    assert.equal(getRequest(db, id)!.status, "screening");

    decide(db, id, { decision: "route", route_to: "russell/coding" });

    const d = getRequestDetail(db, id)!;
    assert.equal(d.request.to_id, "russell/coding");
    assert.equal(d.request.status, "screening");
    const last = d.decisions[d.decisions.length - 1];
    assert.equal(last.decision, "route");
    assert.equal(last.route_to, "russell/coding");
    assert.ok(d.events.some((e) => e.type === "request_routed"));
  } finally {
    cleanup();
  }
});

test("route rejects an unknown target, the current recipient, or a missing target", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seed(db);
    assert.throws(() => decide(db, id, { decision: "route", route_to: "nobody/here" }), ServiceError);
    assert.throws(() => decide(db, id, { decision: "route", route_to: "russell/coding" }), ServiceError);
    assert.throws(() => decide(db, id, { decision: "route" }), ServiceError);
    // None of the failed attempts changed the request.
    assert.equal(getRequest(db, id)!.status, "screening");
    assert.equal(getRequest(db, id)!.to_id, "russell/coding");
  } finally {
    cleanup();
  }
});

test("routing through ops re-screens at the new recipient's gate", () => {
  const { db, cleanup } = freshDb();
  try {
    // Addressed to russell (no policy) so it waits for a human at first.
    const { id } = opCreateRequest(db, "maya/marketing", {
      to_id: "russell",
      goal: "Add launch tracking to the CTA.",
      definition_of_done: ["Event fires."],
    });
    assert.equal(getRequest(db, id)!.status, "screening");

    // russell (the owner) routes it to russell/coding, whose policy matches a
    // marketing tracking request and auto-allows with limits.
    opDecide(db, "russell", id, { decision: "route", route_to: "russell/coding" });

    const r = getRequest(db, id)!;
    assert.equal(r.to_id, "russell/coding");
    assert.equal(r.status, "accepted");
  } finally {
    cleanup();
  }
});

// --- counter -----------------------------------------------------------------

test("counter proposes terms; the sender accepts and work proceeds", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seed(db);
    decide(db, id, {
      decision: "counter",
      limits: ["Scope to the header CTA only."],
      reason: ["Original scope is too broad."],
    });
    assert.equal(getRequest(db, id)!.status, "countered");

    respondToCounter(db, id, true);
    assert.equal(getRequest(db, id)!.status, "accepted");
    assert.ok(startSession(db, id).startsWith("sess_"));
  } finally {
    cleanup();
  }
});

test("declining a counter closes the request", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seed(db);
    decide(db, id, { decision: "counter", reason: ["Not as specified."] });
    respondToCounter(db, id, false);
    assert.equal(getRequest(db, id)!.status, "denied");
  } finally {
    cleanup();
  }
});

test("a counter must propose terms, and only a countered request can be answered", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seed(db);
    assert.throws(() => decide(db, id, { decision: "counter" }), ServiceError); // no terms
    assert.throws(() => respondToCounter(db, id, true), ServiceError); // still screening
  } finally {
    cleanup();
  }
});

// --- authorization -----------------------------------------------------------

test("only the sender may respond to a counter", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seed(db);
    const r = getRequest(db, id)!;
    assert.ok(can(db, "maya/marketing", "respond_counter", r));
    assert.ok(!can(db, "russell", "respond_counter", r));
    assert.ok(!can(db, "russell/coding", "respond_counter", r));

    decide(db, id, { decision: "counter", reason: ["Narrow it."] });
    assert.throws(() => opRespondCounter(db, "russell", id, true), AuthzError);
    opRespondCounter(db, "maya/marketing", id, true);
    assert.equal(getRequest(db, id)!.status, "accepted");
  } finally {
    cleanup();
  }
});

// --- policy ------------------------------------------------------------------

test("a gate policy may not use route or counter as a decision", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.throws(() => setPolicy(db, "russell/coding", { default_decision: "route" }), ServiceError);
    assert.throws(
      () =>
        setPolicy(db, "russell/coding", {
          rules: [{ name: "x", from: "maya/marketing", decision: "counter" }],
        }),
      ServiceError,
    );
  } finally {
    cleanup();
  }
});
