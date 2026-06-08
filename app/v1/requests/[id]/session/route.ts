import { authed, json } from "@/lib/api";
import { opStartSession } from "@/lib/ops";

// Worker claims an accepted request and starts a session. Worker only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    return json(opStartSession(db, caller, id), 201);
  });
}
