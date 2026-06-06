import { authed, body, json } from "@/lib/api";
import { opCreateRequest, opListRequests } from "@/lib/ops";
import type { RequestStatus, Role } from "@/lib/types";

// List requests the caller is party to. Filter with ?role= and ?status=.
// e.g. ?role=worker&status=accepted = "what should I start?".
export async function GET(req: Request) {
  return authed(req, ({ db, caller }) => {
    const url = new URL(req.url);
    const role = (url.searchParams.get("role") as Role) ?? undefined;
    const status = (url.searchParams.get("status") as RequestStatus) ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
    return json({ requests: opListRequests(db, caller, { role, status, limit }) });
  });
}

// Create a request. You may only send AS yourself. Honors an Idempotency-Key
// header for safe retries.
export async function POST(req: Request) {
  return authed(req, async ({ db, caller }) => {
    const b = await body<{
      from?: string;
      to: string;
      goal: string;
      definition_of_done?: string[];
      constraints?: string[];
      context?: string[];
      deadline?: string | null;
    }>(req);
    const { id, replayed } = opCreateRequest(
      db,
      caller,
      {
        from_id: b.from,
        to_id: b.to,
        goal: b.goal,
        definition_of_done: b.definition_of_done ?? [],
        constraints: b.constraints ?? [],
        context: b.context ?? [],
        deadline: b.deadline ?? null,
      },
      req.headers.get("idempotency-key"),
    );
    return json({ id, replayed }, replayed ? 200 : 201);
  });
}
