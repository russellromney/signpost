import { authed, json } from "@/lib/api";
import { rolesOf } from "@/lib/authz";
import { getRequest, getRequestDetail } from "@/lib/queries";

// Full request state. Visible only to identities party to the request.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = getRequest(db, id);
    if (!r || rolesOf(db, caller, r).length === 0) return json({ error: "not found" }, 404);
    return json(getRequestDetail(db, id));
  });
}
