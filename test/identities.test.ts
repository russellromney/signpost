// Tests for first-class identity / owner / key management: owner-tree authz,
// random hashed revocable keys, soft-disable, and authz-cache invalidation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, tokenFor } from "../lib/db";
import { identityForToken, AuthError } from "../lib/auth";
import { AuthzError, ownerOf } from "../lib/authz";
import { createRequest, ServiceError } from "../lib/service";
import { getRequest } from "../lib/queries";
import {
  opCreateIdentity,
  opDisableIdentity,
  opGetIdentity,
  opIssueKey,
  opRevokeKey,
  opUpdateIdentity,
} from "../lib/ops";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "signpost-ids-"));
  const db = createDb(join(dir, "test.db"));
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// --- creation + owner-tree authz --------------------------------------------

test("an owner creates a child identity and its key authenticates", () => {
  const { db, cleanup } = freshDb();
  try {
    const issued = opCreateIdentity(db, "russell", {
      id: "russell/research",
      kind: "worker",
      owner: "russell",
    });
    assert.ok(issued.secret.startsWith("sk_"));
    assert.equal(identityForToken(db, issued.secret), "russell/research");
    const ident = opGetIdentity(db, "russell", "russell/research");
    assert.equal(ident.owner, "russell");
    assert.equal(ident.status, "active");
  } finally {
    cleanup();
  }
});

test("you cannot create an identity under an owner you do not control", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.throws(
      () => opCreateIdentity(db, "maya", { id: "russell/sneaky", owner: "russell" }),
      AuthzError,
    );
  } finally {
    cleanup();
  }
});

test("only an admin may create a top-level principal", () => {
  const { db, cleanup } = freshDb();
  try {
    // russell is a principal but not admin: minting a new self-owned root fails.
    assert.throws(() => opCreateIdentity(db, "russell", { id: "acme", owner: "acme" }), AuthzError);
    // root is admin.
    const acme = opCreateIdentity(db, "root", { id: "acme", kind: "org", owner: "acme" });
    assert.equal(identityForToken(db, acme.secret), "acme");
    // ...and the new principal can build its own subtree.
    const legal = opCreateIdentity(db, "acme", { id: "acme/legal", owner: "acme" });
    assert.equal(identityForToken(db, legal.secret), "acme/legal");
    // but an unrelated principal can't touch it.
    assert.throws(() => opDisableIdentity(db, "russell", "acme/legal"), AuthzError);
  } finally {
    cleanup();
  }
});

test("creation validates the id, owner, and gate", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.throws(() => opCreateIdentity(db, "russell", { id: "Bad Name", owner: "russell" }), ServiceError);
    assert.throws(
      () => opCreateIdentity(db, "root", { id: "x/y", owner: "ghost" }),
      ServiceError, // unknown owner
    );
    assert.throws(
      () => opCreateIdentity(db, "russell", { id: "russell/x", owner: "russell", gate: "ghost/gate" }),
      ServiceError, // unknown gate
    );
  } finally {
    cleanup();
  }
});

// --- keys --------------------------------------------------------------------

test("keys can be issued and revoked; revocation is immediate", () => {
  const { db, cleanup } = freshDb();
  try {
    const k = opIssueKey(db, "russell", "russell/coding", { label: "ci" });
    assert.equal(identityForToken(db, k.secret), "russell/coding");

    opRevokeKey(db, "russell", k.id);
    assert.throws(() => identityForToken(db, k.secret), AuthError);
    // the original seed key still works — revocation is per key.
    assert.equal(identityForToken(db, tokenFor("russell/coding")), "russell/coding");
  } finally {
    cleanup();
  }
});

test("only the owner (or admin) may issue or revoke an identity's keys", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.throws(() => opIssueKey(db, "maya", "russell/coding", {}), AuthzError);
    const k = opIssueKey(db, "russell", "russell/coding", {});
    assert.throws(() => opRevokeKey(db, "maya", k.id), AuthzError);
  } finally {
    cleanup();
  }
});

// --- soft disable ------------------------------------------------------------

test("a disabled identity cannot authenticate or be addressed", () => {
  const { db, cleanup } = freshDb();
  try {
    const issued = opCreateIdentity(db, "russell", { id: "russell/temp", owner: "russell" });
    opDisableIdentity(db, "russell", "russell/temp");

    assert.throws(() => identityForToken(db, issued.secret), AuthError);
    assert.throws(
      () =>
        createRequest(db, {
          from_id: "maya/marketing",
          to_id: "russell/temp",
          goal: "x",
          definition_of_done: ["d"],
        }),
      ServiceError,
    );
  } finally {
    cleanup();
  }
});

test("an admin identity cannot be disabled", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.throws(() => opDisableIdentity(db, "root", "root"), ServiceError);
  } finally {
    cleanup();
  }
});

// --- cache invalidation ------------------------------------------------------

test("a newly created identity is visible to role derivation immediately", () => {
  const { db, cleanup } = freshDb();
  try {
    // Warm the authz identity cache with an existing request.
    const r0 = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "russell/coding",
      goal: "g",
      definition_of_done: ["d"],
    });
    assert.equal(ownerOf(db, getRequest(db, r0)!), "russell");

    // Create a cross-namespace identity owned by russell *after* the cache warmed.
    opCreateIdentity(db, "russell", { id: "acme/legal", owner: "russell" });
    opUpdateIdentity(db, "russell", "acme/legal", { description: "Outside counsel." });

    const r1 = createRequest(db, {
      from_id: "maya/marketing",
      to_id: "acme/legal",
      goal: "g",
      definition_of_done: ["d"],
    });
    // If the cache hadn't been invalidated, ownerOf would fall back to "acme".
    assert.equal(ownerOf(db, getRequest(db, r1)!), "russell");
  } finally {
    cleanup();
  }
});
