import Link from "next/link";
import { ArrowRight, ClipboardCheck, AlertTriangle, ShieldAlert, ScrollText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { getDb } from "@/lib/db";
import { eventsSince, listIdentities, ownerInbox } from "@/lib/queries";
import type { SignpostRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

function ownerOptions(db: ReturnType<typeof getDb>): string[] {
  const ids = listIdentities(db);
  return [...new Set(ids.filter((i) => i.owner !== i.id).map((i) => i.owner))].sort();
}

function RequestList({ items, empty }: { items: SignpostRequest[]; empty: string }) {
  if (items.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((r) => (
        <Link key={r.id} href={`/requests/${r.id}`}>
          <Card className="gap-2 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
            <CardContent className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.goal}</p>
                <p className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  {r.from_id} <ArrowRight className="size-3" /> {r.to_id}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default async function OwnerPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const db = getDb();
  const owners = ownerOptions(db);
  const { owner: requested } = await searchParams;
  const owner = requested && owners.includes(requested) ? requested : (owners[0] ?? "russell");

  const inbox = ownerInbox(db, owner);
  const feed = eventsSince(db, owner, 0, { limit: 500 }).events.slice(-25).reverse();

  const sections = [
    {
      key: "approvals",
      label: "Approvals",
      icon: ClipboardCheck,
      blurb: "Awaiting your yes/no — a manual gate or a release check.",
      items: inbox.approvals,
    },
    {
      key: "escalations",
      label: "Escalations",
      icon: ShieldAlert,
      blurb: "The policy sent these up to you to decide.",
      items: inbox.escalations,
    },
    {
      key: "exceptions",
      label: "Exceptions",
      icon: AlertTriangle,
      blurb: "A worker is blocked on a risky step.",
      items: inbox.exceptions,
    },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Owner console</h1>
          <p className="text-sm text-muted-foreground">
            Humans are exception handlers. Approvals, escalations, exceptions, and an audit trail.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {owners.map((o) => (
            <Button key={o} asChild size="sm" variant={o === owner ? "default" : "outline"}>
              <Link href={`/owner?owner=${encodeURIComponent(o)}`}>{o}</Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4" /> {s.label}
                  <Badge variant="secondary" className="ml-auto">{s.items.length}</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{s.blurb}</p>
              </CardHeader>
              <CardContent>
                <RequestList items={s.items} empty="Clear" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4" /> Audit
          </CardTitle>
          {inbox.recent.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Recently closed: {inbox.recent.map((r) => r.goal).join(" · ")}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {feed.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          <ol className="space-y-3">
            {feed.map((e) => (
              <li key={e.id} className="relative border-l-2 pl-4">
                <span className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-primary" />
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/requests/${e.request_id}`} className="text-sm font-medium hover:underline">
                    {e.type}
                  </Link>
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
  );
}
