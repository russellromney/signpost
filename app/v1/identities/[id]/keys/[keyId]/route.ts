import { authed, json } from "@/lib/api";
import { opRevokeKey } from "@/lib/ops";

// Revoke an API key. Owner of the key's identity (or admin) only.
export async function DELETE(req: Request, { params }: { params: Promise<{ keyId: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { keyId } = await params;
    return json(opRevokeKey(db, caller, keyId));
  });
}
