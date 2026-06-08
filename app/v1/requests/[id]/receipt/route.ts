import { authed, body, json } from "@/lib/api";
import { opClose } from "@/lib/ops";
import type { ReceiptStatus } from "@/lib/types";

// Close a released request with a receipt. No receipt, no done. Worker/owner.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<{
      status?: ReceiptStatus;
      artifacts?: string[];
      evidence?: string[];
      assumptions?: string[];
    }>(req);
    return json(
      opClose(db, caller, id, {
        status: b.status ?? "completed",
        artifacts: b.artifacts ?? [],
        evidence: b.evidence ?? [],
        assumptions: b.assumptions ?? [],
      }),
      201,
    );
  });
}
