import { test } from "node:test";

test("extraction safety layer catches fabricated facts, invented IDs and ambiguous resolutions", async () => {
  // The script asserts internally and throws on any violation.
  await import("../scripts/check-extraction-safety");
});
