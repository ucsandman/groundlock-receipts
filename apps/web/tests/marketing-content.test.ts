import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("marketing copy", () => {
  it("leads with DNS resolver-cache storage as the core concept", () => {
    const page = readFileSync(join(root, "app", "page.tsx"), "utf8");
    const sections = readFileSync(join(root, "components", "MarketingSections.tsx"), "utf8");
    const combined = `${page}\n${sections}`;

    expect(combined).toContain("DNS resolver caches are the medium");
    expect(combined).toContain("TXT chunk map");
    expect(combined).toContain("Warm configured resolvers");
    expect(combined).toContain("Public proof should not depend on a vendor dashboard");
  });
});
