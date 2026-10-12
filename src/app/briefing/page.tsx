import Link from "next/link";
import { connection } from "next/server";
import { Bot } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { SetupNotice } from "@/components/layout/setup-notice";
import { BriefingView } from "@/components/briefing/briefing-view";
import { loadCurrentBriefing } from "@/lib/briefing-data";
import { requestTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Briefing } from "@/types/briefing";

export const metadata = { title: "Incoming Shift · ShiftSync AI" };

async function load(): Promise<{ briefing: Briefing } | { error: unknown }> {
  try {
    return { briefing: await loadCurrentBriefing(requestTime()) };
  } catch (error) {
    return { error };
  }
}

export default async function BriefingPage() {
  await connection();
  const result = await load();
  return (
    <>
      <PageHeader
        title="Incoming Shift Briefing"
        description="What needs attention now, in priority order — built only from confirmed incident records."
        actions={
          <Link href="/assistant" className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2")}>
            <Bot className="size-4" /> Ask ShiftSync
          </Link>
        }
      />
      <PageBody>{"error" in result ? <SetupNotice error={result.error} /> : <BriefingView initial={result.briefing} />}</PageBody>
    </>
  );
}
