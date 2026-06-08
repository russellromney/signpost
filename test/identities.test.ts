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
import { createRequest, disableIdentity, ServiceError } from "../lib/service";
import { getRequest } from "../lib/queries";
import {
  opAdminEvents,
  opCreateIdentity,
  opDisableIdentity,
  opEnableIdentity,
  opGetIdentity,
  opIdentities,
  opIssueKey,
  opListKeys,
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

test("an admin identity cannot be disabled (service guard)", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.throws(() => disableIdentity(db, "root"), ServiceError);
  } finally {
    cleanup();
  }
});

test("you cannot disable yourself (lockout guard), but can be re-enabled", () => {
  const { db, cleanup } = freshDb();
  try {
    const issued = opCreateIdentity(db, "russell", { id: "russell/temp3", owner: "russell" });
    // self-disable is refused at the ops layer (would be an irreversible lockout)
    assert.throws(() => opDisableIdentity(db, "russell/temp3", "russell/temp3"), AuthzError);

    // the owner can disable, then re-enable, and the key works again
    opDisableIdentity(db, "russell", "russell/temp3");
    assert.throws(() => identityForToken(db, issued.secret), AuthError);
    opEnableIdentity(db, "russell", "russell/temp3");
    assert.equal(identityForToken(db, issued.secret), "russell/temp3");
  } finally {
    cleanup();
  }
});

// --- self-service keys -------------------------------------------------------

test("an identity can rotate its own keys, but not disable itself", () => {
  const { db, cleanup } = freshDb();
  try {
    // russell/coding mints and lists its own key (self-service rotation)
    const k = opIssueKey(db, "russell/coding", "russell/coding", { label: "rotated" });
    assert.equal(identityForToken(db, k.secret), "russell/coding");
    const ids = opListKeys(db, "russell/coding", "russell/coding").map((x) => x.id);
    assert.ok(ids.includes(k.id));
    // and revoke its own key
    opRevokeKey(db, "russell/coding", k.id);
    assert.throws(() => identityForToken(db, k.secret), AuthError);
  } finally {
    cleanup();
  }
});

// --- key hygiene -------------------------------------------------------------

test("the key prefix never exposes secret bytes, and bad expiry is rejected", () => {
  const { db, cleanup } = freshDb();
  try {
    const k = opIssueKey(db, "russell", "russell", {});
    // the hint shows only the last 4 chars; it is not a leading substring
    assert.equal(k.prefix, `sk_…${k.secret.slice(-4)}`);
    assert.ok(!k.secret.startsWith(k.prefix));

    // malformed expiry is a 400, not a silently-immortal key
    assert.throws(() => opIssueKey(db, "russell", "russell", { expires_at: "banana" }), ServiceError);
    assert.throws(
      () => opIssueKey(db, "russell", "russell", { expires_at: "2000-01-01T00:00:00Z" }),
      ServiceError,
    );
    // a valid future expiry is accepted and normalized to ISO
    const fut = new Date(Date.now() + 86_400_000).toISOString();
    const k2 = opIssueKey(db, "russell", "russell", { expires_at: fut });
    assert.equal(k2.expires_at, fut);
    assert.equal(identityForToken(db, k2.secret), "russell");
  } finally {
    cleanup();
  }
});

// --- directory + audit -------------------------------------------------------

test("disabled identities are hidden from the directory by default", () => {
  const { db, cleanup } = freshDb();
  try {
    opCreateIdentity(db, "russell", { id: "russell/hidden", owner: "russell" });
    opDisableIdentity(db, "russell", "russell/hidden");
    assert.ok(!opIdentities(db).some((i) => i.id === "russell/hidden"));
    assert.ok(opIdentities(db, true).some((i) => i.id === "russell/hidden"));
  } finally {
    cleanup();
  }
});

test("management actions are audited and readable by owner/admin", () => {
  const { db, cleanup } = freshDb();
  try {
    opCreateIdentity(db, "russell", { id: "russell/audited", owner: "russell" });
    const events = opAdminEvents(db, "russell", { identity: "russell/audited" });
    const types = events.map((e) => e.type);
    assert.ok(types.includes("identity_created"));
    assert.ok(types.includes("key_issued"));
    // a non-manager cannot read another identity's audit
    assert.throws(() => opAdminEvents(db, "maya", { identity: "russell/audited" }), AuthzError);
    // global audit is admin-only
    assert.throws(() => opAdminEvents(db, "russell", {}), AuthzError);
    assert.ok(opAdminEvents(db, "root", {}).length > 0);
  } finally {
    cleanup();
  }
});

test("legacy plaintext tokens are migrated into hashed api_keys on open", () => {
  const dir = mkdtempSync(join(tmpdir(), "signpost-ids-"));
  try {
    const path = join(dir, "t.db");
    let db = createDb(path);
    // simulate a pre-existing database that still has a custom plaintext token
    db.prepare(`INSERT INTO tokens (token, identity, created_at) VALUES (?, ?, ?)`).run(
      "sk_custom_legacy",
      "russell/coding",
      new Date().toISOString(),
    );
    db.close();

    // reopening runs migrate(), which carries the token across (hashed)
    db = createDb(path);
    assert.equal(identityForToken(db, "sk_custom_legacy"), "russell/coding");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("disabling an owner leaves its children active (no cascade)", () => {
  const { db, cleanup } = freshDb();
  try {
    // russell/coding keeps working even after its human owner is disabled.
    opDisableIdentity(db, "root", "russell");
    assert.equal(identityForToken(db, tokenFor("russell/coding")), "russell/coding");
    assert.throws(() => identityForToken(db, tokenFor("russell")), AuthError);
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
