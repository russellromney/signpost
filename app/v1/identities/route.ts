import { authed, body, json } from "@/lib/api";
import { opCreateIdentity, opIdentities } from "@/lib/ops";
import type { CreateIdentityInput } from "@/lib/service";

export async function GET(req: Request) {
  return authed(req, ({ db }) => json({ identities: opIdentities(db) }));
}

// Create an identity. You may create one owned by you (or an identity you own);
// a new top-level principal (self-owned) requires an admin. Returns an initial
// API key whose secret is shown exactly once.
export async function POST(req: Request) {
  return authed(req, async ({ db, caller }) => {
    const b = await body<CreateIdentityInput>(req);
    return json({ key: opCreateIdentity(db, caller, b) }, 201);
  });
}
