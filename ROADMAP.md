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

## Next Steps

1. Inline error feedback in the UI (currently service errors throw; surface them
   on the form with `useActionState`).
2. The execution-time gate: route flagged risky session actions
   (`requires_gate`) through the gate before they proceed.
3. Persisted, editable gate policies per identity (the `examples/gate-policy.yml`
   shape) instead of fully manual decisions.
4. Owner inbox (Approvals, Escalations, Exceptions, Audit).
5. Counter and route decisions in the UI.
6. Only after receipts accumulate: consider reputation and policy learning
   (still out of scope for now).
