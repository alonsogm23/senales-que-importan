import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify } from "../public/policy.js";
// These labels describe software behavior, not clinical ground truth or validated accuracy.
export const cases = JSON.parse(
  readFileSync(new URL("../tests/ai-cases.json", import.meta.url), "utf8"),
);
export async function evaluateObserver(provider) {
  const results = [];
  for (const c of cases) {
    let observation;
    try {
      observation = provider
        ? await provider({ text: c.text, reason: c.reason })
        : null;
    } catch {
      observation = null;
    }
    results.push({
      id: c.id,
      rulePriority: classify(c.text, c.reason),
      illustrativeRulePriority: c.illustrativeRulePriority,
      observerStatus: provider
        ? observation
          ? "returned_unvalidated"
          : "failed"
        : "not_configured",
      suggestedReason: observation?.suggestedReason ?? null,
      suggestedPriority: observation?.suggestedPriority ?? null,
      requiresClinicalValidation: true,
    });
  }
  return { mode: "observation_only", clinicalAccuracyAssessed: false, results };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await evaluateObserver(), null, 2));
