/**
 * LIVE integration check against Sarvam (requires SARVAM_API_KEY; no database needed).
 * Runs the real extraction engine over a sample transcript using the fictional seed
 * incidents as candidates.   npm run live:extract
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { extractHandover } from "../src/lib/extraction";
import { buildSeedIncidents } from "../src/data/seed-incidents";

const transcript =
  process.argv.slice(2).join(" ") ||
  "Shift handover from the night shift. First, incident INC 1042, the payments API five hundred errors in EU West. " +
    "Asha Rao rolled back the gateway config about twenty minutes ago and the error rate has dropped to around one percent. " +
    "We are still waiting for the card processor to call us back about the declines. Asha will give the next update in thirty minutes. " +
    "Second, INC 1043, the Kafka order consumer lag. The lag has fully drained, it is under five hundred messages now. " +
    "Mei Lin needs to scale the consumers back down to six pods, but nobody has done that yet. " +
    "Third, the login latency issue, INC 1044. We think it is the analytics query, but we are blocked because the DBA access has still not been granted. " +
    "Carlos should chase the DBA team. Also, the staging dashboards look a bit better, maybe it fixed itself, not sure.";

const started = Date.now();
extractHandover(transcript, buildSeedIncidents())
  .then((draft) => {
    console.log(`OK in ${((Date.now() - started) / 1000).toFixed(1)}s · model=${draft.model}`);
    for (const p of [...draft.matched, ...draft.unmatched]) {
      console.log(`\n${p.incidentId ?? `UNMATCHED(${p.suggestedIncidentId ?? "-"})`} [match=${p.matchConfidence} conf=${p.confidence} review=${p.requiresReview}]`);
      console.log(`  situation: ${p.currentSituation}`);
      for (const a of p.actionsCompleted) console.log(`  done${a.evidenceVerified ? "" : " (UNVERIFIED)"}: ${a.description}`);
      for (const a of p.pendingActions) console.log(`  todo: ${a.description} | owner=${a.owner} due=${a.dueAt}`);
      for (const b of p.blockers) console.log(`  blocker: ${b}`);
      console.log(`  owner=${p.owner?.value ?? null} nextUpdate=${p.nextUpdateAt?.value ?? null} status=${p.proposedStatus?.value ?? null}`);
      if (p.missingFields.length) console.log(`  missing: ${p.missingFields.join(", ")}`);
      for (const w of p.warnings) console.log(`  ! ${w}`);
    }
    console.log(`\nnot mentioned: ${draft.notMentioned.map((n) => n.id).join(", ")}`);
  })
  .catch((err) => {
    console.error("FAILED:", err.status ?? "", err.code ?? "", err.message, err.details ? JSON.stringify(err.details) : "");
    process.exit(1);
  });
