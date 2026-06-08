import { canonicalizeText, digestText } from "./canonicalize.js";
import { extractMoney, extractDates, extractPercentages, extractPattern, normalizeMoney } from "./extract.js";
import type {
  AllowedFact,
  GroundedClaim,
  GroundedClaimKind,
  GroundingTrace,
  RequiredFact,
  SourceOfTruth,
  UngroundedClaim,
  Violation,
  VerifyResult,
} from "./types.js";

/** Heuristic signal that legal-citation language is present (adapted from letter-cannon). */
export const DEFAULT_CITATION_SIGNAL =
  "\\u00A7|\\bsection\\s+\\d|\\b(?:RCW|NRS|USC|U\\.S\\.C|ORC|Civ\\.\\s*Code|Stat\\.|Code\\s+(?:Ann|of))\\b";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundary(term: string, flags: string): RegExp {
  return new RegExp("\\b" + escapeRegExp(term) + "\\b", flags);
}

type Fact = AllowedFact | RequiredFact;
type ExtractedToken = { raw: string; normalized: string };
type ExtractTokens = (text: string) => ExtractedToken[];

interface IndexedFact {
  label: string;
  value: string;
}

function allTraceFacts(source: SourceOfTruth): Fact[] {
  return [...source.allowedFacts, ...source.requiredFacts];
}

function firstFactByToken(facts: Fact[], extract: ExtractTokens): Map<string, IndexedFact> {
  const out = new Map<string, IndexedFact>();
  for (const fact of facts) {
    for (const token of extract(canonicalizeText(fact.value))) {
      if (!out.has(token.normalized)) {
        out.set(token.normalized, { label: fact.label, value: fact.value });
      }
    }
  }
  return out;
}

function toGroundedClaim(kind: GroundedClaimKind, token: ExtractedToken, fact: IndexedFact): GroundedClaim {
  return {
    kind,
    token: token.raw,
    normalized: token.normalized,
    sourceLabel: fact.label,
    sourceValue: fact.value,
    sourceValueHash: digestText(fact.value),
  };
}

function toUngroundedClaim(
  kind: GroundedClaimKind,
  label: string,
  token: ExtractedToken,
): UngroundedClaim {
  return {
    kind,
    label,
    token: token.raw,
    normalized: token.normalized,
  };
}

function traceKind(
  text: string,
  kind: GroundedClaimKind,
  label: string,
  facts: Fact[],
  extract: ExtractTokens,
): GroundingTrace {
  const allowed = firstFactByToken(facts, extract);
  const groundedClaims: GroundedClaim[] = [];
  const ungrounded: UngroundedClaim[] = [];
  for (const token of extract(text)) {
    const fact = allowed.get(token.normalized);
    if (fact) {
      groundedClaims.push(toGroundedClaim(kind, token, fact));
    } else {
      ungrounded.push(toUngroundedClaim(kind, label, token));
    }
  }
  return { groundedClaims, ungrounded };
}

function mergeTrace(into: GroundingTrace, from: GroundingTrace): void {
  into.groundedClaims.push(...from.groundedClaims);
  into.ungrounded.push(...from.ungrounded);
}

export function traceGrounding(candidate: string, source: SourceOfTruth): GroundingTrace {
  const text = canonicalizeText(candidate);
  const facts = allTraceFacts(source);
  const ext = source.extract ?? { money: true, dates: true, percentages: true };
  const trace: GroundingTrace = { groundedClaims: [], ungrounded: [] };

  if (ext.money !== false) {
    mergeTrace(trace, traceKind(text, "money", "money", facts, extractMoney));
  }
  if (ext.dates !== false) {
    mergeTrace(trace, traceKind(text, "date", "date", facts, extractDates));
  }
  if (ext.percentages !== false) {
    mergeTrace(trace, traceKind(text, "percentage", "percentage", facts, extractPercentages));
  }
  for (const rp of ext.patterns ?? []) {
    const extractRegisteredPattern = (value: string): ExtractedToken[] =>
      extractPattern(value, rp.pattern).map((raw) => ({
        raw,
        normalized: canonicalizeText(raw),
      }));
    mergeTrace(trace, traceKind(text, "pattern", rp.label, facts, extractRegisteredPattern));
  }

  return trace;
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
    for (const claim of traceGrounding(text, source).ungrounded) {
      violations.push({ code: "fabricated_fact", label: claim.label, detail: claim.token });
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
