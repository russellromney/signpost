import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { getDb } from "@/lib/db";
import { getRequestDetail, listIdentities } from "@/lib/queries";
import { ActionForm } from "../../components/ActionForm";
import {
  closeAction,
  decideAction,
  markReadyAction,
  postUpdateAction,
  rejectReleaseAction,
  releaseAction,
  resolveCheckAction,
  respondCounterAction,
  respondInfoAction,
  startSessionAction,
} from "../../actions";

export const dynamic = "force-dynamic";

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const detail = getRequestDetail(db, id);
  if (!detail) notFound();

  const { request: r, decisions, session, actions, receipt, events } = detail;
  const canDecide = ["screening", "needs_info", "needs_owner"].includes(r.status);
  const hidden = <input type="hidden" name="request_id" value={r.id} />;
  // Targets the gate could route this request to (anyone but the current recipient).
  const routeTargets = listIdentities(db).filter((i) => i.id !== r.to_id);
  // The terms a pending counter proposed, for the sender's accept/decline panel.
  const counter = [...decisions].reverse().find((d) => d.decision === "counter");

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Inbox
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{r.goal}</h1>
          <StatusBadge status={r.status} />
        </div>
        <p className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
          {r.from_id} <ArrowRight className="size-3.5" /> {r.to_id}
          <span className="text-muted-foreground/60">· {r.id}</span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: the record */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Request</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="From"><span className="font-mono">{r.from_id}</span></Field>
                <Field label="To"><span className="font-mono">{r.to_id}</span></Field>
                <Field label="Definition of done"><Bullets items={r.definition_of_done} /></Field>
                <Field label="Constraints"><Bullets items={r.constraints} /></Field>
                <Field label="Context"><Bullets items={r.context} /></Field>
                <Field label="Deadline">{r.deadline ?? <span className="text-muted-foreground">—</span>}</Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gate decisions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {decisions.length === 0 && <p className="text-sm text-muted-foreground">No decision yet.</p>}
              {decisions.map((d) => (
                <div key={d.id} className="space-y-1.5 border-l-2 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{d.decision}</span>
                    <Badge variant="outline">{d.scope}</Badge>
                    {d.auto && (
                      <Badge variant="success">
                        auto{d.rule && d.rule !== "default" ? ` · ${d.rule}` : ""}
                      </Badge>
                    )}
                    {d.route_to && (
                      <span className="font-mono text-xs text-muted-foreground">→ {d.route_to}</span>
                    )}
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{d.gate}</span>
                  </div>
                  {d.limits.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground">Limits</p>
                      <Bullets items={d.limits} />
                    </div>
                  )}
                  {d.reason.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground">Reason</p>
                      <Bullets items={d.reason} />
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Session log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!session && <p className="text-sm text-muted-foreground">No session yet.</p>}
              {session && (
                <>
                  <p className="font-mono text-xs text-muted-foreground">
                    {session.id} · {session.identity} · {session.status}
                  </p>
                  {actions.map((a) => (
                    <div key={a.id} className="space-y-0.5 border-l-2 pl-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{a.action}</span>
                        {a.requires_gate && <Badge variant="warning">needs gate</Badge>}
                        {a.gate_status && <Badge variant="outline">{a.gate_status}</Badge>}
                      </div>
                      {a.summary && <p className="text-sm text-muted-foreground">{a.summary}</p>}
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receipt</CardTitle>
            </CardHeader>
            <CardContent>
              {!receipt && (
                <p className="text-sm text-muted-foreground">No receipt yet. No receipt, no done.</p>
              )}
              {receipt && (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Field label="Receipt">
                    <span className="font-mono">{receipt.id}</span> · {receipt.status}
                  </Field>
                  <Field label="Artifacts"><Bullets items={receipt.artifacts} /></Field>
                  <Field label="Evidence"><Bullets items={receipt.evidence} /></Field>
                  <Field label="Assumptions"><Bullets items={receipt.assumptions} /></Field>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: actions + history */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {canDecide && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gate</p>
                  <ActionForm action={decideAction} className="flex flex-wrap gap-2">
                    {hidden}
                    <Button name="decision" value="allow" size="sm">Allow</Button>
                    <Button name="decision" value="deny" size="sm" variant="destructive">Deny</Button>
                    <Button name="decision" value="ask_sender" size="sm" variant="outline">Ask sender</Button>
                    <Button name="decision" value="ask_owner" size="sm" variant="outline">Ask owner</Button>
                  </ActionForm>
                  <ActionForm action={decideAction} className="space-y-2">
                    {hidden}
                    <input type="hidden" name="decision" value="allow_with_limits" />
                    <Label>Limits <span className="text-muted-foreground">(one per line)</span></Label>
                    <Textarea
                      name="limits"
                      rows={3}
                      defaultValue={"May open pull requests.\nMay not merge.\nMay not edit billing, auth, or data export code."}
                    />
                    <Label>Reason <span className="text-muted-foreground">(one per line)</span></Label>
                    <Textarea name="reason" rows={2} defaultValue={"Marketing analytics request within policy."} />
                    <Button type="submit" size="sm">Allow with limits</Button>
                  </ActionForm>
                  <ActionForm action={decideAction} className="space-y-2">
                    {hidden}
                    <input type="hidden" name="decision" value="counter" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Counter
                    </p>
                    <Label>Proposed terms <span className="text-muted-foreground">(one per line)</span></Label>
                    <Textarea name="limits" rows={2} defaultValue={"Scope to the header CTA only.\nShip behind a flag."} />
                    <Label>Reason <span className="text-muted-foreground">(one per line)</span></Label>
                    <Textarea name="reason" rows={2} defaultValue={"Original scope is too broad for auto-approval."} />
                    <Button type="submit" size="sm" variant="outline">Counter to sender</Button>
                  </ActionForm>
                  {routeTargets.length > 0 && (
                    <ActionForm action={decideAction} className="space-y-2">
                      {hidden}
                      <input type="hidden" name="decision" value="route" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Route
                      </p>
                      <Label htmlFor="route_to">Send to a different identity</Label>
                      <Select name="route_to" defaultValue={routeTargets[0].id}>
                        <SelectTrigger id="route_to"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {routeTargets.map((i) => (
                            <SelectItem key={i.id} value={i.id}>{i.id}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Textarea name="reason" rows={2} defaultValue={"Better handled by another identity."} />
                      <Button type="submit" size="sm" variant="outline">Route</Button>
                    </ActionForm>
                  )}
                </div>
              )}

              {r.status === "countered" && (
                <ActionForm action={respondCounterAction} className="space-y-2">
                  {hidden}
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Counter from gate — respond as sender
                  </p>
                  {counter && (counter.limits.length > 0 || counter.reason.length > 0) && (
                    <div className="rounded-md border bg-muted/40 p-3 text-sm">
                      {counter.limits.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-muted-foreground">Proposed terms</p>
                          <Bullets items={counter.limits} />
                        </>
                      )}
                      {counter.reason.length > 0 && (
                        <>
                          <p className="mt-2 text-xs font-semibold text-muted-foreground">Reason</p>
                          <Bullets items={counter.reason} />
                        </>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button name="accept" value="true" size="sm">Accept terms</Button>
                    <Button name="accept" value="false" size="sm" variant="destructive">Decline</Button>
                  </div>
                </ActionForm>
              )}

              {r.status === "needs_info" && (
                <ActionForm action={respondInfoAction} className="space-y-2">
                  {hidden}
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Respond as sender
                  </p>
                  <Label>Answer the gate <span className="text-muted-foreground">(one per line)</span></Label>
                  <Textarea name="answers" rows={2} defaultValue={"Scope is the header and pricing page CTAs only."} />
                  <Button type="submit" size="sm" variant="outline">Send info (back to gate)</Button>
                </ActionForm>
              )}

              {r.status === "blocked" && (
                <ActionForm action={resolveCheckAction} className="space-y-2">
                  {hidden}
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Execution check
                  </p>
                  <p className="text-sm text-muted-foreground">The worker flagged a risky step. Resolve it.</p>
                  <Label>Reason <span className="text-muted-foreground">(one per line)</span></Label>
                  <Textarea name="reason" rows={2} defaultValue={"Within the stated limits."} />
                  <div className="flex gap-2">
                    <Button name="decision" value="allow" size="sm">Allow action</Button>
                    <Button name="decision" value="deny" size="sm" variant="destructive">Deny action</Button>
                  </div>
                </ActionForm>
              )}

              {r.status === "accepted" && (
                <ActionForm action={startSessionAction} className="space-y-2">
                  {hidden}
                  <p className="text-sm text-muted-foreground">Gate allowed work. Start a session for {r.to_id}.</p>
                  <Button type="submit" size="sm">Create / start session</Button>
                </ActionForm>
              )}

              {r.status === "active" && (
                <div className="space-y-4">
                  <ActionForm action={postUpdateAction} className="space-y-2">
                    {hidden}
                    <Label>Post session update</Label>
                    <Textarea name="summary" rows={2} defaultValue="Wired the analytics event and added a test." />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="requires_gate" className="size-4 rounded border-input" />
                      Risky action — flag for gate
                    </label>
                    <Button type="submit" size="sm" variant="outline">Post update</Button>
                  </ActionForm>
                  <Separator />
                  <ActionForm action={markReadyAction} className="space-y-2">
                    {hidden}
                    <Label>Mark ready for release <span className="text-muted-foreground">(note)</span></Label>
                    <Textarea name="summary" rows={2} defaultValue="Implemented and tested. Ready for review." />
                    <Button type="submit" size="sm">Mark ready for release</Button>
                  </ActionForm>
                </div>
              )}

              {r.status === "ready_for_release" && (
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Release</p>
                  <ActionForm action={releaseAction}>
                    {hidden}
                    <Button type="submit" size="sm">Release</Button>
                  </ActionForm>
                  <ActionForm action={rejectReleaseAction} className="space-y-2">
                    {hidden}
                    <Label>Reject release <span className="text-muted-foreground">(reason)</span></Label>
                    <Textarea name="reason" rows={2} defaultValue="Needs documentation before release." />
                    <Button type="submit" size="sm" variant="destructive">Reject release</Button>
                  </ActionForm>
                </div>
              )}

              {r.status === "released" && (
                <ActionForm action={closeAction} className="space-y-2">
                  {hidden}
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Close with receipt
                  </p>
                  <Label>Status</Label>
                  <Select name="status" defaultValue="completed">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="completed">completed</SelectItem>
                      <SelectItem value="failed">failed</SelectItem>
                      <SelectItem value="cancelled">cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label>Artifacts <span className="text-muted-foreground">(one per line)</span></Label>
                  <Textarea name="artifacts" rows={2} defaultValue={"https://github.com/acme/web/pull/418"} />
                  <Label>Evidence <span className="text-muted-foreground">(required)</span></Label>
                  <Textarea name="evidence" rows={2} defaultValue={"npm test -- analytics passed"} />
                  <Label>Assumptions <span className="text-muted-foreground">(one per line)</span></Label>
                  <Textarea name="assumptions" rows={2} defaultValue={"Signup CTA means header and pricing page only."} />
                  <Button type="submit" size="sm">Close with receipt</Button>
                </ActionForm>
              )}

              {(r.status === "closed" || r.status === "denied") && (
                <p className="text-sm text-muted-foreground">This request is closed. No further actions.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event history</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="relative border-l-2 pl-4">
                    <span className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-primary" />
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{e.type}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{e.created_at.slice(11, 19)}</span>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{e.actor}</p>
                    {e.summary && <p className="text-sm text-muted-foreground">{e.summary}</p>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
