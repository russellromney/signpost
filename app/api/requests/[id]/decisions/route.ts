import { getDb } from "@/lib/db";
import { getRequestDetail } from "@/lib/queries";
import { decide } from "@/lib/service";
import { ok, fail } from "../../../_util";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const db = getDb();
    decide(db, id, {
      decision: body.decision,
      limits: body.limits ?? [],
      reason: body.reason ?? [],
      route_to: body.route_to ?? null,
    });
    return ok(getRequestDetail(db, id), 201);
  } catch (err) {
    return fail(err);
  }
}
