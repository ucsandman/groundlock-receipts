import { digestJson } from "./canonicalize.js";
import type { SourceOfTruth } from "./types.js";

/** A stable content hash of the source of truth, used as the ruleset version in a receipt. */
export function hashSourceOfTruth(source: SourceOfTruth): string {
  return digestJson({
    requiredFacts: source.requiredFacts,
    allowedFacts: source.allowedFacts,
    forbiddenPatterns: source.forbiddenPatterns ?? [],
    extract: source.extract ?? {},
  });
}
