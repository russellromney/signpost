import { authed, body, json } from "@/lib/api";
import { opResolveCheck } from "@/lib/ops";

// Gate resolves a pending execution check (the execution-time gate).
// { decision: "allow" | "deny", reason?: string[] }. Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<{ decision?: string; reason?: string[] }>(req);
    return json(opResolveCheck(db, caller, id, b.decision !== "deny", b.reason ?? []), 201);
  });
}
