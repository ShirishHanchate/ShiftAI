import { AlertOctagon, AlertTriangle, ListTodo, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IncidentStats } from "@/types/incident";

const CARDS = [
  { key: "activeIncidents", label: "Active incidents", hint: "Not yet resolved", icon: Siren, tone: "text-primary bg-primary/10" },
  { key: "sev1", label: "SEV1 active", hint: "Critical impact", icon: AlertOctagon, tone: "text-red-600 bg-red-50" },
  { key: "sev2", label: "SEV2 active", hint: "Major impact", icon: AlertTriangle, tone: "text-orange-600 bg-orange-50" },
  { key: "pendingActions", label: "Pending actions", hint: "Across active incidents", icon: ListTodo, tone: "text-violet-600 bg-violet-50" },
] as const;

export function StatCards({ stats }: { stats: IncidentStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map(({ key, label, hint, icon: Icon, tone }) => (
        <div key={key} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <span className={cn("flex size-7 items-center justify-center rounded-md", tone)}>
              <Icon className="size-4" />
            </span>
          </div>
          <p className={cn("mt-1 text-3xl font-semibold tabular-nums tracking-tight", key === "sev1" && stats.sev1 > 0 && "text-red-600")}>
            {stats[key]}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
      ))}
    </div>
  );
}
