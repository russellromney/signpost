import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Humans are exception handlers, not message routers. Pick a request that needs a decision.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {INBOX_VIEWS.map((view) => {
          const items = buckets[view.key] ?? [];
          return (
            <div key={view.key} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {view.label}
                </h2>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {items.length === 0 && (
                  <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    Empty
                  </p>
                )}
                {items.map((r) => (
                  <Link key={r.id} href={`/requests/${r.id}`} className="group">
                    <Card className="gap-2 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                      <CardContent className="space-y-1.5">
                        <p className="text-sm font-medium leading-snug group-hover:text-primary">
                          {r.goal}
                        </p>
                        <p className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                          {r.from_id} <ArrowRight className="size-3" /> {r.to_id}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" /> Create request
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createRequestAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="from_id">From</Label>
                <Select name="from_id" defaultValue="maya/marketing">
                  <SelectTrigger id="from_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {identities.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to_id">To</Label>
                <Select name="to_id" defaultValue="russell/coding">
                  <SelectTrigger id="to_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {identities.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="goal">Goal</Label>
              <Input id="goal" name="goal" defaultValue="Add launch tracking to the signup CTA." />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="definition_of_done">
                  Definition of done <span className="text-muted-foreground">(one per line)</span>
                </Label>
                <Textarea
                  id="definition_of_done"
                  name="definition_of_done"
                  rows={3}
                  defaultValue={"Event fires when the CTA is clicked.\nEvent name is documented."}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="constraints">
                  Constraints <span className="text-muted-foreground">(one per line)</span>
                </Label>
                <Textarea id="constraints" name="constraints" rows={3} defaultValue={"Do not change billing flow."} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="context">
                  Context links <span className="text-muted-foreground">(one per line)</span>
                </Label>
                <Textarea id="context" name="context" rows={2} defaultValue={"https://github.com/acme/web/issues/42"} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deadline">
                  Deadline <span className="text-muted-foreground">(optional, ISO)</span>
                </Label>
                <Input id="deadline" name="deadline" placeholder="2026-06-09T17:00:00Z" />
              </div>
            </div>

            <Button type="submit">
              <Plus className="size-4" /> Create request
            </Button>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
