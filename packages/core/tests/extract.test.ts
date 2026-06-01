import { describe, it, expect } from "vitest";
import {
  extractMoney,
  extractDates,
  extractPercentages,
  normalizeMoney,
  normalizeDate,
} from "../src/extract";

describe("money", () => {
  it("extracts currency amounts and normalizes formatting variants equally", () => {
    expect(extractMoney("Balance is $1,500.00 due.").map((m) => m.normalized)).toEqual(["1500"]);
    expect(normalizeMoney("$1,500.00")).toBe(normalizeMoney("$1500"));
    expect(normalizeMoney("$1,500.50")).toBe("1500.5");
  });
});

describe("dates", () => {
  it("normalizes common formats to ISO", () => {
    expect(normalizeDate("June 1, 2026")).toBe("2026-06-01");
    expect(normalizeDate("2026-06-01")).toBe("2026-06-01");
    expect(normalizeDate("6/1/2026")).toBe("2026-06-01");
  });

  it("extracts a date from text", () => {
    expect(extractDates("Due by June 1, 2026.").map((d) => d.normalized)).toEqual(["2026-06-01"]);
  });
});

describe("percentages", () => {
  it("extracts and normalizes percentages", () => {
    expect(extractPercentages("A 7.5% fee applies").map((p) => p.normalized)).toEqual(["7.5"]);
  });
});
