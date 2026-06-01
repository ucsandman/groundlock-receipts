import { describe, it, expect } from "vitest";
import { verify, DEFAULT_CITATION_SIGNAL } from "../src/verify";
import type { SourceOfTruth } from "../src/types";

function baseSource(): SourceOfTruth {
  return {
    requiredFacts: [
      { label: "deposit", value: "$1,500.00", slot: { prefix: "deposit was " } },
      { label: "withheld", value: "$2,000.00", slot: { prefix: "return " } },
      { label: "tenant", value: "Jane Roe" },
    ],
    allowedFacts: [
      { label: "deposit", value: "$1,500.00" },
      { label: "withheld", value: "$2,000.00" },
      { label: "dueDate", value: "June 1, 2026" },
    ],
    forbiddenPatterns: [{ label: "citation", pattern: DEFAULT_CITATION_SIGNAL }],
    extract: { money: true, dates: true, percentages: true },
  };
}

const cleanMessage =
  "My security deposit was $1,500.00. Please return $2,000.00 to Jane Roe by June 1, 2026.";

describe("required-fact check", () => {
  it("passes a clean, fully grounded message", () => {
    expect(verify(cleanMessage, baseSource()).verdict).toBe("pass");
  });

  it("blocks when a required value is altered", () => {
    const msg = cleanMessage.replace("Jane Roe", "John Doe");
    const r = verify(msg, baseSource());
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "missing_required" && v.label === "tenant")).toBe(true);
  });

  it("blocks when the two amounts are swapped into each other's role (slot guard)", () => {
    const msg = "My security deposit was $2,000.00. Please return $1,500.00 to Jane Roe by June 1, 2026.";
    expect(verify(msg, baseSource()).verdict).toBe("block");
  });

  it("blocks when a required fact is omitted entirely (no silent omission)", () => {
    const r = verify("Hello, please get in touch at your convenience.", baseSource());
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "missing_required")).toBe(true);
  });
});

describe("positive-entailment check", () => {
  it("blocks a fabricated money amount not in allowedFacts", () => {
    const msg = cleanMessage + " A $99.00 late fee was added.";
    const r = verify(msg, baseSource());
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "fabricated_fact")).toBe(true);
  });

  it("accepts a formatting variant of an allowed amount", () => {
    const msg = "My security deposit was $1,500.00. Please return $2000 to Jane Roe by June 1, 2026.";
    // $2000 normalizes to the same value as the allowed $2,000.00
    expect(verify(msg, baseSource()).verdict).toBe("pass");
  });

  it("blocks a fabricated date", () => {
    const msg = cleanMessage.replace("June 1, 2026", "July 9, 2026");
    expect(verify(msg, baseSource()).verdict).toBe("block");
  });

  it("blocks a registered-pattern token that only collides as a substring of a fact", () => {
    const src: SourceOfTruth = {
      requiredFacts: [],
      allowedFacts: [{ label: "invoice", value: "Invoice 10012" }],
      forbiddenPatterns: [],
      extract: { money: false, dates: false, percentages: false, patterns: [{ label: "code", pattern: "\\d{4}" }] },
    };
    // "0012" is a substring of the allowed "10012" but is not a legitimate 4-digit token of it.
    expect(verify("Your code is 0012.", src).verdict).toBe("block");
    // The legitimately-present token passes.
    expect(verify("Invoice 10012 is enclosed.", src).verdict).toBe("pass");
  });
});

describe("forbidden-pattern check", () => {
  it("blocks an invented statute citation", () => {
    const msg = cleanMessage + " Per Cal. Civ. Code section 1950.5 you must comply.";
    const r = verify(msg, baseSource());
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "forbidden_match")).toBe(true);
  });

  it("does not false-positive on word fragments", () => {
    const src: SourceOfTruth = {
      requiredFacts: [],
      allowedFacts: [],
      forbiddenPatterns: [{ label: "competitor", pattern: "Cooper" }],
    };
    const msg = "We met in Coopersville near Freedom Field.";
    expect(verify(msg, src).verdict).toBe("pass");
  });
});

describe("fail-closed", () => {
  it("blocks with engine_error on an invalid forbidden regex", () => {
    const src = baseSource();
    src.forbiddenPatterns = [{ label: "bad", pattern: "(" }];
    const r = verify(cleanMessage, src);
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "engine_error")).toBe(true);
  });
});
