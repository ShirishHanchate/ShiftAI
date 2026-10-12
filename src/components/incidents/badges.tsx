import { cn } from "@/lib/utils";
import type { IncidentStatus, Severity } from "@/types/incident";

const SEVERITY_STYLES: Record<Severity, string> = {
  SEV1: "bg-red-600 text-white ring-red-700/30",
  SEV2: "bg-orange-500 text-white ring-orange-600/30",
  SEV3: "bg-amber-100 text-amber-900 ring-amber-300",
  SEV4: "bg-slate-100 text-slate-700 ring-slate-300",
};

const SEVERITY_DOT: Record<Severity, string> = {
  SEV1: "bg-red-600",
  SEV2: "bg-orange-500",
  SEV3: "bg-amber-400",
  SEV4: "bg-slate-400",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 font-mono text-[11px] font-semibold tracking-wide ring-1 ring-inset",
        SEVERITY_STYLES[severity],
        className,
      )}
    >
      {severity}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      {severity === "SEV1" && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", SEVERITY_DOT[severity])} />
    </span>
  );
}

const STATUS_STYLES: Record<IncidentStatus, string> = {
  Open: "bg-blue-50 text-blue-700 ring-blue-200",
  Investigating: "bg-violet-50 text-violet-700 ring-violet-200",
  Monitoring: "bg-teal-50 text-teal-700 ring-teal-200",
  Resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export function StatusBadge({ status, className }: { status: IncidentStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        STATUS_STYLES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

export function SampleDataBadge() {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[10px] font-medium tracking-wider whitespace-nowrap text-muted-foreground uppercase ring-1 ring-border ring-inset">
      Fictional sample data
    </span>
  );
}
