import { authed, json } from "@/lib/api";
import { eventsSince } from "@/lib/queries";

// Cursor feed over the append-only log, scoped to the caller. Poll with
// ?since=<cursor> to get only new events; ?request=<id> to filter one request.
export async function GET(req: Request) {
  return authed(req, ({ db, caller }) => {
    const url = new URL(req.url);
    const since = Number(url.searchParams.get("since") ?? 0) || 0;
    const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
    const request = url.searchParams.get("request") ?? undefined;
    return json(eventsSince(db, caller, since, { request, limit }));
  });
}
