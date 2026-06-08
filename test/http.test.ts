// HTTP-level (transport) tests: drive the real /v1 route handlers with Request
// objects, exercising auth, the error->status mapping, idempotency, and the full
// loop end to end. These cover the layer the service/query tests do not.
//
// Point getDb() at a throwaway database before any handler runs.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.SIGNPOST_DB = join(mkdtempSync(join(tmpdir(), "signpost-http-")), "http.db");

import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenFor } from "../lib/db";
import { GET as me } from "../app/v1/me/route";
import { POST as createReq } from "../app/v1/requests/route";
import { GET as getReq } from "../app/v1/requests/[id]/route";
import { POST as decideR } from "../app/v1/requests/[id]/decisions/route";
import { POST as sessionR } from "../app/v1/requests/[id]/session/route";
import { POST as actionsR } from "../app/v1/requests/[id]/session/actions/route";
import { POST as checksR } from "../app/v1/requests/[id]/checks/route";
import { POST as releaseR } from "../app/v1/requests/[id]/release/route";
import { POST as receiptR } from "../app/v1/requests/[id]/receipt/route";
import { GET as eventsR } from "../app/v1/events/route";

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const MAYA = tokenFor("maya/marketing");
const CODING = tokenFor("russell/coding");
const GATE = tokenFor("russell/gate");
const OWNER = tokenFor("russell");

interface CallOpts {
  token?: string;
  body?: unknown;
  query?: string;
  id?: string;
  headers?: Record<string, string>;
}

async function call(handler: Handler, opts: CallOpts = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://test/v1${opts.query ?? ""}`, {
    method: handler === me || handler === getReq || handler === eventsR ? "GET" : "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ctx = { params: Promise.resolve({ id: opts.id ?? "" }) };
  const res = await handler(req, ctx);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test("auth: missing token -> 401, valid token -> identity", async () => {
  assert.equal((await call(me)).status, 401);
  assert.equal((await call(me, { token: "bogus" })).status, 401);
  const ok = await call(me, { token: MAYA });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.identity.id, "maya/marketing");
});

test("#2 regression: missing goal -> 400 (not 500)", async () => {
  const res = await call(createReq, {
    token: MAYA,
    body: { to: "russell/coding", definition_of_done: ["x"] },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /goal is required/);
});

test("#1 regression: idempotency key is scoped per identity", async () => {
  const a = await call(createReq, {
    token: MAYA,
    headers: { "idempotency-key": "shared" },
    body: { to: "russell/coding", goal: "maya task", definition_of_done: ["x"] },
  });
  const b = await call(createReq, {
    token: CODING,
    headers: { "idempotency-key": "shared" },
    body: { to: "russell/coding", goal: "coding task", definition_of_done: ["y"] },
  });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.data.replayed, false, "different identity must not replay another's key");
  assert.notEqual(a.data.id, b.data.id);
  // Same identity + same key DOES replay.
  const aAgain = await call(createReq, {
    token: MAYA,
    headers: { "idempotency-key": "shared" },
    body: { to: "russell/coding", goal: "maya task", definition_of_done: ["x"] },
  });
  assert.equal(aAgain.data.replayed, true);
  assert.equal(aAgain.data.id, a.data.id);
});

test("you may only create a request as yourself (403)", async () => {
  const res = await call(createReq, {
    token: MAYA,
    body: { from: "russell/coding", to: "russell/coding", goal: "spoof", definition_of_done: ["x"] },
  });
  assert.equal(res.status, 403);
});

test("#3 regression: non-party gets 404 (not 403) on actions and reads", async () => {
  // A request maya is not party to: from gate, to coding.
  const created = await call(createReq, {
    token: GATE,
    body: { from: "russell/gate", to: "russell/coding", goal: "private", definition_of_done: ["x"] },
  });
  const id = created.data.id;
  assert.equal((await call(getReq, { token: MAYA, id })).status, 404);
  assert.equal(
    (await call(decideR, { token: MAYA, id, body: { decision: "allow" } })).status,
    404,
  );
});

test("wrong role: a party with the wrong role gets 403", async () => {
  const created = await call(createReq, {
    token: MAYA,
    body: { to: "russell/coding", goal: "t", definition_of_done: ["x"] },
  });
  const id = created.data.id;
  // maya is the sender (a party) but may not decide.
  assert.equal((await call(decideR, { token: MAYA, id, body: { decision: "allow" } })).status, 403);
});

