import { authed, json } from "@/lib/api";
import { opInbox } from "@/lib/ops";

// The caller's actionable work, bucketed by their role on each request.
export async function GET(req: Request) {
  return authed(req, ({ db, caller }) => json({ identity: caller, inbox: opInbox(db, caller) }));
}
