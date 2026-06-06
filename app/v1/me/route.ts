import { authed, json } from "@/lib/api";
import { identityById } from "@/lib/queries";

// Who am I? Resolves the caller's token to their identity.
export async function GET(req: Request) {
  return authed(req, ({ db, caller }) => json({ identity: identityById(db, caller) }));
}
