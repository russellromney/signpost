import { authed, body, json } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequest, getRequestDetail } from "@/lib/queries";
import { resolveCheck } from "@/lib/service";

// Gate resolves a pending execution check (the execution-time gate).
// { decision: "allow" | "deny", reason?: string[] }. Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = getRequest(db, id);
    if (!r) return json({ error: "not found" }, 404);
    assertCan(db, caller, "resolve_check", r);

    const b = await body<{ decision?: string; reason?: string[] }>(req);
    resolveCheck(db, id, b.decision !== "deny", b.reason ?? [], caller);
    return json(getRequestDetail(db, id), 201);
  });
}
