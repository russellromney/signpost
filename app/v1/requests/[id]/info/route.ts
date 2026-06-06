import { authed, body, json, loadParty } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequestDetail } from "@/lib/queries";
import { respondToInfo } from "@/lib/service";

// The sender answers an ask_sender. Re-enters the gate for screening. Sender only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = loadParty(db, caller, id);
    assertCan(db, caller, "respond_info", r);

    const b = await body<{ answers?: string[] }>(req);
    respondToInfo(db, id, b.answers ?? [], caller);
    return json(getRequestDetail(db, id), 201);
  });
}
