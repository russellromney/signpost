import { authed, json } from "@/lib/api";
import { waitForEvent } from "@/lib/bus";
import { opEvents } from "@/lib/ops";

// Cursor feed over the append-only log, scoped to the caller. Poll with
// ?since=<cursor> to get only new events; ?request=<id> to filter one request.
// ?wait=<ms> long-polls (capped at 25s): the request is held until a new visible
// event arrives or the timeout elapses, so agents don't busy-poll.
export async function GET(req: Request) {
  return authed(req, async ({ db, caller }) => {
    const url = new URL(req.url);
    const since = Number(url.searchParams.get("since") ?? 0) || 0;
    const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
    const request = url.searchParams.get("request") ?? undefined;
    const wait = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 0) || 0, 0), 25000);

    let feed = opEvents(db, caller, since, { request, limit });
    if (feed.events.length === 0 && wait > 0) {
      const deadline = Date.now() + wait;
      while (feed.events.length === 0 && Date.now() < deadline) {
        await waitForEvent(deadline - Date.now());
        feed = opEvents(db, caller, since, { request, limit });
      }
    }
    return json(feed);
  });
}
