import { authed, body, json } from "@/lib/api";
import { opRejectRelease, opRelease } from "@/lib/ops";

// The release-time gate. { op: "reject", reason } sends it back to the worker;
// otherwise the output is released. Gate/owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<{ op?: string; reason?: string }>(req);
    const detail =
      b.op === "reject"
        ? opRejectRelease(db, caller, id, b.reason ?? "")
        : opRelease(db, caller, id);
    return json(detail, 201);
  });
}
