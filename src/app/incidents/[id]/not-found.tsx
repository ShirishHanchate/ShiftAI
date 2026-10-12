import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function IncidentNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="size-5 text-muted-foreground" />
      </span>
      <h1 className="text-lg font-semibold">Incident not found</h1>
      <p className="text-sm text-muted-foreground">The incident ID does not exist or is not valid.</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Back to incidents
      </Link>
    </main>
  );
}
