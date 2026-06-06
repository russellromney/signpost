import { authed, json, loadParty } from "@/lib/api";
import { getRequestDetail } from "@/lib/queries";

// Full request state. Visible only to identities party to the request.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    loadParty(db, caller, id); // 404 if missing or caller is not a party
    return json(getRequestDetail(db, id));
  });
}
