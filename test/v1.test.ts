// Tests for the agent-facing v1 layer: auth, role-based authorization, the
// protocol gaps (respond-to-info, execution gate), and the polling reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, tokenFor } from "../lib/db";
import { identityForToken, AuthError } from "../lib/auth";
import { rolesOf, can, gateOf, ownerOf } from "../lib/authz";
import {
  askGate,
  createRequest,
  createRequestIdempotent,
  decide,
  resolveCheck,
  respondToInfo,
  startSession,
} from "../lib/service";
import { eventsSince, getRequest, inboxFor, listRequestsFiltered } from "../lib/queries";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "signpost-v1-"));
  const db = createDb(join(dir, "test.db"));
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function seedRequest(db: ReturnType<typeof createDb>) {
  return createRequest(db, {
    from_id: "maya/marketing",
    to_id: "russell/coding",
    goal: "Add launch tracking to the signup CTA.",
    definition_of_done: ["Event fires."],
  });
}

test("tokens resolve to their identity; bad tokens throw", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.equal(identityForToken(db, tokenFor("russell/coding")), "russell/coding");
    assert.equal(identityForToken(db, "sk_maya_marketing"), "maya/marketing");
    assert.throws(() => identityForToken(db, "nope"), AuthError);
    assert.throws(() => identityForToken(db, null), AuthError);
  } finally {
    cleanup();
  }
});

test("roles derive from the request; russell is both gate and owner", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seedRequest(db);
    const r = getRequest(db, id)!;
    assert.equal(gateOf(db, r), "russell/gate");
    assert.equal(ownerOf(db, r), "russell");
    assert.deepEqual(rolesOf(db, "maya/marketing", r), ["sender"]);
    assert.deepEqual(rolesOf(db, "russell/coding", r), ["worker"]);
    assert.deepEqual(rolesOf(db, "russell/gate", r), ["gate"]);
    assert.deepEqual(rolesOf(db, "russell", r), ["owner"]);
  } finally {
    cleanup();
  }
});

test("authorization: only the right role may act", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seedRequest(db);
    const r = getRequest(db, id)!;
    // gate/owner may decide; sender/worker may not.
    assert.ok(can(db, "russell/gate", "decide", r));
    assert.ok(can(db, "russell", "decide", r));
    assert.ok(!can(db, "maya/marketing", "decide", r));
    assert.ok(!can(db, "russell/coding", "decide", r));
    // worker may start a session; gate may not.
    assert.ok(can(db, "russell/coding", "start_session", r));
    assert.ok(!can(db, "russell/gate", "start_session", r));
    // sender may respond to info; worker may not.
    assert.ok(can(db, "maya/marketing", "respond_info", r));
    assert.ok(!can(db, "russell/coding", "respond_info", r));
  } finally {
    cleanup();
  }
});

test("ask_sender then respond_to_info returns the request to the gate", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seedRequest(db);
    decide(db, id, { decision: "ask_sender", reason: ["What is the scope?"] }, "russell/gate");
    assert.equal(getRequest(db, id)!.status, "needs_info");
    respondToInfo(db, id, ["Header CTA only."], "maya/marketing");
    assert.equal(getRequest(db, id)!.status, "screening");
    // The gate can now allow it.
    decide(db, id, { decision: "allow" }, "russell/gate");
    assert.equal(getRequest(db, id)!.status, "accepted");
  } finally {
    cleanup();
  }
});

test("execution gate: ask_gate blocks; resolve allow resumes work", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seedRequest(db);
    decide(db, id, { decision: "allow_with_limits", limits: ["May open PRs."] }, "russell/gate");
    startSession(db, id);
    askGate(db, id, "About to call an external API — ok?");
    assert.equal(getRequest(db, id)!.status, "blocked");
    resolveCheck(db, id, true, ["Within limits."], "russell/gate");
    assert.equal(getRequest(db, id)!.status, "active");

    // A denied check also returns to active (worker continues without it).
    askGate(db, id, "Spend money?");
    resolveCheck(db, id, false, ["Out of policy."], "russell/gate");
    assert.equal(getRequest(db, id)!.status, "active");

    const events = eventsSince(db, "russell/gate", 0, { request: id }).events.map((e) => e.type);
    assert.ok(events.includes("execution_check_requested"));
    assert.ok(events.includes("execution_check_allowed"));
    assert.ok(events.includes("execution_check_denied"));
  } finally {
    cleanup();
  }
});

test("idempotent create returns the same request for a repeated key", () => {
  const { db, cleanup } = freshDb();
  try {
    const input = {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "Task.",
      definition_of_done: ["Done."],
    };
    const a = createRequestIdempotent(db, "key-1", input);
    const b = createRequestIdempotent(db, "key-1", input);
    assert.equal(a.replayed, false);
    assert.equal(b.replayed, true);
    assert.equal(a.id, b.id);
    // A different key makes a new request.
    const c = createRequestIdempotent(db, "key-2", input);
    assert.notEqual(c.id, a.id);
  } finally {
    cleanup();
  }
});

test("filtered listing finds a worker's startable work", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seedRequest(db);
    decide(db, id, { decision: "allow" }, "russell/gate");
    const startable = listRequestsFiltered(db, {
      caller: "russell/coding",
      role: "worker",
      status: "accepted",
    });
    assert.equal(startable.length, 1);
    assert.equal(startable[0].id, id);
    // maya (sender) sees nothing as a worker.
    assert.equal(
      listRequestsFiltered(db, { caller: "maya/marketing", role: "worker" }).length,
      0,
    );
  } finally {
    cleanup();
  }
});

test("event feed is scoped to the caller and advances by cursor", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seedRequest(db);
    // maya is a party (sender) -> sees events; an unrelated identity does not.
    const mine = eventsSince(db, "maya/marketing", 0);
    assert.ok(mine.events.length >= 2);
    assert.equal(eventsSince(db, "acme/legal", 0).events.length, 0);

    // Cursor: nothing new since the latest seq, then a new event appears.
    const afterCursor = eventsSince(db, "maya/marketing", mine.cursor);
    assert.equal(afterCursor.events.length, 0);
    decide(db, id, { decision: "allow" }, "russell/gate");
    const next = eventsSince(db, "maya/marketing", mine.cursor);
    assert.equal(next.events.length, 1);
    assert.equal(next.events[0].type, "gate_decision");
  } finally {
    cleanup();
  }
});

test("inbox buckets work by the caller's role", () => {
  const { db, cleanup } = freshDb();
  try {
    const id = seedRequest(db);
    decide(db, id, { decision: "allow" }, "russell/gate");
    // worker: ready to start
    assert.ok(inboxFor(db, "russell/coding").ready_to_start.some((r) => r.id === id));
    startSession(db, id);
    // gate after a block: needs_exec_check
    askGate(db, id, "risky");
    assert.ok(inboxFor(db, "russell/gate").needs_exec_check.some((r) => r.id === id));
    assert.ok(inboxFor(db, "russell/coding").active.some((r) => r.id === id));
  } finally {
    cleanup();
  }
});
