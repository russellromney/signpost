# Changelog

## Unreleased

- Created the initial Signpost product spec.
- Added first schemas for identities, requests, gate decisions, session actions, and receipts.
- Added example request and gate policy.
- Built the first local-only prototype: Next.js (App Router) + TypeScript + SQLite.
  - Modeled identities, requests, gate decisions, sessions, session actions,
    receipts, and an append-only event log.
  - Seeded identities: russell, russell/gate, russell/coding, maya/marketing.
  - Inbox with five views and a request detail page with full event history.
  - Manual action buttons for the whole loop (request -> gate -> session ->
    release -> receipt) plus a tiny JSON API.
  - Added an end-to-end loop test.
- Added an authenticated, agent-facing `/v1` REST API.
  - Bearer-token auth (one token per identity) and role-in-request authorization
    (sender / worker / gate / owner; 401/403/400 mapping).
  - Closed protocol gaps: respond-to-ask_sender, and a real execution-time gate
    (ask_gate blocks; gate resolves a check).
  - Read/poll surface: /v1/me, /v1/inbox (bucketed by role), /v1/events cursor
    feed, and filtered /v1/requests listing.
  - Idempotency-Key support on request creation.
  - Replaced the earlier unauthenticated /api demo routes.
  - Added v1 tests (auth, authz, protocol, event feed).
