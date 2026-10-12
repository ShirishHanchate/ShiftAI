/**
 * LIVE integration check of the agent against Sarvam (requires SARVAM_API_KEY; no database).
 * Uses the fictional seed incidents as the data source.   npm run live:agent -- "question"
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { askAgent } from "../src/lib/agent";
import { buildSeedIncidents } from "../src/data/seed-incidents";

const questions = process.argv.slice(2).length
  ? [process.argv.slice(2).join(" ")]
  : ["What should I prioritize at the start of my shift?", "What is pending on INC-1042?", "What is the status of INC-9999?", "Close INC-1043 for me."];

const data = { incidents: buildSeedIncidents(), handovers: [], auditFor: async () => [] };

(async () => {
  for (const q of questions) {
    const t = Date.now();
    try {
      const r = await askAgent(q, [], Date.now(), data);
      console.log(`\nQ: ${q}  (${((Date.now() - t) / 1000).toFixed(1)}s)\nA: ${r.answer}`);
      console.log(`   refs=${r.incidentIds.join(",") || "-"} unknown=${r.unknownIncidentIds.join(",") || "-"}`);
      if (r.missingInformation.length) console.log(`   missing: ${r.missingInformation.join(" | ")}`);
      if (r.recommendations.length) console.log(`   recs: ${r.recommendations.join(" | ")}`);
      if (r.warnings.length) console.log(`   warnings: ${r.warnings.join(" | ")}`);
    } catch (err) {
      const e = err as { status?: number; code?: string; message: string };
      console.error(`\nQ: ${q}\nFAILED: ${e.status ?? ""} ${e.code ?? ""} ${e.message}`);
      process.exitCode = 1;
    }
  }
})();
