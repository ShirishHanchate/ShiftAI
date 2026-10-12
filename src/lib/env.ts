import "server-only";

/**
 * Server-only configuration access. Values are read lazily so that a missing
 * variable produces a clear, actionable error at the point of use instead of
 * crashing the whole app at import time.
 */
export const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SARVAM_API_KEY"] as const;
export type RequiredEnv = (typeof REQUIRED_ENV)[number];

export class ConfigError extends Error {
  constructor(public readonly variable: RequiredEnv) {
    super(
      `Missing required environment variable ${variable}. ` +
        `Copy .env.example to .env.local, set ${variable}, and restart the dev server.`,
    );
    this.name = "ConfigError";
  }
}

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(name: RequiredEnv): string {
  const value = read(name);
  if (!value) throw new ConfigError(name);
  return value;
}

/** Reports which variables are configured, without revealing their values. */
export function configStatus(): Record<RequiredEnv, boolean> {
  return Object.fromEntries(REQUIRED_ENV.map((k) => [k, Boolean(read(k))])) as Record<RequiredEnv, boolean>;
}

