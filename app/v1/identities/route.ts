import { authed, json } from "@/lib/api";
import { listIdentities } from "@/lib/queries";

export async function GET(req: Request) {
  return authed(req, ({ db }) => json({ identities: listIdentities(db) }));
}
