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

No build commands yet. Add them when the prototype stack is chosen.
