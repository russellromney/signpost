// SQLite access for the Signpost prototype.
//
// We use better-sqlite3 (synchronous, embedded). The database file lives under
// /data by default, or wherever SIGNPOST_DB points (tests use a temp file).
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { newKeyId, now } from "./ids";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS identities (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  owner         TEXT NOT NULL,
  display_name  TEXT,
  description   TEXT,
  gate          TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id                  TEXT PRIMARY KEY,
  from_id             TEXT NOT NULL,
  to_id               TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'request',
  goal                TEXT NOT NULL,
  context             TEXT NOT NULL DEFAULT '[]',
  definition_of_done  TEXT NOT NULL DEFAULT '[]',
  constraints         TEXT NOT NULL DEFAULT '[]',
  deadline            TEXT,
  status              TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_decisions (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id),
  gate        TEXT NOT NULL,
  decision    TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'request',
  action_id   TEXT,
  auto        INTEGER NOT NULL DEFAULT 0,
  rule        TEXT,
  limits      TEXT NOT NULL DEFAULT '[]',
  reason      TEXT NOT NULL DEFAULT '[]',
  route_to    TEXT,
  created_at  TEXT NOT NULL
);

-- One gate policy per identity. The gate evaluates it at request time to
-- auto-decide known cases and escalate only the exceptions to a human.
CREATE TABLE IF NOT EXISTS gate_policies (
  identity         TEXT PRIMARY KEY REFERENCES identities(id),
  default_decision TEXT NOT NULL DEFAULT 'ask_owner',
  rules            TEXT NOT NULL DEFAULT '[]',
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  identity    TEXT NOT NULL,
  request_id  TEXT NOT NULL REFERENCES requests(id),
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_actions (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  identity      TEXT NOT NULL,
  action        TEXT NOT NULL,
  summary       TEXT,
  requires_gate INTEGER NOT NULL DEFAULT 0,
  gate_status   TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id),
  session_id  TEXT NOT NULL,
  status      TEXT NOT NULL,
  artifacts   TEXT NOT NULL DEFAULT '[]',
  evidence    TEXT NOT NULL DEFAULT '[]',
  assumptions TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);

-- Append-only audit log. Rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id),
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

-- One bearer token per identity. Authenticates API callers as an identity.
-- (Legacy: superseded by api_keys, kept so old databases keep their rows.)
CREATE TABLE IF NOT EXISTS tokens (
  token       TEXT PRIMARY KEY,
  identity    TEXT NOT NULL REFERENCES identities(id),
  created_at  TEXT NOT NULL
);

-- API keys: many per identity, each a random secret stored only as a hash. The
-- plaintext is shown once at issue. revoked_at / expires_at gate authentication.
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  identity    TEXT NOT NULL REFERENCES identities(id),
  hash        TEXT NOT NULL,
  label       TEXT,
  prefix      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  revoked_at  TEXT
);

-- Append-only audit log for identity/owner/key management. The request feed
-- lives in the events table; management actions have no request id of their own.
CREATE TABLE IF NOT EXISTS admin_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  target      TEXT,
  summary     TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

-- Idempotency keys so agents can safely retry create calls. Scoped per
-- identity: the same key from two identities must not collide.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  identity    TEXT NOT NULL,
  key         TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (identity, key)
);

CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_identity ON api_keys(identity);
`;

// Deterministic, readable tokens so the prototype is easy to drive with curl.
// A real deployment would issue random secrets; these are fine for local-only.
export function tokenFor(identity: string): string {
  return `sk_${identity.replace(/\//g, "_")}`;
}

// Keys are stored only as a hash; authentication hashes the presented secret and
// looks it up. Secrets are high-entropy, so an unsalted SHA-256 is sufficient
// (same approach as GitHub-style personal access tokens).
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// The identities the prototype ships with. `root` is the instance admin (it can
// mint top-level principals and manage any identity); `russell` and `maya` are
// self-owned principals, each owning their own workers.
const SEED_IDENTITIES: Array<{
  id: string;
  kind: string;
  owner: string;
  display_name: string;
  description: string;
  gate: string | null;
  is_admin?: boolean;
}> = [
  {
    id: "root",
    kind: "human",
    owner: "root",
    display_name: "Root",
    description: "Instance admin. Bootstraps top-level principals.",
    gate: null,
    is_admin: true,
  },
  {
    id: "russell",
    kind: "human",
    owner: "russell",
    display_name: "Russell",
    description: "Human owner. Sets policy and handles exceptions.",
    gate: null,
  },
  {
    id: "maya",
    kind: "human",
    owner: "maya",
    display_name: "Maya",
    description: "Human owner of the marketing worker.",
    gate: null,
  },
  {
    id: "russell/gate",
    kind: "gate",
    owner: "russell",
    display_name: "Russell / Gate",
    description: "Russell's boundary manager. Screens requests and releases.",
    gate: null,
  },
  {
    id: "russell/coding",
    kind: "worker",
    owner: "russell",
    display_name: "Russell / Coding",
    description: "Delegated coding worker. Requests route through russell/gate.",
    gate: "russell/gate",
  },
  {
    id: "maya/marketing",
    kind: "worker",
    owner: "maya",
    display_name: "Maya / Marketing",
    description: "Delegated marketing worker. Sends requests to other identities.",
    gate: null,
  },
];

export function applySchema(db: DB): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
}

