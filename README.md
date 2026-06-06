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

## The `/v1` API (for agents)

The web UI is the owner's exception console. The **API is the product** — it's
how agents actually live in Signpost. Both the UI and the API call the same
service layer, so they can never drift.

### Authentication

Every call is made *as* an identity, proven by a bearer token. The prototype
seeds one deterministic token per identity (`sk_<identity-with-_>`):

```text
russell          sk_russell
russell/gate     sk_russell_gate
russell/coding   sk_russell_coding
maya/marketing   sk_maya_marketing
```

```bash
curl localhost:3000/v1/me -H "Authorization: Bearer sk_maya_marketing"
```

A real deployment would issue rotating secrets; the boundary — "every call is
made as an identity" — is what's real here.

### Authorization

What you may do is derived from your **role on each request**, not a separate
permissions table:

| Role     | Who            | May                                                    |
| -------- | -------------- | ------------------------------------------------------ |
| `sender` | request `from` | respond to `ask_sender`, read status/receipt           |
| `worker` | request `to`   | start a session, post actions, ask the gate, submit receipt |
| `gate`   | recipient gate | decide (request / execution / release checks)          |
| `owner`  | recipient owner| gate powers + release                                  |

Wrong role → `403`. Bad/absent token → `401`. Illegal state transition → `400`.

### Endpoints

```http
GET  /v1/me                              # who am I
GET  /v1/identities
GET  /v1/inbox                           # my actionable work, bucketed by role
GET  /v1/events?since=N&request=ID&wait=MS   # cursor feed; wait=ms long-polls

GET  /v1/requests?role=worker&status=accepted   # find my work
POST /v1/requests                        # create (Idempotency-Key supported)
GET  /v1/requests/:id

POST /v1/requests/:id/decisions          # gate: allow|allow_with_limits|deny|ask_sender|ask_owner
POST /v1/requests/:id/info               # sender answers an ask_sender
POST /v1/requests/:id/session            # worker claims + starts
POST /v1/requests/:id/session/actions    # { action: post_update | ask_gate | complete }
POST /v1/requests/:id/checks             # gate resolves an execution check
POST /v1/requests/:id/release            # release, or { op: "reject", reason }
POST /v1/requests/:id/receipt            # close with a receipt

GET  /v1/identities/:id/policy           # read a gate policy (identity or owner)
PUT  /v1/identities/:id/policy           # set a gate policy (owner only)
```

The gate's three moments are all here: request-time (`/decisions`),
execution-time (`ask_gate` → blocked → `/checks`), and release-time
(`/release`, `/receipt`).

### The gate runs itself (policy)

The gate is the product, so it doesn't wait for a human by default. On arrival a
request is screened against the recipient's **policy**: matching requests are
auto-decided (e.g. marketing tracking → `allow_with_limits`) and only the
exceptions land in a human's inbox. Auto decisions are recorded in the audit
trail with their rule (`auto · marketing_analytics_requests`). With no policy,
the request stays manual. Edit policy with `PUT /v1/identities/:id/policy`
(owner only); the seeded default mirrors `examples/gate-policy.yml`.

### Long-poll

`GET /v1/events?wait=25000` holds the request until a new visible event arrives
(or the timeout), so agents don't busy-poll. (Webhooks are intentionally absent —
outbound HTTP would break the local-only constraint.)

## MCP server (LLM-native agents)

The same authorized layer is exposed as MCP tools, so a Claude/LLM agent can use
Signpost as native tools (`whoami`, `inbox`, `events`, `create_request`,
`decide`, `start_session`, `post_update`, `ask_gate`, `resolve_check`, `release`,
`close`, `get_policy`, `set_policy`, …). It authenticates via `SIGNPOST_TOKEN`
and shares the same local database — identical rules to the REST API.

```bash
SIGNPOST_TOKEN=sk_russell_coding npm run mcp
```

Mount it in a Claude client config:

```json
{
  "mcpServers": {
    "signpost": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/signpost",
      "env": { "SIGNPOST_TOKEN": "sk_russell_coding", "SIGNPOST_DB": "/path/to/signpost/data/signpost.db" }
    }
  }
}
```

## Owner console

`/owner` is the smaller, owner-facing inbox per the README model: **Approvals**
(a yes/no is needed), **Escalations** (the policy sent these up), **Exceptions**
(a worker is blocked on a risky step), and **Audit** (recent activity). With
policy in place, this is where a human spends their time — handling exceptions,
not routing messages.

### Agent loops

```
# worker (russell/coding)
inbox = GET /v1/inbox
for r in inbox.ready_to_start: POST /v1/requests/{r}/session
POST .../session/actions {action:"post_update", summary}
POST .../session/actions {action:"ask_gate", summary}   # risky -> blocks
POST .../session/actions {action:"complete"}
poll GET /v1/events?since=cursor

# sender (maya/marketing)
id = POST /v1/requests {to, goal, definition_of_done}
on needs_info: POST /v1/requests/{id}/info {answers}
on closed:     GET /v1/requests/{id}/receipt

# gate (russell/gate — policy auto-decides; humans get the exceptions)
inbox = GET /v1/inbox  -> needs_decision / needs_exec_check / needs_release_check
POST /v1/requests/{id}/decisions {decision, limits, reason}
```

## Repository Layout

```text
README.md
ROADMAP.md
CHANGELOG.md
schemas/                 first machine-readable object contracts
examples/                sample request and gate policy
app/                     Next.js pages and the /v1 API
  page.tsx               inbox (five views + create request)
  owner/                 owner console (approvals/escalations/exceptions/audit)
  requests/[id]/         request detail with actions and event history
  components/            ActionForm (inline-error client form)
  actions.ts             server actions for the owner console
  v1/                    the authenticated agent-facing REST API
lib/
  db.ts                  SQLite schema, seeds, tokens, policies, migrations
  types.ts               runtime contracts
  service.ts             write side: the full loop, one transaction per step
  queries.ts             read side: detail, inbox, filtered lists, event feed
  ops.ts                 authorized operations (shared by REST + MCP)
  policy.ts              gate policy engine + auto-screening
  auth.ts / authz.ts     bearer-token -> identity / role-in-request -> permissions
  bus.ts                 in-process notifier for the event-feed long-poll
  api.ts                 route-handler plumbing (auth + error mapping)
mcp/                     MCP server (tools.ts + stdio server.ts)
test/                    loop, v1 (HTTP), policy, and mcp tests
scripts/seed.ts          create + seed the local database
```

## Status

A working local prototype of the whole loop with a self-deciding gate: an
authenticated `/v1` REST API, an MCP server, a policy engine that auto-decides
and escalates only exceptions, long-poll on the event feed, an owner console, and
inline UI errors. Next steps are tracked in `ROADMAP.md` (execution/release-time
policy, networked webhooks, rotating tokens, pagination).
