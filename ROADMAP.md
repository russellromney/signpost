# Roadmap

## Known Traps

- Do not build chat first. The product value is constrained work state, gates, and receipts.
- Do not make humans route every message. Humans should set policy and handle exceptions.
- Do not require a full integration stack before the protocol is useful. The MVP can work with links, attachments, and webhooks.
- Do not start with many request types. Start with one request type and make the lifecycle work.

## Plan: Smallest Signpost Prototype

### Context

Signpost is structured mail for delegated work.

The current repo contains only the initial spec, schemas, and examples.

### References

- `README.md`: product model and lifecycle
- `schemas/*.schema.json`: first machine-readable object contracts
- `examples/*.yml`: sample request and gate policy

### Scope

1. Build one vertical slice: create request, gate it, run a session, release it, close with receipt.
2. Build a tiny API with identities, requests, gate decisions, sessions, actions, releases, and receipts.
3. Build a minimal inbox UI with these views: needs gate decision, active, needs human, ready for release, done.
4. Store all events in an append-only audit log.
5. Keep policy simple: allow, allow with limits, deny, ask sender, ask owner, route, counter.

### Acceptance

- A sender can create a request to any identity.
- The recipient owner's gate can allow, deny, or ask for human approval.
- An allowed request creates a session.
- A session can post a typed action.
- A risky action can trigger gate review.
- A completed request must attach a receipt before release.
- The request detail page shows the full event history.
- The prototype works without GitHub, Slack, email, or calendar integration.

### Out Of Scope

- No freeform chat.
- No multiple request types in the first prototype.
- No GitHub, Slack, email, or calendar integration.
- No autonomous policy learning in the first prototype.
- No reputation scoring until receipts exist.

### Commands

```bash
npm install     # install dependencies
npm run seed    # create + seed ./data/signpost.db
npm run dev     # run the app at http://localhost:3000
npm run build   # production build
npm start       # run the production build
npm test        # end-to-end loop test (temp SQLite db)
npm run lint    # eslint
```

## Completed: First Local Prototype

The smallest vertical slice is built and verified locally.

- Stack: Next.js (App Router) + TypeScript + SQLite (better-sqlite3).
- Entities modeled: identity, request, gate decision, session, session action,
  receipt, and an append-only event log.
- Seeded identities: `russell`, `russell/gate`, `russell/coding`, `maya/marketing`.
- Inbox with five views: Needs Gate Decision, Active, Needs Human,
  Ready For Release, Done.
- Request detail page: from/to, goal, definition of done, constraints, gate
  decision, session log, receipt, and full event history.
- Manual action buttons for the entire loop: create request, allow, allow with
  limits, deny, ask sender, ask owner, create/start session, post session
  update, mark ready for release, release, reject release, close with receipt.
- Every state change appends to the audit log; nothing is "done" without a receipt.
- Tiny JSON API mirrors the service layer.
- Verified: `npm test` (5 passing), `npm run lint` (clean), `npm run build`
  (clean), and the full loop exercised against the running server.

### Verified end to end

`maya/marketing -> russell/gate -> russell/coding`, allow-with-limits, session,
update, ready, release, receipt, close — with the detail page showing the
ordered event history:
`request_created -> routed_to_gate -> gate_decision -> session_started ->
session_update -> ready_for_release -> released -> closed`.

## Completed: Agent-Facing `/v1` API

Signpost now has an authenticated REST API so agents — not just the human
console — can drive the whole loop.

- **Auth**: one bearer token per identity (`tokens` table, deterministic seeds).
  Every call is made *as* an identity. Missing/invalid token → 401.
- **Authorization**: derived from the caller's role on each request
  (sender / worker / gate / owner). Wrong role → 403 (`lib/authz.ts`).
- **Protocol gaps closed**:
  - `respond_to_info` — the sender can now answer an `ask_sender`, returning the
    request to the gate (the old `needs_info` dead end is fixed).
  - Real execution-time gate — `ask_gate` blocks the request; the gate resolves
    it via `/checks` (allow resumes work, deny refuses the step).
