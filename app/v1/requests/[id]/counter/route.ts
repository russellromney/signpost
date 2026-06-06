import { authed, body, json } from "@/lib/api";
import { opRespondCounter } from "@/lib/ops";

// The sender accepts or declines a gate's counter-offer. Accept proceeds under
// the proposed terms; decline closes the request. Sender only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<{ accept?: boolean }>(req);
    return json(opRespondCounter(db, caller, id, b.accept === true), 201);
  });
}
