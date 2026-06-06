import { getDb } from "@/lib/db";
import { getRequestDetail } from "@/lib/queries";
import { ok, fail } from "../../_util";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const detail = getRequestDetail(getDb(), id);
    if (!detail) return ok({ error: "not found" }, 404);
    return ok(detail);
  } catch (err) {
    return fail(err);
  }
}
