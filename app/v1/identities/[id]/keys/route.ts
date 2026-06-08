import { authed, body, json } from "@/lib/api";
import { opIssueKey, opListKeys } from "@/lib/ops";

// List an identity's API keys (metadata only — never the secret). Owner/admin.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    return json({ keys: opListKeys(db, caller, id) });
  });
}

// Issue a new key for an identity. The secret is returned exactly once. Owner/admin.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authed(req, async ({ db, caller }) => {
    const { id } = await params;
    const b = await body<{ label?: string; expires_at?: string | null }>(req);
    return json({ key: opIssueKey(db, caller, id, { label: b.label, expires_at: b.expires_at }) }, 201);
  });
}
