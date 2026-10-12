const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "in 30 minutes", "3 hours ago". */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now;
  for (const [unit, ms] of UNITS) {
    // 0.99 avoids "in 60 minutes" when a value sits a few seconds under the hour.
    if (Math.abs(diff) >= ms * 0.99 || unit === "minute") return RTF.format(Math.round(diff / ms), unit);
  }
  return "now";
}

/** Absolute timestamp, always shown in UTC so shifts in different regions agree. */
export function formatUtc(iso: string | null): string {
  if (!iso) return "—";
  return (
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(new Date(iso)) + " UTC"
  );
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
