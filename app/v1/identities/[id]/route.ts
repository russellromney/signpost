import { authed, body, json } from "@/lib/api";
import { opDisableIdentity, opGetIdentity, opUpdateIdentity } from "@/lib/ops";
import type { UpdateIdentityInput } from "@/lib/service";

// Read one identity. Any authenticated caller may read (identities are public).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    return json({ identity: opGetIdentity(db, caller, id) });
  });
}

// Update display name / description / gate. Owner (or admin) only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<UpdateIdentityInput>(req);
    return json({ identity: opUpdateIdentity(db, caller, id, b) });
  });
}

// Soft-disable an identity. Owner (or admin) only.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    return json({ identity: opDisableIdentity(db, caller, id) });
  });
}
