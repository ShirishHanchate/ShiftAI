/**
 * FICTIONAL SAMPLE DATA — emails, chat messages and ticket comments linked to the
 * seed incidents. Timestamps are relative to when the seed runs.
 */
export interface SeedCommunication {
  dedupeKey: string;
  incidentId: string;
  channel: "email" | "chat" | "ticket_comment";
  author: string;
  subject: string | null;
  body: string;
  sentAt: string;
}

const H = 60 * 60 * 1000;
const M = 60 * 1000;

export function buildSeedCommunications(now: Date = new Date()): SeedCommunication[] {
  const t = (offset: number) => new Date(now.getTime() + offset).toISOString();
  const c = (key: string, incidentId: string, channel: SeedCommunication["channel"], author: string, subject: string | null, body: string, offset: number) => ({
    dedupeKey: `seed-${key}`,
    incidentId,
    channel,
    author,
    subject,
    body,
    sentAt: t(offset),
  });
  return [
    c("1042-a", "INC-1042", "email", "Daniel Okafor", "RE: Change request CR-8812 – rollback of gateway config",
      "Rollback CR-8812 is queued for approval. The payments platform lead is in a vendor call until 07:30 UTC; approval expected right after. Do not roll back manually.", -50 * M),
    c("1042-b", "INC-1042", "chat", "Asha Rao", null,
      "5xx rate still ~8% in eu-west. Traffic shifted 30% to eu-central as a stop-gap, error rate for shifted traffic is normal.", -35 * M),
    c("1042-c", "INC-1042", "email", "CardPay Support (vendor)", "Ticket #CP-55102 elevated declines",
      "We are investigating elevated declines from your merchant ID. No action required on your side yet. Next update from us within 2 hours.", -20 * M),
    c("1043-a", "INC-1043", "chat", "Mei Lin", null,
      "Lag down to 3.2k from 40k. Should be fully drained in ~45 minutes at current rate. Keep 12 replicas until then.", -40 * M),
    c("1044-a", "INC-1044", "email", "DBA Team", "RE: Access request ACC-2291 (prod query stats)",
      "Access request ACC-2291 needs manager approval from the identity team before we can grant read access. Please ask your manager to approve in the access portal.", -2 * H),
    c("1044-b", "INC-1044", "ticket_comment", "Carlos Mendes", null,
      "Slow query log shows a reporting job (analytics_daily_rollup) running every 15 minutes and holding ~30 connections for 40-60s. Matches the latency spikes.", -90 * M),
    c("1045-a", "INC-1045", "email", "Finance Analytics", "Dashboards stale again",
      "Finance month-end review is tomorrow 09:00 UTC. We need the invoice dashboards refreshed before then.", -3 * H),
    c("1046-a", "INC-1046", "ticket_comment", "Priya Nair", null,
      "Root cause: renewal cron failed because the ACME DNS-01 API token expired. New token issued; cron fix pending review in PR #4471.", -2 * H),
    c("1047-a", "INC-1047", "chat", "Tom Becker", null,
      "search-node-3 disk at 92% IO utilisation. Considering moving replicas off it, waiting for the storage team to confirm spare capacity.", -60 * M),
    c("1049-a", "INC-1049", "email", "MailRelay Provider", "Throttle lifted",
      "We have lifted the sending limit on your account. Recommend enabling our queue-depth alerting feature.", -22 * H),
  ];
}
