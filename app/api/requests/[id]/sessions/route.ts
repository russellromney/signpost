import { getDb } from "@/lib/db";
import { getRequestDetail } from "@/lib/queries";
import { postUpdate, startSession } from "@/lib/service";
import { ok, fail } from "../../../_util";

// Start a session, or post an action against the active session when `action`
// is provided. Keeps the prototype's single request type request-scoped.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const db = getDb();
    if (body.action === "post_update") {
      postUpdate(db, id, body.summary ?? "", Boolean(body.requires_gate));
    } else {
      startSession(db, id);
    }
    return ok(getRequestDetail(db, id), 201);
  } catch (err) {
    return fail(err);
  }
}
