import { authed, body, json } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequest, getRequestDetail } from "@/lib/queries";
import { respondToInfo } from "@/lib/service";

// The sender answers an ask_sender. Re-enters the gate for screening. Sender only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = getRequest(db, id);
    if (!r) return json({ error: "not found" }, 404);
    assertCan(db, caller, "respond_info", r);

    const b = await body<{ answers?: string[] }>(req);
    respondToInfo(db, id, b.answers ?? [], caller);
    return json(getRequestDetail(db, id), 201);
  });
}
