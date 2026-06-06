// Tests for the MCP tool layer. The tools are thin wrappers over lib/ops, so we
// drive them directly with a ctx (db + caller) — no transport needed — and check
// that they enforce the same authorization and run the loop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb } from "../lib/db";
import { TOOLS, type ToolCtx } from "../mcp/tools";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "signpost-mcp-"));
  return { db: createDb(join(dir, "t.db")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function tool(name: string) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

function run(ctx: ToolCtx, name: string, args: Record<string, unknown> = {}) {
  return tool(name).run(ctx, args);
}

test("every tool has a description and an input schema", () => {
  for (const t of TOOLS) {
    assert.ok(t.description.length > 0, `${t.name} needs a description`);
    assert.equal(typeof t.inputSchema, "object");
  }
  // sanity: the core loop tools exist
  for (const n of ["whoami", "create_request", "decide", "start_session", "close", "events"]) {
    assert.ok(TOOLS.some((t) => t.name === n), `missing tool ${n}`);
  }
});

test("whoami reflects the authenticated caller", () => {
  const { db, cleanup } = freshDb();
  try {
    const me = run({ db, caller: "russell/coding" }, "whoami") as { id: string };
    assert.equal(me.id, "russell/coding");
  } finally {
    cleanup();
  }
});

test("full loop over MCP tools, with policy auto-decision", () => {
  const { db, cleanup } = freshDb();
  try {
    const maya: ToolCtx = { db, caller: "maya/marketing" };
    const coding: ToolCtx = { db, caller: "russell/coding" };
    const owner: ToolCtx = { db, caller: "russell" };

    // maya creates a tracking request -> policy auto-allows -> accepted
    const created = run(maya, "create_request", {
      to: "russell/coding",
      goal: "Add launch tracking",
      definition_of_done: ["x"],
    }) as { id: string };
    const got = run(maya, "get_request", { id: created.id }) as {
      request: { status: string };
      decisions: Array<{ auto: boolean }>;
    };
    assert.equal(got.request.status, "accepted");
    assert.equal(got.decisions[0].auto, true);

    // worker runs the session and closes
    run(coding, "start_session", { id: created.id });
    run(coding, "post_update", { id: created.id, summary: "did it" });
    run(coding, "complete", { id: created.id });
    run(owner, "release", { id: created.id });
    const closed = run(coding, "close", { id: created.id, evidence: ["tests pass"] }) as {
      request: { status: string };
      receipt_id: string;
    };
    assert.equal(closed.request.status, "closed");
    assert.ok(closed.receipt_id.startsWith("rec_"));
  } finally {
    cleanup();
  }
});

test("MCP tools enforce authorization (wrong role throws)", () => {
  const { db, cleanup } = freshDb();
  try {
    const maya: ToolCtx = { db, caller: "maya/marketing" };
    const created = run(maya, "create_request", {
      to: "russell/coding",
      goal: "rewrite homepage", // non-matching -> escalates to needs_owner
      definition_of_done: ["x"],
    }) as { id: string };
    // maya is the sender, not the gate -> may not decide.
    assert.throws(() => run(maya, "decide", { id: created.id, decision: "allow" }));
  } finally {
    cleanup();
  }
});
