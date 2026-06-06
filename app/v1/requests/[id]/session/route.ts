import { authed, json, loadParty } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequestDetail } from "@/lib/queries";
import { startSession } from "@/lib/service";

// Worker claims an accepted request and starts a session. Worker only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = loadParty(db, caller, id);
    assertCan(db, caller, "start_session", r);

    const session = startSession(db, id);
    // session_id is distinct from the detail's `session` object below.
    return json({ session_id: session, ...getRequestDetail(db, id) }, 201);
  });
}
