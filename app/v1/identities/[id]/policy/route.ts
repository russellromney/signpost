import { authed, body, json } from "@/lib/api";
import { opGetPolicy, opSetPolicy } from "@/lib/ops";
import type { GatePolicy } from "@/lib/types";

// Read an identity's gate policy. The identity itself or its owner may read.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    return json({ identity: id, policy: opGetPolicy(db, caller, id) });
  });
}

// Replace an identity's gate policy. Owner only.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<Partial<GatePolicy>>(req);
    return json({ identity: id, policy: opSetPolicy(db, caller, id, b) }, 200);
  });
}
