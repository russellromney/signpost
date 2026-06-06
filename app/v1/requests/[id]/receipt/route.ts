import { authed, body, json, loadParty } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequestDetail } from "@/lib/queries";
import { closeWithReceipt } from "@/lib/service";
import type { ReceiptStatus } from "@/lib/types";

// Close a released request with a receipt. No receipt, no done. Worker/owner.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = loadParty(db, caller, id);
    assertCan(db, caller, "close", r);

    const b = await body<{
      status?: ReceiptStatus;
      artifacts?: string[];
      evidence?: string[];
      assumptions?: string[];
    }>(req);
    const receipt = closeWithReceipt(
      db,
      id,
      {
        status: b.status ?? "completed",
        artifacts: b.artifacts ?? [],
        evidence: b.evidence ?? [],
        assumptions: b.assumptions ?? [],
      },
      caller,
    );
    // receipt_id is distinct from the detail's `receipt` object below.
    return json({ receipt_id: receipt, ...getRequestDetail(db, id) }, 201);
  });
}
