import { authed, body, json } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequest, getRequestDetail } from "@/lib/queries";
import { decide } from "@/lib/service";
import type { GateDecisionKind } from "@/lib/types";

// Gate decision on a request (the request-time gate). Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = getRequest(db, id);
    if (!r) return json({ error: "not found" }, 404);
    assertCan(db, caller, "decide", r);

    const b = await body<{
      decision: GateDecisionKind;
      limits?: string[];
      reason?: string[];
      route_to?: string | null;
    }>(req);
    decide(
      db,
      id,
      { decision: b.decision, limits: b.limits, reason: b.reason, route_to: b.route_to },
      caller,
    );
    return json(getRequestDetail(db, id), 201);
  });
}
