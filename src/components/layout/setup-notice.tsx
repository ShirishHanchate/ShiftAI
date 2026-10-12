import { DatabaseZap } from "lucide-react";
import { ConfigError } from "@/lib/env";
import { DatabaseError } from "@/lib/supabase";

/** Friendly, non-leaky explanation shown when the data layer is not ready. */
export function SetupNotice({ error }: { error: unknown }) {
  let title = "Unable to load incidents";
  let body: React.ReactNode = "An unexpected error occurred while contacting the database.";

  if (error instanceof ConfigError) {
    title = "Configuration required";
    body = (
      <>
        <code className="rounded bg-muted px-1 font-mono text-xs">{error.variable}</code> is not set. Copy{" "}
        <code className="rounded bg-muted px-1 font-mono text-xs">.env.example</code> to{" "}
        <code className="rounded bg-muted px-1 font-mono text-xs">.env.local</code>, fill in your Supabase and Sarvam
        credentials, and restart the dev server.
      </>
    );
  } else if (error instanceof DatabaseError) {
    const missingTable = error.code === "42P01" || error.code === "PGRST205";
    title = missingTable ? "Database table missing" : "Database unavailable";
    body = missingTable ? (
      <>
        Run <code className="rounded bg-muted px-1 font-mono text-xs">supabase/migrations/0001_incidents.sql</code> in
        the Supabase SQL editor, then <code className="rounded bg-muted px-1 font-mono text-xs">npm run seed</code>.
      </>
    ) : (
      "Could not query Supabase. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
      <span className="flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <DatabaseZap className="size-5" />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
