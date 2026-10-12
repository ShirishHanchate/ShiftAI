import Link from "next/link";
import { connection } from "next/server";
import { Mic } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { SetupNotice } from "@/components/layout/setup-notice";
import { IncidentExplorer } from "@/components/dashboard/incident-explorer";
import { computeStats, listIncidents } from "@/lib/incidents";
import { requestTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Incident } from "@/types/incident";

async function loadIncidents(): Promise<{ incidents: Incident[] } | { error: unknown }> {
  try {
    return { incidents: await listIncidents() };
  } catch (error) {
    return { error };
  }
}

export default async function DashboardPage() {
  await connection();
  const result = await loadIncidents();

  return (
    <>
      <PageHeader
        title="Incident Command"
        description="Live view of incidents in flight for the current shift."
        actions={
          <Link href="/handover" className={cn(buttonVariants({ size: "lg" }), "h-10 gap-2 px-4 shadow-sm")}>
            <Mic className="size-4" /> Start Handover
          </Link>
        }
      />
      <PageBody>
        {"error" in result ? (
          <SetupNotice error={result.error} />
        ) : (
          <IncidentExplorer
              initialIncidents={result.incidents}
              initialStats={computeStats(result.incidents)}
              renderedAt={requestTime()}
            />
        )}
      </PageBody>
    </>
  );
}
