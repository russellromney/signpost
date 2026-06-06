import { getDb } from "@/lib/db";
import { getRequestDetail } from "@/lib/queries";
import { closeWithReceipt, markReadyForRelease, rejectRelease, release } from "@/lib/service";
import { ok, fail } from "../../../_util";

// Release-phase transitions. `op` selects the action:
//   ready  -> mark ready for release
//   reject -> reject the release, send back to active
//   close  -> close with a receipt
//   (default) -> release
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const db = getDb();
    switch (body.op) {
      case "ready":
        markReadyForRelease(db, id, body.summary);
        break;
      case "reject":
        rejectRelease(db, id, body.reason ?? "");
        break;
      case "close":
        closeWithReceipt(db, id, {
          status: body.status ?? "completed",
          artifacts: body.artifacts ?? [],
          evidence: body.evidence ?? [],
          assumptions: body.assumptions ?? [],
        });
        break;
      default:
        release(db, id);
    }
    return ok(getRequestDetail(db, id), 201);
  } catch (err) {
    return fail(err);
  }
}
