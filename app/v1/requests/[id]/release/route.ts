import { authed, body, json, loadParty } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequestDetail } from "@/lib/queries";
import { rejectRelease, release } from "@/lib/service";

// The release-time gate. { op: "reject", reason } sends it back to the worker;
// otherwise the output is released. Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = loadParty(db, caller, id);

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
