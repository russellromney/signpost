import { authed, body, json } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequest, getRequestDetail } from "@/lib/queries";
import { closeWithReceipt } from "@/lib/service";
import type { ReceiptStatus } from "@/lib/types";

// Close a released request with a receipt. No receipt, no done. Worker/owner.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = getRequest(db, id);
    if (!r) return json({ error: "not found" }, 404);
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
    return json({ receipt, ...getRequestDetail(db, id) }, 201);
  });
}
