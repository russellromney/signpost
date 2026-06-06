import { authed, json } from "@/lib/api";
import { opIdentities } from "@/lib/ops";

export async function GET(req: Request) {
  return authed(req, ({ db }) => json({ identities: opIdentities(db) }));
}
