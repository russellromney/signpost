import { authed, body, json, loadParty } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequestDetail } from "@/lib/queries";
import { decide } from "@/lib/service";
import type { GateDecisionKind } from "@/lib/types";

// Gate decision on a request (the request-time gate). Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = loadParty(db, caller, id);
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
