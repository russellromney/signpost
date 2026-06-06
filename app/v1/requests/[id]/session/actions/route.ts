import { authed, body, json, loadParty } from "@/lib/api";
import { assertCan } from "@/lib/authz";
import { getRequestDetail } from "@/lib/queries";
import { askGate, markReadyForRelease, postUpdate, ServiceError } from "@/lib/service";

// Typed session actions from the worker:
//   post_update -> a progress note
//   ask_gate    -> flag a risky step; the request blocks for a gate check
//   complete    -> mark ready for release
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const r = loadParty(db, caller, id);
    assertCan(db, caller, "session_action", r);

    const b = await body<{ action?: string; summary?: string }>(req);
    switch (b.action) {
      case "post_update":
        postUpdate(db, id, b.summary ?? "");
        break;
      case "ask_gate":
        askGate(db, id, b.summary ?? "");
        break;
      case "complete":
        markReadyForRelease(db, id, b.summary);
        break;
      default:
        throw new ServiceError("action must be post_update, ask_gate, or complete");
    }
    return json(getRequestDetail(db, id), 201);
  });
}
