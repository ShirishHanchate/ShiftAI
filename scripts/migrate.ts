/**
 * Applies supabase/migrations/*.sql to the Supabase project using the official
 * Supabase CLI (`supabase db push --db-url`). No `supabase login` required.
 *
 *   npm run db:migrate
 *
 * Requires SUPABASE_DB_URL in .env.local — use the Session pooler connection
 * string from the Supabase dashboard (Connect → Session pooler).
 */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL?.trim();
if (!dbUrl) {
  console.error(
    "SUPABASE_DB_URL is not set. Add the Session pooler connection string to .env.local,\n" +
      "or run supabase/migrations/*.sql manually in the Supabase SQL Editor.",
  );
  process.exit(1);
}

const result = spawnSync("npx", ["--yes", "supabase@2", "db", "push", "--db-url", dbUrl, "--include-all", "--yes"], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
  encoding: "utf8",
});

// Never echo the connection string (it contains the database password).
const redact = (s: string) => s.split(dbUrl).join("<SUPABASE_DB_URL>").replace(/postgres(ql)?:\/\/[^\s]+/g, "<redacted-url>");
process.stdout.write(redact(result.stdout ?? ""));
process.stderr.write(redact(result.stderr ?? ""));
process.exit(result.status ?? 1);
