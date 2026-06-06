import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/types";

type Variant = React.ComponentProps<typeof Badge>["variant"];

// Map each lifecycle status to a badge variant + human label.
const STATUS: Record<RequestStatus, { variant: Variant; label: string }> = {
  screening: { variant: "info", label: "screening" },
  needs_info: { variant: "warning", label: "needs info" },
  needs_owner: { variant: "warning", label: "needs owner" },
  accepted: { variant: "secondary", label: "accepted" },
  denied: { variant: "destructive", label: "denied" },
  active: { variant: "info", label: "active" },
  blocked: { variant: "warning", label: "blocked" },
  ready_for_release: { variant: "secondary", label: "ready for release" },
  released: { variant: "success", label: "released" },
  closed: { variant: "success", label: "closed" },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS[status] ?? { variant: "outline" as Variant, label: status };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
