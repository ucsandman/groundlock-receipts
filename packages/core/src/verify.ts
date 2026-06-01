import { canonicalizeText } from "./canonicalize";
import { extractMoney, extractDates, extractPercentages, extractPattern, normalizeMoney } from "./extract";
import type { SourceOfTruth, Violation, VerifyResult, RequiredFact } from "./types";

/** Heuristic signal that legal-citation language is present (adapted from letter-cannon). */
export const DEFAULT_CITATION_SIGNAL =
  "\\u00A7|\\bsection\\s+\\d|\\b(?:RCW|NRS|USC|U\\.S\\.C|ORC|Civ\\.\\s*Code|Stat\\.|Code\\s+(?:Ann|of))\\b";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundary(term: string, flags: string): RegExp {
  return new RegExp("\\b" + escapeRegExp(term) + "\\b", flags);
}

/**
 * Check whether a required fact is satisfied by the candidate text.
 *
 * The fact (with its optional role-slot prefix/suffix) must appear verbatim.
 * For a slotted money fact, a formatting variant of the same amount in the
 * same role is accepted (e.g. "$2000" for "$2,000.00" after "return ").
 * Enforcement is unconditional: an absent required fact is a missing_required
 * violation (no silent omission), in line with the fail-closed guarantee.
 */
function isRequiredFactSatisfied(text: string, fact: RequiredFact): boolean {
  const canonValue = canonicalizeText(fact.value);
  const canonPrefix = canonicalizeText(fact.slot?.prefix ?? "");
  const canonSuffix = canonicalizeText(fact.slot?.suffix ?? "");
  const exact = canonPrefix + canonValue + canonSuffix;

  if (text.includes(exact)) return true;

  // Money-normalization fallback, only for slotted money facts: accept any
  // formatting variant of the same amount appearing in the same role-slot.
  if (canonPrefix) {
    const moneyNorm = normalizeMoney(fact.value);
    if (moneyNorm !== fact.value.trim()) {
      const prefixIdx = text.indexOf(canonPrefix);
      if (prefixIdx !== -1) {
        const afterPrefix = text.slice(prefixIdx + canonPrefix.length);
        const firstMoney = extractMoney(afterPrefix)[0];
        if (firstMoney && firstMoney.normalized === moneyNorm) return true;
      }
    }
  }

  return false;
}

export function verify(candidate: string, source: SourceOfTruth): VerifyResult {
  try {
    const violations: Violation[] = [];
    const text = canonicalizeText(candidate);

    // 1. Required facts: each must appear verbatim, with an optional role-slot
    //    (prefix/suffix) to prevent two same-typed values from swapping roles.
    //    Enforcement is unconditional: an absent required fact blocks.
    for (const f of source.requiredFacts) {
      if (f.value.trim() === "") continue;
      if (!isRequiredFactSatisfied(text, f)) {
        violations.push({ code: "missing_required", label: f.label });
      }
    }

    // 2. Forbidden patterns: must not match unless an allowed fact authorizes them.
    //    Bare-word patterns are matched with word boundaries so "Cooper" does not
    //    match inside "Coopersville"; patterns with regex metacharacters are used as-is.
    const allowedValues = source.allowedFacts.map((a) => canonicalizeText(a.value));
    for (const p of source.forbiddenPatterns ?? []) {
      const isBareWord = /^[\w\s]+$/.test(p.pattern);
      const make = () =>
        isBareWord ? wordBoundary(p.pattern, p.flags ?? "i") : new RegExp(p.pattern, p.flags ?? "i");
      const authorized = allowedValues.some((v) => make().test(v));
      if (make().test(text) && !authorized) {
        violations.push({ code: "forbidden_match", label: p.label });
      }
    }

    // 3. Positive entailment: every extracted operational token must trace to an allowed fact.
    const ext = source.extract ?? { money: true, dates: true, percentages: true };
    const corpus = canonicalizeText(
      [...source.allowedFacts, ...source.requiredFacts].map((f) => f.value).join("\n"),
    );

    if (ext.money !== false) {
      const allowed = new Set(extractMoney(corpus).map((m) => m.normalized));
      for (const m of extractMoney(text)) {
        if (!allowed.has(m.normalized)) {
          violations.push({ code: "fabricated_fact", label: "money", detail: m.raw });
        }
      }
    }
    if (ext.dates !== false) {
      const allowed = new Set(extractDates(corpus).map((d) => d.normalized));
      for (const d of extractDates(text)) {
        if (!allowed.has(d.normalized)) {
          violations.push({ code: "fabricated_fact", label: "date", detail: d.raw });
        }
      }
    }
    if (ext.percentages !== false) {
      const allowed = new Set(extractPercentages(corpus).map((p) => p.normalized));
      for (const p of extractPercentages(text)) {
        if (!allowed.has(p.normalized)) {
          violations.push({ code: "fabricated_fact", label: "percentage", detail: p.raw });
        }
      }
    }
    for (const rp of ext.patterns ?? []) {
      // Build the allowed set by extracting the same pattern from the corpus, so a
      // fabricated token cannot pass merely by being a substring of an unrelated fact.
      const allowed = new Set(extractPattern(corpus, rp.pattern).map((m) => canonicalizeText(m)));
      for (const match of extractPattern(text, rp.pattern)) {
        if (!allowed.has(canonicalizeText(match))) {
          violations.push({ code: "fabricated_fact", label: rp.label, detail: match });
        }
      }
    }

    return { verdict: violations.length === 0 ? "pass" : "block", violations };
  } catch (err) {
    // Fail-closed: any internal error blocks.
    return {
      verdict: "block",
      violations: [
        { code: "engine_error", label: "engine", detail: err instanceof Error ? err.message : "unknown" },
      ],
    };
  }
}
