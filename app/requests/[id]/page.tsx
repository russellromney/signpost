import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/lib/db";
import { getRequestDetail } from "@/lib/queries";
import type { RequestStatus } from "@/lib/types";
import {
  closeAction,
  decideAction,
  markReadyAction,
  postUpdateAction,
  rejectReleaseAction,
  releaseAction,
  resolveCheckAction,
  respondInfoAction,
  startSessionAction,
} from "../../actions";

export const dynamic = "force-dynamic";

function badgeClass(status: RequestStatus): string {
  if (status === "denied") return "badge denied";
  if (status === "closed" || status === "released") return "badge closed";
  if (status === "needs_info" || status === "needs_owner" || status === "blocked")
    return `badge ${status === "blocked" ? "needs_owner" : status}`;
  return "badge";
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="muted">—</span>;
  return (
    <ul className="tight">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = getRequestDetail(getDb(), id);
  if (!detail) notFound();

  const { request: r, decisions, session, actions, receipt, events } = detail;
  const canDecide = ["screening", "needs_info", "needs_owner"].includes(r.status);

  return (
    <>
      <p>
        <Link href="/">← Inbox</Link>
      </p>

      <div className="panel">
        <h1>{r.goal}</h1>
        <p>
          <span className="mono">{r.from_id}</span> → <span className="mono">{r.to_id}</span>{" "}
          <span className={badgeClass(r.status)}>{r.status}</span>
        </p>
        <p className="mono muted">{r.id}</p>
      </div>

      <div className="grid-2">
        <div>
          {/* Request packet */}
          <div className="panel">
            <h2>Request</h2>
            <dl>
              <dt>From</dt>
              <dd className="mono">{r.from_id}</dd>
              <dt>To</dt>
              <dd className="mono">{r.to_id}</dd>
              <dt>Goal</dt>
              <dd>{r.goal}</dd>
              <dt>Definition of done</dt>
              <dd>
                <List items={r.definition_of_done} />
              </dd>
              <dt>Constraints</dt>
              <dd>
                <List items={r.constraints} />
              </dd>
              <dt>Context</dt>
              <dd>
                <List items={r.context} />
              </dd>
              <dt>Deadline</dt>
              <dd>{r.deadline ?? <span className="muted">—</span>}</dd>
            </dl>
          </div>

          {/* Gate decisions */}
          <div className="panel">
            <h2>Gate decision</h2>
            {decisions.length === 0 && <p className="muted">No decision yet.</p>}
            {decisions.map((d) => (
              <div key={d.id} className="event">
                <div>
                  <span className="type">{d.decision}</span>{" "}
                  <span className="badge" style={{ background: "#f1f5f9", color: "#475569" }}>
                    {d.scope}
                  </span>{" "}
                  {d.auto && (
                    <span className="badge" style={{ background: "#ecfdf5", color: "#15803d" }}>
                      auto{d.rule && d.rule !== "default" ? ` · ${d.rule}` : ""}
                    </span>
                  )}{" "}
                  <span className="when">{d.created_at}</span>
                </div>
                <div className="mono muted">{d.gate}</div>
                {d.limits.length > 0 && (
                  <>
                    <strong>Limits</strong>
                    <List items={d.limits} />
                  </>
                )}
                {d.reason.length > 0 && (
                  <>
                    <strong>Reason</strong>
                    <List items={d.reason} />
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Session log */}
          <div className="panel">
            <h2>Session log</h2>
            {!session && <p className="muted">No session yet.</p>}
            {session && (
              <>
                <p className="mono muted">
                  {session.id} · {session.identity} · {session.status}
                </p>
                {actions.map((a) => (
                  <div key={a.id} className="event">
                    <div>
                      <span className="type">{a.action}</span>{" "}
                      <span className="when">{a.created_at}</span>
                      {a.requires_gate ? <span className="badge needs_owner"> needs gate</span> : null}
                    </div>
                    {a.summary && <div>{a.summary}</div>}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Receipt */}
          <div className="panel">
            <h2>Receipt</h2>
            {!receipt && <p className="muted">No receipt yet. No receipt, no done.</p>}
            {receipt && (
              <dl>
                <dt>Receipt</dt>
                <dd className="mono">
                  {receipt.id} · {receipt.status}
                </dd>
                <dt>Artifacts</dt>
                <dd>
                  <List items={receipt.artifacts} />
                </dd>
                <dt>Evidence</dt>
                <dd>
                  <List items={receipt.evidence} />
                </dd>
                <dt>Assumptions</dt>
                <dd>
                  <List items={receipt.assumptions} />
                </dd>
              </dl>
            )}
          </div>
        </div>

        {/* Actions + event history */}
        <div>
          <div className="panel">
            <h2>Actions</h2>

            {canDecide && (
              <>
                <h3>Gate</h3>
                <form action={decideAction} className="btn-row">
                  <input type="hidden" name="request_id" value={r.id} />
                  <button name="decision" value="allow" className="good">
                    Allow
                  </button>
                  <button name="decision" value="deny" className="danger">
                    Deny
                  </button>
                  <button name="decision" value="ask_sender">
                    Ask sender
                  </button>
                  <button name="decision" value="ask_owner">
                    Ask owner
                  </button>
                </form>

                <form action={decideAction} style={{ marginTop: 12 }}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <input type="hidden" name="decision" value="allow_with_limits" />
                  <label>
                    Limits <span className="hint">one per line</span>
                    <textarea
                      name="limits"
                      defaultValue={"May open pull requests.\nMay not merge.\nMay not edit billing, auth, or data export code."}
                    />
                  </label>
                  <label>
                    Reason <span className="hint">one per line</span>
                    <textarea name="reason" defaultValue={"Marketing analytics request within policy."} />
                  </label>
                  <div className="btn-row">
                    <button className="primary" type="submit">
                      Allow with limits
                    </button>
                  </div>
                </form>
              </>
            )}

            {r.status === "needs_info" && (
              <form action={respondInfoAction} style={{ marginTop: 12 }}>
                <input type="hidden" name="request_id" value={r.id} />
                <h3>Respond as sender</h3>
                <label>
                  Answer the gate <span className="hint">one per line</span>
                  <textarea name="answers" defaultValue={"Scope is the header and pricing page CTAs only."} />
                </label>
                <div className="btn-row">
                  <button type="submit">Send info (back to gate)</button>
                </div>
              </form>
            )}

            {r.status === "blocked" && (
              <>
                <h3>Execution check</h3>
                <p className="muted">The worker flagged a risky step. Resolve it.</p>
                <form action={resolveCheckAction}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <label>
                    Reason <span className="hint">one per line</span>
                    <textarea name="reason" defaultValue={"Within the stated limits."} />
                  </label>
                  <div className="btn-row">
                    <button name="decision" value="allow" className="good">
                      Allow action
                    </button>
                    <button name="decision" value="deny" className="danger">
                      Deny action
                    </button>
                  </div>
                </form>
              </>
            )}

            {r.status === "accepted" && (
              <form action={startSessionAction}>
                <input type="hidden" name="request_id" value={r.id} />
                <p className="muted">Gate allowed work. Start a session for {r.to_id}.</p>
                <div className="btn-row">
                  <button className="primary" type="submit">
                    Create / start session
                  </button>
                </div>
              </form>
            )}

            {r.status === "active" && (
              <>
                <h3>Session</h3>
                <form action={postUpdateAction}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <label>
                    Post session update
                    <textarea name="summary" defaultValue="Wired the analytics event and added a test." />
                  </label>
                  <div className="checkbox-row">
                    <input type="checkbox" id="requires_gate" name="requires_gate" />
                    <label htmlFor="requires_gate" style={{ margin: 0 }}>
                      Risky action — flag for gate
                    </label>
                  </div>
                  <div className="btn-row">
                    <button type="submit">Post session update</button>
                  </div>
                </form>

                <form action={markReadyAction} style={{ marginTop: 12 }}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <label>
                    Mark ready for release <span className="hint">optional note</span>
                    <textarea name="summary" defaultValue="Implemented and tested. Ready for review." />
                  </label>
                  <div className="btn-row">
                    <button className="primary" type="submit">
                      Mark ready for release
                    </button>
                  </div>
                </form>
              </>
            )}

            {r.status === "ready_for_release" && (
              <>
                <h3>Release</h3>
                <form action={releaseAction} className="btn-row">
                  <input type="hidden" name="request_id" value={r.id} />
                  <button className="good" type="submit">
                    Release
                  </button>
                </form>
                <form action={rejectReleaseAction} style={{ marginTop: 12 }}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <label>
                    Reject release <span className="hint">reason</span>
                    <textarea name="reason" defaultValue="Needs documentation before release." />
                  </label>
                  <div className="btn-row">
                    <button className="danger" type="submit">
                      Reject release
                    </button>
                  </div>
                </form>
              </>
            )}

            {r.status === "released" && (
              <form action={closeAction}>
                <input type="hidden" name="request_id" value={r.id} />
                <h3>Close with receipt</h3>
                <label>
                  Status
                  <select name="status" defaultValue="completed">
                    <option value="completed">completed</option>
                    <option value="failed">failed</option>
                    <option value="cancelled">cancelled</option>
                  </select>
                </label>
                <label>
                  Artifacts <span className="hint">one per line</span>
                  <textarea name="artifacts" defaultValue={"https://github.com/acme/web/pull/418"} />
                </label>
                <label>
                  Evidence <span className="hint">required, one per line</span>
                  <textarea name="evidence" defaultValue={"npm test -- analytics passed"} />
                </label>
                <label>
                  Assumptions <span className="hint">one per line</span>
                  <textarea
                    name="assumptions"
                    defaultValue={"Signup CTA means header and pricing page only."}
                  />
                </label>
                <div className="btn-row">
                  <button className="primary" type="submit">
                    Close with receipt
                  </button>
                </div>
              </form>
            )}

            {(r.status === "closed" || r.status === "denied") && (
              <p className="muted">This request is closed. No further actions.</p>
            )}
          </div>

          {/* Full event history */}
          <div className="panel">
            <h2>Event history</h2>
            {events.map((e) => (
              <div key={e.id} className="event">
                <div>
                  <span className="type">{e.type}</span>{" "}
                  <span className="when">{e.created_at}</span>
                </div>
                <div className="mono muted">{e.actor}</div>
                {e.summary && <div>{e.summary}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
