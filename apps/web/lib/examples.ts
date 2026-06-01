import type { SourceOfTruth } from "@groundlock/core";

export const exampleSource: SourceOfTruth = {
  requiredFacts: [
    { label: "account holder", value: "Jane Roe" },
    { label: "balance", value: "$1,500.00", slot: { prefix: "balance of " } },
    { label: "account number", value: "AC-40192" },
  ],
  allowedFacts: [
    { label: "account holder", value: "Jane Roe" },
    { label: "balance", value: "$1,500.00" },
    { label: "due date", value: "June 1, 2026" },
    { label: "account number", value: "AC-40192" },
  ],
  forbiddenPatterns: [{ label: "invented citation", pattern: "\\u00A7|\\bsection\\s+\\d" }],
  extract: { money: true, dates: true, percentages: true, patterns: [{ label: "account number", pattern: "AC-\\d{5}" }] },
};

export const cleanCandidate =
  "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00, due by June 1, 2026. Thank you.";

export const fabricatingCandidate =
  "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00, plus a $250.00 late fee, due by July 15, 2026. Per section 12 you must pay.";
