import { getDb } from "@/lib/db";
import { getRequestDetail, listRequests } from "@/lib/queries";
import { createRequest } from "@/lib/service";
import { ok, fail } from "../_util";

export async function GET() {
  try {
    return ok(listRequests(getDb()));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const db = getDb();
    const id = createRequest(db, {
      from_id: body.from,
      to_id: body.to,
      goal: body.goal,
      definition_of_done: body.definition_of_done ?? [],
      constraints: body.constraints ?? [],
      context: body.context ?? [],
      deadline: body.deadline ?? null,
    });
    return ok(getRequestDetail(db, id), 201);
  } catch (err) {
    return fail(err);
  }
}
