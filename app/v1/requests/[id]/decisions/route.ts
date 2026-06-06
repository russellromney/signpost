import { authed, body, json } from "@/lib/api";
import { opDecide } from "@/lib/ops";
import type { GateDecisionKind } from "@/lib/types";

// Gate decision on a request (the request-time gate). Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<{
      decision: GateDecisionKind;
      limits?: string[];
      reason?: string[];
      route_to?: string | null;
    }>(req);
    return json(
      opDecide(db, caller, id, {
        decision: b.decision,
        limits: b.limits,
        reason: b.reason,
        route_to: b.route_to,
      }),
      201,
    );
  });
}
