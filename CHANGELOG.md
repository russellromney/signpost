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
