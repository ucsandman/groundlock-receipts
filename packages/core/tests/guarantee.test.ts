import { describe, it, expect } from "vitest";
import { guarantee, echoRefiner } from "../src/guarantee";
import type { SourceOfTruth } from "../src/types";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "tenant", value: "Jane Roe" }],
  extract: { money: false, dates: false, percentages: false },
};

describe("guarantee", () => {
  it("returns the deterministic draft when no refiner is given", async () => {
    const out = await guarantee({ build: () => "Dear Jane Roe.", source });
    expect(out.source).toBe("deterministic");
    expect(out.result.verdict).toBe("pass");
  });

  it("ships model text only when it still verifies", async () => {
    const ok = await guarantee({ build: () => "Dear Jane Roe.", refiner: echoRefiner, source });
    expect(ok.source).toBe("model");

    const badRefiner = { refine: async () => "Dear John Doe." };
    const fallback = await guarantee({ build: () => "Dear Jane Roe.", refiner: badRefiner, source });
    expect(fallback.source).toBe("deterministic");
    expect(fallback.text).toContain("Jane Roe");
  });
});
