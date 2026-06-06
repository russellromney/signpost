import { authed, json } from "@/lib/api";
import { opGetRequest } from "@/lib/ops";

// Full request state. Visible only to identities party to the request.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    return json(opGetRequest(db, caller, id));
  });
}
