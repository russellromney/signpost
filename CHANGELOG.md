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
- Hardening from an intensive self-review (all findings fixed):
  - Idempotency keys are now scoped per identity (was a global key collision /
    cross-identity request-id leak); migration upgrades existing databases.
  - Malformed request bodies (e.g. missing goal) return 400, not 500.
  - Action endpoints return 404 (not 403) to non-parties, so they never reveal
    that a request exists.
  - Service guard checks moved inside their transactions (removes a check/write
    race); identity lookups cached per connection (removes feed/inbox N+1).
  - Event feed filters visibility in SQL so a page returns up to `limit` visible
    events; release now records a typed gate decision (scope=release).
  - Default actor attribution derives from the request owner/gate, not a
    hardcoded identity.
  - Added HTTP-level tests that drive the real route handlers end to end
    (auth, error mapping, idempotency, the full loop).
- Self-deciding gate and a second surface:
  - Extracted lib/ops.ts, the authorized operations layer shared by REST + MCP.
  - Gate policy engine (request-time): per-identity policies auto-decide known
    cases and escalate only exceptions; auto decisions recorded with their rule.
    GET/PUT /v1/identities/:id/policy (owner-only writes).
  - Owner console at /owner (approvals / escalations / exceptions / audit).
  - Inline UI error feedback via useActionState + <ActionForm>.
  - Long-poll on /v1/events?wait=ms (in-process notifier; no busy-polling).
  - MCP server (npm run mcp): 19 tools over lib/ops with identical authorization.
  - Tests now cover policy, MCP, owner inbox, and long-poll (37 total).
