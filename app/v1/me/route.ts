import { authed, json } from "@/lib/api";
import { opWhoami } from "@/lib/ops";

// Who am I? Resolves the caller's token to their identity.
export async function GET(req: Request) {
  return authed(req, ({ db, caller }) => json({ identity: opWhoami(db, caller) }));
}
