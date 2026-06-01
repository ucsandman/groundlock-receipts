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
 * Slot logic:
 *   - If the fact has a slot prefix, the prefix must appear in the text and
 *     the expected value (or a money-normalized variant) must follow it.
 *   - If no slot prefix, the value must appear verbatim anywhere in the text.
 *
 * Returns true when the fact is satisfied (or when the slot prefix is absent
 * from the message, meaning the claim domain is not invoked).
 */
function isRequiredFactSatisfied(text: string, fact: RequiredFact): boolean {
  const canonValue = canonicalizeText(fact.value);
  const canonPrefix = canonicalizeText(fact.slot?.prefix ?? "");
  const canonSuffix = canonicalizeText(fact.slot?.suffix ?? "");
  const exact = canonPrefix + canonValue + canonSuffix;

  if (!fact.slot?.prefix && !fact.slot?.suffix) {
    // No slot: verbatim presence required.
    return text.includes(exact);
  }

  // Slotted fact: only enforced when the prefix is present in the text.
  if (canonPrefix && !text.includes(canonPrefix)) {
    return true; // prefix not in text => claim domain not invoked => satisfied
  }

  // Exact verbatim check first.
  if (text.includes(exact)) return true;

  // Normalized money fallback: if the expected value looks like a money amount,
  // accept any formatting variant that normalizes to the same numeric value.
  const moneyNorm = normalizeMoney(fact.value);
  // normalizeMoney returns a bare number; the source value has a "$" prefix.
  if (moneyNorm !== fact.value.trim()) {
    // It was a money value. Look for prefix then any money token normalizing the same.
    const prefixIdx = text.indexOf(canonPrefix);
    if (prefixIdx !== -1) {
      const afterPrefix = text.slice(prefixIdx + canonPrefix.length);
      const firstMoney = extractMoney(afterPrefix)[0];
      if (firstMoney && firstMoney.normalized === moneyNorm) return true;
    }
  }

  return false;
}

/**
 * Whether the text invokes at least one slotted-fact claim domain
 * (i.e., contains at least one slot prefix from the required facts).
 * Used to gate enforcement of un-slotted required facts.
 */
function anySlotPrefixPresent(text: string, facts: RequiredFact[]): boolean {
  return facts.some((f) => {
    const p = canonicalizeText(f.slot?.prefix ?? "");
    return p.length > 0 && text.includes(p);
  });
}

export function verify(candidate: string, source: SourceOfTruth): VerifyResult {
  try {
    const violations: Violation[] = [];
    const text = canonicalizeText(candidate);

    // 1. Required facts: each must appear verbatim (with slot prefix guard to prevent role swaps).
    //    Un-slotted required facts are only enforced when the message invokes the claim domain
    //    (i.e., when at least one slotted-fact prefix appears in the message); this avoids
    //    false positives for messages that are simply off-topic.
    const domainInvoked = anySlotPrefixPresent(text, source.requiredFacts);
    for (const f of source.requiredFacts) {
      if (f.value.trim() === "") continue;
      const hasSlot = Boolean(f.slot?.prefix || f.slot?.suffix);
      // Non-slotted facts are only enforced when the claim domain is invoked.
      if (!hasSlot && !domainInvoked) continue;
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
      for (const match of extractPattern(text, rp.pattern)) {
        if (!corpus.includes(canonicalizeText(match))) {
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
