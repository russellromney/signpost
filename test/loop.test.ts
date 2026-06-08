// End-to-end test of the Signpost loop against a temporary SQLite database:
//   request -> gate -> session -> release -> receipt
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb } from "../lib/db";
import {
  closeWithReceipt,
  createRequest,
  decide,
  markReadyForRelease,
  postUpdate,
  release,
  rejectRelease,
  startSession,
  ServiceError,
} from "../lib/service";
import { getRequestDetail, inbox, listIdentities } from "../lib/queries";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "signpost-test-"));
  const db = createDb(join(dir, "test.db"));
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("seeds the principals, workers, and admin", () => {
  const { db, cleanup } = freshDb();
  try {
    const ids = listIdentities(db).map((i) => i.id).sort();
    assert.deepEqual(ids, [
      "maya",
      "maya/marketing",
      "root",
      "russell",
      "russell/coding",
      "russell/gate",
    ]);
  } finally {
    cleanup();
  }
});

test("full loop: request -> gate -> session -> release -> receipt", () => {
  const { db, cleanup } = freshDb();
  try {
    // 1. maya/marketing creates a request to russell/coding.
    const reqId = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "Add launch tracking to the signup CTA.",
      definition_of_done: ["Event fires when the CTA is clicked.", "Event name is documented."],
      constraints: ["Do not change billing flow."],
      context: ["https://github.com/acme/web/issues/42"],
    });

    // Routed to the gate for screening.
    assert.equal(getRequestDetail(db, reqId)!.request.status, "screening");
    assert.ok(inbox(db).needs_gate.some((r) => r.id === reqId));

    // 2. The gate allows it with limits.
    decide(db, reqId, {
      decision: "allow_with_limits",
      limits: ["May open pull requests.", "May not merge."],
      reason: ["Marketing analytics request within policy."],
    });
    assert.equal(getRequestDetail(db, reqId)!.request.status, "accepted");

    // 3. A session starts for russell/coding.
    const sessId = startSession(db, reqId);
    assert.ok(sessId.startsWith("sess_"));
    assert.equal(getRequestDetail(db, reqId)!.request.status, "active");

    // 4. The session posts an update.
    postUpdate(db, reqId, "Wired the analytics event and added a test.");

    // 5. Worker marks ready for release.
    markReadyForRelease(db, reqId, "Implemented and tested. Ready for review.");
    assert.equal(getRequestDetail(db, reqId)!.request.status, "ready_for_release");

    // 6. Owner releases.
    release(db, reqId);
    assert.equal(getRequestDetail(db, reqId)!.request.status, "released");

    // 7. Close with a receipt.
    const recId = closeWithReceipt(db, reqId, {
      status: "completed",
      artifacts: ["https://github.com/acme/web/pull/418"],
      evidence: ["npm test -- analytics passed"],
      assumptions: ["Signup CTA means header and pricing page only."],
    });
    assert.ok(recId.startsWith("rec_"));

    const detail = getRequestDetail(db, reqId)!;
    assert.equal(detail.request.status, "closed");
    assert.ok(detail.receipt);
    assert.equal(detail.receipt!.id, recId);
    assert.ok(inbox(db).done.some((r) => r.id === reqId));

    // Every state change is in the append-only event log, in order.
    const types = detail.events.map((e) => e.type);
    assert.deepEqual(types, [
      "request_created",
      "routed_to_gate",
      "gate_decision",
      "session_started",
      "session_update",
      "ready_for_release",
      "released",
      "closed",
    ]);
  } finally {
    cleanup();
  }
});

test("deny sends the request to Done and blocks a session", () => {
  const { db, cleanup } = freshDb();
  try {
    const reqId = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "Refactor the billing flow.",
      definition_of_done: ["Billing refactored."],
    });
    decide(db, reqId, { decision: "deny", reason: ["Out of policy."] });
    assert.equal(getRequestDetail(db, reqId)!.request.status, "denied");
    assert.throws(() => startSession(db, reqId), ServiceError);
    assert.ok(inbox(db).done.some((r) => r.id === reqId));
  } finally {
    cleanup();
  }
});

test("a receipt requires at least one piece of evidence", () => {
  const { db, cleanup } = freshDb();
  try {
    const reqId = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "Small task.",
      definition_of_done: ["Done."],
    });
    decide(db, reqId, { decision: "allow" });
    startSession(db, reqId);
    markReadyForRelease(db, reqId);
    release(db, reqId);
    assert.throws(() => closeWithReceipt(db, reqId, { evidence: [] }), ServiceError);
  } finally {
    cleanup();
  }
});

test("reject release sends the request back to active", () => {
  const { db, cleanup } = freshDb();
  try {
    const reqId = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "Task.",
      definition_of_done: ["Done."],
    });
    decide(db, reqId, { decision: "allow" });
    startSession(db, reqId);
    markReadyForRelease(db, reqId);
    rejectRelease(db, reqId, "Needs documentation.");
    assert.equal(getRequestDetail(db, reqId)!.request.status, "active");
  } finally {
    cleanup();
  }
});
