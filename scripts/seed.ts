// Initializes the local SQLite database and seeds the four identities.
// Safe to run repeatedly: identities are inserted with INSERT OR IGNORE.
import { resolve } from "node:path";
import { createDb } from "../lib/db";
import { listIdentities } from "../lib/queries";

const path = process.env.SIGNPOST_DB ?? resolve(process.cwd(), "data", "signpost.db");
const db = createDb(path);

console.log(`Signpost database ready at ${path}`);
console.log("Seeded identities:");
for (const i of listIdentities(db)) {
  console.log(`  ${i.id.padEnd(16)} ${i.kind.padEnd(8)} owner=${i.owner}`);
}
