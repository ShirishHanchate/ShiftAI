const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SARVAM_API_KEY"];

/** Prints a helpful startup warning when required configuration is missing. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.warn(
      `\n[ShiftSync] Missing configuration: ${missing.join(", ")}.\n` +
        `  Copy .env.example to .env.local, fill in the values, and restart \`npm run dev\`.\n`,
    );
  }
}
