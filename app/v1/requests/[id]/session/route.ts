import { authed, json } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequest, getRequestDetail } from "@/lib/queries";
import { startSession } from "@/lib/service";

// Worker claims an accepted request and starts a session. Worker only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = getRequest(db, id);
    if (!r) return json({ error: "not found" }, 404);
    assertCan(db, caller, "start_session", r);

    const session = startSession(db, id);
    return json({ session, ...getRequestDetail(db, id) }, 201);
  });
}