- **Read/poll surface**: `/v1/me`, `/v1/inbox` (bucketed by role),
  `/v1/events?since=N` (cursor feed over the audit log, scoped to the caller),
  and filtered `/v1/requests?role=&status=`.
- **Idempotency**: `Idempotency-Key` on request creation for safe retries.
- Verified: 14 tests passing (loop + auth + authz + protocol + feed), lint and
  build clean, and the full loop driven over HTTP as four different identities
  with 401/403 enforcement.

## Completed: Review Hardening

An intensive self-review found ten issues; all are fixed and covered by tests:

- Per-identity idempotency keys (+ migration), input validation → 400 (not 500),
  404 (not 403) for non-parties, guard checks inside transactions, per-connection
  identity cache (no N+1), SQL-side event-feed visibility, release recorded as a
  typed gate decision, owner/gate-derived actor attribution, and a new
  HTTP-level test suite driving the real route handlers end to end.

Remaining known limits: better-sqlite3 transactions are DEFERRED, so the
in-transaction guards are race-free for the single-process prototype but would
need `BEGIN IMMEDIATE` for multi-process writers; the identity cache assumes
identities don't change at runtime (true until a create-identity endpoint exists).

## Completed: Self-Deciding Gate + Second Surface

- **Gate policy engine (request-time):** per-identity policies (`gate_policies`,
  seeded from `examples/gate-policy.yml`); on arrival a request is auto-decided
  or escalated, so humans see only exceptions. Auto decisions carry their rule in
  the audit trail. `GET/PUT /v1/identities/:id/policy` (owner-only writes).
- **Owner console** (`/owner`): Approvals / Escalations / Exceptions / Audit.
- **Inline UI errors** via `useActionState` + `<ActionForm>`.
- **Long-poll** on `/v1/events?wait=ms` (in-process notifier; no busy-polling).
- **MCP server** (`npm run mcp`): 19 tools over the shared `lib/ops` layer, same
  authorization as REST, verified over a real stdio JSON-RPC handshake.
- A shared **`lib/ops.ts`** authorized layer now backs both REST and MCP.
- 37 tests (loop, HTTP, policy, MCP); build + lint green.

## Completed: Route & Counter (the negotiating gate)

The two gate decisions that re-shape a request rather than admit/refuse it are
now real (they previously parked the request at `needs_owner` and did nothing):

- **`route`** re-addresses a request to a different identity and re-runs the
  request-time gate under the *new* recipient's policy (auto-decide included).
  Validated target (must exist; can't be the current recipient).
- **`counter`** proposes terms (`limits`/`reason`); the request waits in a new
  `countered` status until the sender accepts (→ `accepted`, work proceeds under
  the terms) or declines (→ `denied`). New `POST /v1/requests/:id/counter`
  (sender-only), `respond_counter` MCP tool, and owner-console UI for both.
- The policy engine refuses `route`/`counter` as auto decisions — they need a
  per-request target or terms a static rule can't supply.
- 8 new tests (route re-address + re-screen, counter accept/decline, validation,
  authorization, policy rejection); 45 total, build + lint green.

## Next Steps

1. Execution-time and release-time policy (auto-resolve some `ask_gate` checks /
   release checks via trigger rules) — request-time is done.
2. Networked webhooks on the event feed (a hosted, non-local mode).
3. Pagination/cursors on `/v1/requests`; rotating (non-deterministic) tokens.
4. `BEGIN IMMEDIATE` for multi-process write safety (single-process is race-free).
5. A create-identity endpoint (then invalidate the authz identity cache).
6. Inline error feedback polish and a policy editor in the owner UI.
2. Persisted, editable gate policies per identity (the `examples/gate-policy.yml`
   shape) so the gate can auto-decide and only escalate exceptions to humans.
3. Long-poll or webhooks on `/v1/events` so agents don't busy-poll.
4. Pagination/cursors on `/v1/requests`; rotating (non-deterministic) tokens.
5. Owner inbox views (Approvals, Escalations, Exceptions, Audit) and counter/route
   decisions in the UI.
6. Optional: an MCP server over the same service layer for LLM-native agents.
7. Only after receipts accumulate: consider reputation and policy learning
   (still out of scope for now).
