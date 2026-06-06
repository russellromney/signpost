# Signpost

Signpost lets any identity request work from any other identity.

The owner controls what starts, what runs, and what gets released.

It is not chat for agents. It is structured mail for delegated work.

## Why

Agents can already use issue trackers, docs, chat, email, and pull requests. That is useful, but those tools were built for humans talking to humans.

When agents work for people, teams, companies, or households, the missing part is not another chat window. The missing part is a small work protocol:

- who is asking
- who owns the worker
- what the worker is allowed to do
- when a human must approve
- what evidence proves the work is done
- what crossed an owner boundary

Signpost is the simplest useful version of that protocol.

## Product Claim

Anyone can address any identity.

The owner's gate decides what gets through.

Every request has:

- a sender
- a recipient
- a goal
- a gate decision
- a worker session
- a release check
- a receipt

## Core Model

### Identity

An addressable actor.

Examples:

```text
russell
russell/coding
maya
maya/marketing
acme/legal
emmett/research
```

An identity can represent a human, worker, team, org, service, or gate.

### Owner

The accountable controller of an identity.

```yaml
identity: russell/coding
owner: russell
```

Owners set policy, approve exceptions, and revoke access.

### Worker Identity

A delegated agent identity under an owner.

```yaml
worker: russell/coding
owner: russell
domain: coding
```

The worker identity is stable. It may have many live sessions at once.

### Session

One live execution acting as a worker.

```yaml
session: sess_123
identity: russell/coding
request: req_456
status: active
```

Every action is attributed to both the stable identity and the session.

### Request

The work packet.

```yaml
from: maya/marketing
to: russell/coding
kind: request
goal: Add launch tracking to the signup CTA.
context:
  - https://github.com/acme/web/issues/42
definition_of_done:
  - Event fires when the CTA is clicked.
  - Event name is documented.
constraints:
  - Do not change billing flow.
deadline: 2026-06-09T17:00:00Z
```

The sender addresses the target identity. Signpost routes the request through the owner's gate.

```text
maya/marketing -> russell/gate -> russell/coding
```

### Gate

The owner's boundary manager. This is the main product.

The gate checks three moments:

```text
request: may this work begin?
execution: may this action happen?
release: may this output leave?
```

Gate decisions are small and typed:

```text
allow
allow_with_limits
deny
ask_sender
ask_owner
route
counter
```

### Receipt

Proof that work finished inside the requested boundary.

```yaml
status: completed
artifacts:
  - https://github.com/acme/web/pull/418
evidence:
  - npm test -- analytics passed
assumptions:
  - Signup CTA means header and pricing page only.
```

No receipt, no done.

## The Loop

Signpost has one basic loop:

```text
request -> gate -> session -> release -> receipt
```

Or in plain English:

1. One identity sends a request to another identity.
2. The recipient owner's gate screens it.
3. If allowed, a worker session runs.
4. The gate checks risky actions during execution.
5. The gate checks the result before release.
6. The request closes with a receipt.

## Lifecycle

The internal states can stay small:

```text
requested
screening
accepted | denied | needs_info | needs_owner
active
blocked | needs_owner
ready_for_release
released | rejected_at_release
closed
```

Humans should handle exceptions, not route every message.

## Inbox Model

Every identity has a work inbox.

Useful views:

```text
Needs Gate Decision
Ready To Start
Active
Blocked
Needs Human
Ready To Release
Done
```

For an owner, the important inbox is smaller:

```text
Approvals
Escalations
Exceptions
Audit
```

The UI should not default to a comment box.

It should default to actions:

```text
Allow once
Allow with limits
Deny
Ask sender
Ask owner
Counter
Release
Reject release
```

## Smallest Prototype

The first useful thing is a web app and API with no heavy integrations.

It should do only this:

1. Create identities.
2. Set a simple gate policy for each identity.
3. Send a structured request to any identity.
4. Run the request through the owner's gate.
5. Create a session when the gate allows work.
6. Let sessions post typed actions and state updates.
7. Run risky actions through the execution gate.
8. Run completion through the release gate.
9. Store the receipt and audit log.

That is enough to test the idea.

## Tiny API

```http
POST /identities
POST /requests
POST /requests/:id/decisions
POST /sessions
POST /sessions/:id/actions
POST /requests/:id/release
```

## Running the Local Prototype

The repository now includes the first working prototype: a local-only Next.js app
backed by SQLite that exercises the whole loop:

```text
request -> gate -> session -> release -> receipt
```

It is local-only by design. There is no chat, no auth, and no GitHub, Slack,
email, or agent integration. One request type only.

### Stack

- Next.js (App Router) + TypeScript
- SQLite via better-sqlite3
- Server Actions for the buttons, plus a small JSON API

### Setup

```bash
npm install
npm run seed   # creates ./data/signpost.db and seeds the four identities
```

Seeded identities: `russell`, `russell/gate`, `russell/coding`, `maya/marketing`.

### Dev

```bash
npm run dev    # http://localhost:3000
```

### Build and run

```bash
npm run build
npm start
```

### Test and lint

```bash
npm test       # end-to-end test of the loop against a temp SQLite db
npm run lint
```

The database file lives at `./data/signpost.db` by default. Override the location
with the `SIGNPOST_DB` environment variable (tests use a throwaway temp file).

### Walkthrough

1. Open the inbox. The five views are **Needs Gate Decision**, **Active**,
   **Needs Human**, **Ready For Release**, and **Done**.
2. Expand **Create request** and send one from `maya/marketing` to
   `russell/coding`. It routes through `russell/gate` and lands in
   **Needs Gate Decision**.
3. Open the request. Use **Allow with limits** at the gate.
4. **Create / start session** for `russell/coding`.
5. **Post session update**, then **Mark ready for release**.
6. **Release**, then **Close with receipt** (evidence is required).
7. The request detail page shows the full, append-only event history.

### JSON API

The same service layer is exposed as a tiny API:

```http
GET  /api/identities
GET  /api/requests
POST /api/requests                      { from, to, goal, definition_of_done, ... }
GET  /api/requests/:id
POST /api/requests/:id/decisions        { decision, limits, reason }
POST /api/requests/:id/sessions         {}  |  { action: "post_update", summary }
POST /api/requests/:id/release          {} | { op: "ready" | "reject" | "close", ... }
```

## Repository Layout

```text
README.md
ROADMAP.md
CHANGELOG.md
schemas/                 first machine-readable object contracts
examples/                sample request and gate policy
app/                     Next.js pages, server actions, and JSON API
  page.tsx               inbox (five views + create request)
  requests/[id]/         request detail with actions and event history
  api/                   JSON API route handlers
lib/                     db, types, service (write side), queries (read side)
test/                    end-to-end loop test
scripts/seed.ts          create + seed the local database
```

## Status

The starting spec plus a working local prototype. The next steps are tracked in
`ROADMAP.md` — hardening the gate (policies, the execution-time gate) and adding
inline error feedback in the UI.
