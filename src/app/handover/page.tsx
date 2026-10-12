import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { SetupNotice } from "@/components/layout/setup-notice";
import { HandoverWorkspace } from "@/components/handover/handover-workspace";
import { listIncidents } from "@/lib/incidents";
import { incidentIdSchema } from "@/lib/validation";
import type { Incident } from "@/types/incident";

export const metadata = { title: "Voice Handover · ShiftSync AI" };

export default async function HandoverPage({ searchParams }: PageProps<"/handover">) {
  await connection();
  const params = await searchParams;
  const raw = typeof params.incident === "string" ? params.incident.split(",") : [];

  let incidents: Incident[];
  try {
    incidents = await listIncidents();
  } catch (err) {
    return (
      <PageBody>
        <SetupNotice error={err} />
      </PageBody>
    );
  }
  const known = new Set(incidents.map((i) => i.id));
  const preselected = raw
    .map((id) => incidentIdSchema.safeParse(id.toUpperCase()))
    .filter((r) => r.success && known.has(r.data))
    .map((r) => r.data as string);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Incidents
          </Link>
        }
        title="Shift Handover"
        description="Record your handover, correct the transcript, and review AI-proposed incident updates. Nothing is saved automatically."
      />
      <PageBody>
        <HandoverWorkspace incidents={incidents} preselected={preselected} />
      </PageBody>
    </>
  );
}
