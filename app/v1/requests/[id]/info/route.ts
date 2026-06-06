import { authed, body, json } from "@/lib/api";
import { opRespondInfo } from "@/lib/ops";

// The sender answers an ask_sender. Re-enters the gate for screening. Sender only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<{ answers?: string[] }>(req);
    return json(opRespondInfo(db, caller, id, b.answers ?? []), 201);
  });
}
