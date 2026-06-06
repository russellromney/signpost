// SQLite access for the Signpost prototype.
//
// We use better-sqlite3 (synchronous, embedded). The database file lives under
// /data by default, or wherever SIGNPOST_DB points (tests use a temp file).
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { now } from "./ids";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS identities (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  owner         TEXT NOT NULL,
  display_name  TEXT,
  description   TEXT,
  gate          TEXT,
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
  limits      TEXT NOT NULL DEFAULT '[]',
  reason      TEXT NOT NULL DEFAULT '[]',
  route_to    TEXT,
  created_at  TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS tokens (
  token       TEXT PRIMARY KEY,
  identity    TEXT NOT NULL REFERENCES identities(id),
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
`;

// Deterministic, readable tokens so the prototype is easy to drive with curl.
// A real deployment would issue random secrets; these are fine for local-only.
export function tokenFor(identity: string): string {
  return `sk_${identity.replace(/\//g, "_")}`;
}

// The four identities the prototype ships with.
const SEED_IDENTITIES: Array<{
  id: string;
  kind: string;
  owner: string;
  display_name: string;
  description: string;
  gate: string | null;
}> = [
  {
    id: "russell",
    kind: "human",
    owner: "russell",
    display_name: "Russell",
    description: "Human owner. Sets policy and handles exceptions.",
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
  add("session_actions", "gate_status", "TEXT");

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
    `INSERT OR IGNORE INTO identities (id, kind, owner, display_name, description, gate, created_at)
     VALUES (@id, @kind, @owner, @display_name, @description, @gate, @created_at)`,
  );
  const insertToken = db.prepare(
    `INSERT OR IGNORE INTO tokens (token, identity, created_at) VALUES (?, ?, ?)`,
  );
  const ts = now();
  const tx = db.transaction(() => {
    for (const ident of SEED_IDENTITIES) {
      insert.run({ ...ident, created_at: ts });
      insertToken.run(tokenFor(ident.id), ident.id, ts);
    }
  });
  tx();
}

// Open a fresh database at `path`, apply schema and seed. Used directly by tests.
export function createDb(path: string): DB {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new Database(path);
  applySchema(db);
  seedIdentities(db);
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
