import { authed, body, json } from "@/lib/api";
import { opSessionAction, type SessionActionKindInput } from "@/lib/ops";

// Typed session actions from the worker:
//   post_update -> a progress note
//   ask_gate    -> flag a risky step; the request blocks for a gate check
//   complete    -> mark ready for release
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<{ action?: SessionActionKindInput; summary?: string }>(req);
    return json(opSessionAction(db, caller, id, b.action as SessionActionKindInput, b.summary), 201);
  });
}
