import { authed, body, json } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequest, getRequestDetail } from "@/lib/queries";
import { rejectRelease, release } from "@/lib/service";

// The release-time gate. { op: "reject", reason } sends it back to the worker;
// otherwise the output is released. Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = getRequest(db, id);
    if (!r) return json({ error: "not found" }, 404);

    const b = await body<{ op?: string; reason?: string }>(req);
    if (b.op === "reject") {
      assertCan(db, caller, "reject_release", r);
      rejectRelease(db, id, b.reason ?? "", caller);
    } else {
      assertCan(db, caller, "release", r);
      release(db, id, caller);
    }
    return json(getRequestDetail(db, id), 201);
  });
}