test("policy auto-decides a matching request on arrival (no human)", async () => {
  // maya's tracking request matches the seeded policy -> auto allow_with_limits.
  const created = await call(createReq, {
    token: MAYA,
    body: { to: "russell/coding", goal: "Add launch tracking to the CTA.", definition_of_done: ["x"] },
  });
  const got = await call(getReq, { token: MAYA, id: created.data.id });
  assert.equal(got.data.request.status, "accepted");
  assert.equal(got.data.decisions[0].auto, true);
  assert.equal(got.data.decisions[0].rule, "marketing_analytics_requests");
});

test("manual escalation: a non-matching request escalates, then the gate decides", async () => {
  const created = await call(createReq, {
    token: MAYA,
    body: { to: "russell/coding", goal: "Refactor the onboarding email.", definition_of_done: ["x"] },
  });
  const id = created.data.id;
  // No rule matched -> default ask_owner, recorded as an auto decision.
  let got = await call(getReq, { token: MAYA, id });
  assert.equal(got.data.request.status, "needs_owner");
  assert.equal(got.data.decisions[0].auto, true);
  assert.equal(got.data.decisions[0].decision, "ask_owner");
  // The owner then decides manually.
  const r = await call(decideR, { token: OWNER, id, body: { decision: "allow" } });
  assert.equal(r.data.request.status, "accepted");
  assert.equal(r.data.decisions[1].auto, false);
});

test("full loop over HTTP handlers ends closed with a receipt", async () => {
  // Matching goal -> auto-accepted by policy; no manual decision needed.
  const created = await call(createReq, {
    token: MAYA,
    body: {
      to: "russell/coding",
      goal: "Add launch tracking.",
      definition_of_done: ["Event fires."],
      constraints: ["No billing changes."],
    },
  });
  const id = created.data.id;
  assert.equal(created.status, 201);
  assert.equal((await call(getReq, { token: MAYA, id })).data.request.status, "accepted");

  // worker starts, updates, asks gate (blocks), gate resolves, completes
  let r;
  assert.equal((await call(sessionR, { token: CODING, id })).data.request.status, "active");
  await call(actionsR, { token: CODING, id, body: { action: "post_update", summary: "wired it" } });
  r = await call(actionsR, { token: CODING, id, body: { action: "ask_gate", summary: "external API?" } });
  assert.equal(r.data.request.status, "blocked");
  r = await call(checksR, { token: GATE, id, body: { decision: "allow", reason: ["fine"] } });
  assert.equal(r.data.request.status, "active");
  r = await call(actionsR, { token: CODING, id, body: { action: "complete" } });
  assert.equal(r.data.request.status, "ready_for_release");

  // owner releases, worker closes with receipt
  assert.equal((await call(releaseR, { token: OWNER, id })).data.request.status, "released");
  r = await call(receiptR, {
    token: CODING,
    id,
    body: { status: "completed", evidence: ["tests pass"], artifacts: ["pr/1"] },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.request.status, "closed");
  assert.ok(r.data.receipt_id.startsWith("rec_"));
  assert.equal(r.data.receipt.id, r.data.receipt_id);

  // the sender can poll the full ordered history, including the release decision
  const feed = await call(eventsR, { token: MAYA, id, query: `?request=${id}` });
  const types = feed.data.events.map((e: { type: string }) => e.type);
  assert.deepEqual(types, [
    "request_created",
    "routed_to_gate",
    "gate_decision",
    "session_started",
    "session_update",
    "execution_check_requested",
    "execution_check_allowed",
    "ready_for_release",
    "released",
    "closed",
  ]);
});

test("events long-poll wakes when a new event is appended", async () => {
  const base = await call(eventsR, { token: MAYA });
  const cursor = base.data.cursor;
  // Start a long-poll from the current cursor (nothing new yet).
  const pending = call(eventsR, { token: MAYA, query: `?since=${cursor}&wait=3000` });
  // Append events maya can see; this should wake the waiter.
  await call(createReq, {
    token: MAYA,
    body: { to: "russell/coding", goal: "tracking via long-poll", definition_of_done: ["x"] },
  });
  const res = await pending;
  assert.ok(res.data.events.length > 0, "long-poll should return the new events");
  assert.ok(res.data.cursor > cursor);
});

test("events long-poll returns empty at timeout when nothing happens", async () => {
  const t0 = Date.now();
  const res = await call(eventsR, { token: MAYA, query: `?since=999999&wait=300` });
  assert.equal(res.data.events.length, 0);
  assert.ok(Date.now() - t0 >= 250, "should have waited roughly the timeout");
});
