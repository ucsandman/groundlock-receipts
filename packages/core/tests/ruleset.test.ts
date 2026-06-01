import { describe, it, expect } from "vitest";
import { hashSourceOfTruth } from "../src/ruleset";
import type { SourceOfTruth } from "../src/types";

const src: SourceOfTruth = {
  requiredFacts: [{ label: "a", value: "x" }],
  allowedFacts: [{ label: "a", value: "x" }],
};

describe("hashSourceOfTruth", () => {
  it("is stable and sha256-framed", () => {
    expect(hashSourceOfTruth(src)).toBe(hashSourceOfTruth(src));
    expect(hashSourceOfTruth(src)).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
  });

  it("changes when an allowed fact changes", () => {
    const other: SourceOfTruth = { ...src, allowedFacts: [{ label: "a", value: "y" }] };
    expect(hashSourceOfTruth(other)).not.toBe(hashSourceOfTruth(src));
  });
});
