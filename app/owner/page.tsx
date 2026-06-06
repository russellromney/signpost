import Link from "next/link";

import { getDb } from "@/lib/db";
import { eventsSince, listIdentities, ownerInbox } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Identities that own at least one other identity are the "owners" worth viewing.
function ownerOptions(db: ReturnType<typeof getDb>): string[] {
  const ids = listIdentities(db);
  const owners = new Set(ids.filter((i) => i.owner !== i.id).map((i) => i.owner));
  return [...owners].sort();
}

const SECTIONS: Array<{ key: "approvals" | "escalations" | "exceptions"; label: string; blurb: string }> = [
  { key: "approvals", label: "Approvals", blurb: "Awaiting your yes/no — a manual gate or a release check." },
  { key: "escalations", label: "Escalations", blurb: "The policy sent these up to you to decide." },
  { key: "exceptions", label: "Exceptions", blurb: "A worker is blocked on a risky step." },
];

export default async function OwnerPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const db = getDb();
  const owners = ownerOptions(db);
  const { owner: owthe } = await searchParams;
  const owner = owthe && owners.includes(owthe) ? owthe : (owners[0] ?? "russell");

  const inbox = ownerInbox(db, owner);
  // Audit: the most recent events the owner can see, newest first.
  const feed = eventsSince(db, owner, 0, { limit: 500 }).events.slice(-20).reverse();

  return (
    <>
      <div className="panel">
        <h1>Owner console</h1>
        <p className="muted">
          Humans are exception handlers. This is the small inbox: approvals, escalations, exceptions,
          and an audit trail.
        </p>
        <div className="btn-row">
          <Link href="/" className="badge" style={{ background: "#eef2ff" }}>
            ← Full inbox
          </Link>
          {owners.map((o) => (
            <Link
              key={o}
              href={`/owner?owner=${encodeURIComponent(o)}`}
              className="badge"
              style={o === owner ? { background: "#2563eb", color: "#fff" } : {}}
            >
              {o}
            </Link>
          ))}
        </div>
      </div>

      <div className="inbox">
        {SECTIONS.map((s) => {
          const items = inbox[s.key];
          return (
            <div className="column" key={s.key}>
              <h3>
                {s.label} <span className="count">{items.length}</span>
              </h3>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                {s.blurb}
              </p>
              {items.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Clear</p>}
              {items.map((r) => (
                <Link className="card" key={r.id} href={`/requests/${r.id}`}>
                  <span className="goal">{r.goal}</span>
                  <span className="meta">
                    {r.from_id} → {r.to_id} · {r.status}
                  </span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2>Audit</h2>
        {inbox.recent.length > 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Recently closed: {inbox.recent.map((r) => r.goal).join(" · ")}
          </p>
        )}
        {feed.length === 0 && <p className="muted">No activity yet.</p>}
        {feed.map((e) => (
          <div key={e.id} className="event">
            <div>
              <Link href={`/requests/${e.request_id}`} className="type">
                {e.type}
              </Link>{" "}
              <span className="when">{e.created_at}</span>
            </div>
            <div className="mono muted">{e.actor}</div>
            {e.summary && <div>{e.summary}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
