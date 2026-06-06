import { authed, body, json, loadParty } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequestDetail } from "@/lib/queries";
import { resolveCheck } from "@/lib/service";

// Gate resolves a pending execution check (the execution-time gate).
// { decision: "allow" | "deny", reason?: string[] }. Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = loadParty(db, caller, id);
    assertCan(db, caller, "resolve_check", r);

    const b = await body<{ decision?: string; reason?: string[] }>(req);
    resolveCheck(db, id, b.decision !== "deny", b.reason ?? [], caller);
    return json(getRequestDetail(db, id), 201);
  });
}
