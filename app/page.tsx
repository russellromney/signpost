import Link from "next/link";

import { getDb } from "@/lib/db";
import { INBOX_VIEWS, inbox, listIdentities } from "@/lib/queries";
import { ActionForm } from "./components/ActionForm";
import { createRequestAction } from "./actions";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  const db = getDb();
  const buckets = inbox(db);
  const identities = listIdentities(db);

  return (
    <>
      <div className="panel">
        <h1>Inbox</h1>
        <p className="muted">
          Humans are exception handlers, not message routers. Pick a request that needs a decision.
        </p>
      </div>

      <div className="inbox">
        {INBOX_VIEWS.map((view) => {
          const items = buckets[view.key] ?? [];
          return (
            <div className="column" key={view.key}>
              <h3>
                {view.label} <span className="count">{items.length}</span>
              </h3>
              {items.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Empty</p>}
              {items.map((r) => (
                <Link className="card" key={r.id} href={`/requests/${r.id}`}>
                  <span className="goal">{r.goal}</span>
                  <span className="meta">
                    {r.from_id} → {r.to_id}
                  </span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      <details className="panel" open={buckets.needs_gate.length + Object.values(buckets).flat().length === 0}>
        <summary>Create request</summary>
        <ActionForm action={createRequestAction} style={{ marginTop: 12 }}>
          <div className="grid-2">
            <div>
              <label>
                From
                <select name="from_id" defaultValue="maya/marketing" required>
                  {identities.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <label>
                To
                <select name="to_id" defaultValue="russell/coding" required>
                  {identities.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <label>
            Goal
            <input
              name="goal"
              required
              defaultValue="Add launch tracking to the signup CTA."
            />
          </label>

          <label>
            Definition of done <span className="hint">one per line</span>
            <textarea name="definition_of_done" defaultValue={"Event fires when the CTA is clicked.\nEvent name is documented."} />
          </label>

          <label>
            Constraints <span className="hint">one per line</span>
            <textarea name="constraints" defaultValue={"Do not change billing flow."} />
          </label>

          <label>
            Context links <span className="hint">one per line</span>
            <textarea name="context" defaultValue={"https://github.com/acme/web/issues/42"} />
          </label>

          <label>
            Deadline <span className="hint">optional, ISO date-time</span>
            <input name="deadline" placeholder="2026-06-09T17:00:00Z" />
          </label>

          <div className="btn-row">
            <button className="primary" type="submit">
              Create request
            </button>
          </div>
        </ActionForm>
      </details>
    </>
  );
}
