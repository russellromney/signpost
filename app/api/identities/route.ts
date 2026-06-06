import { getDb } from "@/lib/db";
import { listIdentities } from "@/lib/queries";
import { ok, fail } from "../_util";

export async function GET() {
  try {
    return ok(listIdentities(getDb()));
  } catch (err) {
    return fail(err);
  }
}
