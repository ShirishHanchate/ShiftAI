/**
 * FICTIONAL SAMPLE DATA.
 *
 * Every incident, service, person and timestamp below is invented for the
 * ShiftSync AI demo. People are referenced only by fictional names and every
 * record carries `isSampleData: true`, which the UI surfaces as a badge.
 * Timestamps are generated relative to the moment the seed script runs so the
 * demo always looks current.
 */
import type { Incident } from "@/types/incident";


const H = 60 * 60 * 1000;
const M = 60 * 1000;

export function buildSeedIncidents(now: Date = new Date()): Incident[] {
  const t = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();
  const history = (createdAt: string, notes: [number, string, string][]) => [
    { at: createdAt, author: "ShiftSync seed (fictional)", source: "seed" as const, note: "Fictional sample incident created for the demo." },
    ...notes.map(([offset, author, note]) => ({ at: t(offset), author, source: "manual" as const, note })),
  ];

  const incidents: Omit<Incident, "updatedAt" | "isSampleData">[] = [
    {
      id: "INC-1042",
      title: "Payments API returning elevated 5xx errors in eu-west",
      description:
        "Checkout requests routed to the eu-west payments cluster are failing with HTTP 502/503 at roughly 8% of traffic. Started after the 18:40 UTC config push.",
      severity: "SEV1",
      status: "Investigating",
      affectedService: "payments-gateway",
      summary: "Partial checkout failures in eu-west; config rollback suspected but not yet confirmed as the fix.",
      actionsCompleted: [
        "Paged payments on-call and opened bridge call",
        "Confirmed failures isolated to eu-west cluster",
      ],
      pendingActions: [
        { description: "Roll back 18:40 UTC gateway config push", owner: "Asha Rao", dueAt: t(1 * H), status: "pending" },
        { description: "Engage upstream card processor about elevated declines", owner: null, dueAt: null, status: "pending" },
      ],
      blockers: ["Rollback requires change-approval from payments platform lead"],
      owner: "Asha Rao",
      nextUpdateAt: t(30 * M),
      createdAt: t(-3 * H),
      updateHistory: history(t(-3 * H), [
        [-2.5 * H, "Asha Rao", "Error rate confirmed at ~8% in eu-west only."],
        [-1 * H, "Daniel Okafor", "Rollback change request raised, awaiting approval."],
      ]),
    },
    {
      id: "INC-1043",
      title: "Order events consumer lag on Kafka topic order.created",
      description:
        "Consumer group order-fulfilment is lagging by ~40k messages, delaying fulfilment emails and warehouse picks by up to 25 minutes.",
      severity: "SEV2",
      status: "Monitoring",
      affectedService: "order-events-pipeline",
      summary: "Lag is decreasing after scaling consumers from 6 to 12 pods; monitoring until it drains.",
      actionsCompleted: ["Scaled consumer deployment from 6 to 12 replicas", "Verified no poison-pill messages in DLQ"],
      pendingActions: [
        { description: "Confirm lag below 1k messages before closing", owner: "Mei Lin", dueAt: t(2 * H), status: "pending" },
        { description: "Scale consumers back to baseline after drain", owner: null, dueAt: null, status: "pending" },
      ],
      blockers: [],
      owner: "Mei Lin",
      nextUpdateAt: t(1 * H),
      createdAt: t(-5 * H),
      updateHistory: history(t(-5 * H), [[-2 * H, "Mei Lin", "Consumers scaled to 12; lag trending down."]]),
    },
    {
      id: "INC-1044",
      title: "Login latency spikes from identity DB connection pool exhaustion",
      description:
        "p95 login latency peaks at 9s every ~15 minutes. Identity service logs show connection pool timeouts against the primary user database.",
      severity: "SEV2",
      status: "Investigating",
      affectedService: "identity-service",
      summary: "Periodic pool exhaustion; suspected long-running analytics query holding connections.",
      actionsCompleted: ["Captured slow query log for the last 6 hours"],
      pendingActions: [
        { description: "Identify the query holding connections during spikes", owner: "Carlos Mendes", dueAt: null, status: "pending" },
        { description: "Evaluate raising pool size from 50 to 80", owner: null, dueAt: null, status: "pending" },
      ],
      blockers: ["DBA read access to production query stats not yet granted"],
      owner: "Carlos Mendes",
      nextUpdateAt: t(2 * H),
      createdAt: t(-7 * H),
      updateHistory: history(t(-7 * H), [[-4 * H, "Carlos Mendes", "Slow query log captured; analysis in progress."]]),
    },
    {
      id: "INC-1045",
      title: "Nightly reporting ETL job failing at transform stage",
      description:
        "The nightly warehouse ETL has failed two nights in a row with a schema mismatch on the invoices table. Finance dashboards show stale data.",
      severity: "SEV3",
      status: "Open",
      affectedService: "reporting-etl",
      summary: "Schema drift on invoices source table; dashboards are 2 days stale.",
      actionsCompleted: [],
      pendingActions: [
        { description: "Compare invoices schema with ETL mapping", owner: null, dueAt: null, status: "pending" },
      ],
      blockers: [],
      owner: null,
      nextUpdateAt: null,
      createdAt: t(-20 * H),
      updateHistory: history(t(-20 * H), []),
    },
    {
      id: "INC-1046",
      title: "Expired TLS certificate on static assets CDN hostname",
      description:
        "static.example-shop.test served an expired certificate for ~35 minutes causing broken images and CSS for some browsers. Certificate has been renewed.",
      severity: "SEV1",
      status: "Monitoring",
      affectedService: "edge-cdn",
      summary: "Certificate renewed and propagated; monitoring for residual cached failures.",
      actionsCompleted: [
        "Renewed certificate manually",
        "Purged CDN edge cache",
        "Verified valid certificate from 5 regions",
      ],
      pendingActions: [
        { description: "Fix auto-renewal job that silently failed", owner: "Priya Nair", dueAt: t(24 * H), status: "pending" },
        { description: "Draft customer-facing incident note", owner: null, dueAt: null, status: "pending" },
      ],
      blockers: [],
      owner: "Priya Nair",
      nextUpdateAt: t(3 * H),
      createdAt: t(-6 * H),
      updateHistory: history(t(-6 * H), [
        [-5.5 * H, "Priya Nair", "Certificate renewed, cache purge started."],
        [-5 * H, "Priya Nair", "Validated from 5 regions. Moved to Monitoring."],
      ]),
    },
    {
      id: "INC-1047",
      title: "Catalog search index replication delayed",
      description:
        "New and updated products take up to 45 minutes to appear in search results. Replica shards on search-node-3 are behind the primary.",
      severity: "SEV3",
      status: "Investigating",
      affectedService: "catalog-search",
      summary: "Replica lag isolated to one node; disk I/O saturation suspected.",
      actionsCompleted: ["Confirmed lag isolated to search-node-3"],
      pendingActions: [
        { description: "Check disk I/O metrics on search-node-3", owner: "Tom Becker", dueAt: null, status: "pending" },
      ],
      blockers: [],
      owner: "Tom Becker",
      nextUpdateAt: t(4 * H),
      createdAt: t(-9 * H),
      updateHistory: history(t(-9 * H), []),
    },
    {
      id: "INC-1048",
      title: "Staging dashboards missing metrics after collector upgrade",
      description:
        "Several staging Grafana panels show 'No data' since the metrics collector was upgraded. Production is unaffected.",
      severity: "SEV4",
      status: "Open",
      affectedService: "observability-stack",
      summary: "Staging-only; likely relabeling rule change in the new collector version.",
      actionsCompleted: [],
      pendingActions: [
        { description: "Review collector relabel config diff", owner: null, dueAt: null, status: "pending" },
      ],
      blockers: [],
      owner: null,
      nextUpdateAt: null,
      createdAt: t(-26 * H),
      updateHistory: history(t(-26 * H), []),
    },
    {
      id: "INC-1049",
      title: "Notification emails delayed through SMTP relay",
      description:
        "Password reset and order confirmation emails were delayed by up to 40 minutes due to a throttled SMTP relay.",
      severity: "SEV2",
      status: "Resolved",
      affectedService: "notification-service",
      summary: "Relay throttling lifted by provider; queue fully drained.",
      actionsCompleted: [
        "Contacted email relay provider",
        "Provider lifted throttle",
        "Verified outbound queue drained to zero",
      ],
      pendingActions: [
        { description: "Schedule post-incident review", owner: "Daniel Okafor", dueAt: t(48 * H), status: "pending" },
        { description: "Add alert on relay queue depth", owner: "Daniel Okafor", dueAt: null, status: "completed" },
      ],
      blockers: [],
      owner: "Daniel Okafor",
      nextUpdateAt: null,
      createdAt: t(-30 * H),
      updateHistory: history(t(-30 * H), [[-22 * H, "Daniel Okafor", "Queue drained. Marked Resolved."]]),
    },
  ];

  return incidents.map((incident) => {
    const lastHistory = incident.updateHistory[incident.updateHistory.length - 1];
    return { ...incident, updatedAt: lastHistory.at, isSampleData: true };
  });
}
