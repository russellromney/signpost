import { authed, json } from "@/lib/api";
import { opAdminEvents } from "@/lib/ops";

// The identity/owner/key management audit. With ?identity=<id>, returns that
// identity's events (its owner/admin, or itself, may read). Without it,
// admin-only and global. ?limit caps the result (newest first).
export async function GET(req: Request) {
  return authed(req, ({ db, caller }) => {
    const url = new URL(req.url);
    const identity = url.searchParams.get("identity") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
    return json({ events: opAdminEvents(db, caller, { identity, limit }) });
  });
}