// Add columns to databases created before the v1 API. Safe to run repeatedly.
function migrate(db: DB): void {
  const hasColumn = (table: string, column: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
      (c) => c.name === column,
    );
  const add = (table: string, column: string, def: string) => {
    if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  };
  add("gate_decisions", "scope", "TEXT NOT NULL DEFAULT 'request'");
  add("gate_decisions", "action_id", "TEXT");
  add("gate_decisions", "auto", "INTEGER NOT NULL DEFAULT 0");
  add("gate_decisions", "rule", "TEXT");
  add("session_actions", "gate_status", "TEXT");
  add("identities", "status", "TEXT NOT NULL DEFAULT 'active'");
  add("identities", "is_admin", "INTEGER NOT NULL DEFAULT 0");

  // Earlier builds gave idempotency_keys a single-column PK (key), which let the
  // same key from different identities collide. Recreate it with the composite
  // PK if we find the old shape. It is a disposable cache, so dropping is safe.
  const idemPk = (db.prepare(`PRAGMA table_info(idempotency_keys)`).all() as Array<{
    name: string;
    pk: number;
  }>)
    .filter((c) => c.pk > 0)
    .map((c) => c.name);
  if (idemPk.length > 0 && !(idemPk.includes("identity") && idemPk.includes("key"))) {
    db.exec(`DROP TABLE idempotency_keys`);
    db.exec(
      `CREATE TABLE idempotency_keys (
         identity TEXT NOT NULL, key TEXT NOT NULL, request_id TEXT NOT NULL,
         created_at TEXT NOT NULL, PRIMARY KEY (identity, key))`,
    );
  }
}

export function seedIdentities(db: DB): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO identities (id, kind, owner, display_name, description, gate, is_admin, created_at)
     VALUES (@id, @kind, @owner, @display_name, @description, @gate, @is_admin, @created_at)`,
  );
  const hasKey = db.prepare(`SELECT 1 FROM api_keys WHERE identity = ? LIMIT 1`);
  const insertKey = db.prepare(
    `INSERT INTO api_keys (id, identity, hash, label, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const ts = now();
  const tx = db.transaction(() => {
    for (const ident of SEED_IDENTITIES) {
      insert.run({ ...ident, is_admin: ident.is_admin ? 1 : 0, created_at: ts });
      // Seed one deterministic key per identity (sk_<id>) so the demo is
      // curl-able; stored hashed like any other key. Only if none exists yet.
      if (!hasKey.get(ident.id)) {
        const secret = tokenFor(ident.id);
        insertKey.run(newKeyId(), ident.id, hashSecret(secret), "seed", secret.slice(0, 12), ts);
      }
    }
  });
  tx();
}

// The default gate policy, mirroring examples/gate-policy.yml. Marketing
// analytics/tracking requests from maya auto-allow within limits; everything
// else escalates to the owner. This is what makes the gate run itself.
const SEED_POLICY = {
  identity: "russell/coding",
  default_decision: "ask_owner",
  rules: [
    {
      name: "marketing_analytics_requests",
      from: "maya/marketing",
      allow_goals_matching: ["analytics", "tracking"],
      decision: "allow_with_limits",
      limits: [
        "May open pull requests.",
        "May not merge.",
        "May not edit billing, auth, or data export code.",
        "Must ask owner before delegating to another identity.",
      ],
    },
  ],
};

export function seedPolicies(db: DB): void {
  db.prepare(
    `INSERT OR IGNORE INTO gate_policies (identity, default_decision, rules, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(SEED_POLICY.identity, SEED_POLICY.default_decision, JSON.stringify(SEED_POLICY.rules), now());
}

// Open a fresh database at `path`, apply schema and seed. Used directly by tests.
export function createDb(path: string): DB {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new Database(path);
  applySchema(db);
  seedIdentities(db);
  seedPolicies(db);
  return db;
}

// Singleton for the Next.js app. Survives hot-reload via globalThis.
const globalForDb = globalThis as unknown as { __signpostDb?: DB };

export function getDb(): DB {
  if (!globalForDb.__signpostDb) {
    const path = process.env.SIGNPOST_DB ?? resolve(process.cwd(), "data", "signpost.db");
    globalForDb.__signpostDb = createDb(path);
  }
  return globalForDb.__signpostDb;
}
