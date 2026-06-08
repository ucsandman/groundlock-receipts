import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { generateSigningKey, type SourceOfTruth } from "@groundlock/core";
import { main } from "../src/cli.js";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "amount", value: "$2,000.00" }],
  extract: { money: true, dates: false, percentages: false },
};

afterEach(() => {
  vi.restoreAllMocks();
});

async function fixtureDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "groundlock-cli-main-"));
  const sourcePath = path.join(dir, "source.json");
  const blockedPath = path.join(dir, "blocked.txt");
  await writeFile(sourcePath, JSON.stringify(source), "utf8");
  await writeFile(blockedPath, "Dear Jane Roe, return $2,000.00 plus a $99.00 fee.", "utf8");
  return { dir, sourcePath, blockedPath };
}

describe("CLI entrypoint", () => {
  it("returns BLOCK exit semantics from the actual local-publish command", async () => {
    const { dir, sourcePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outDir = path.join(dir, "publish");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await main([
      "local-publish",
      blockedPath,
      "--source",
      sourcePath,
      "--domain",
      "publisher.example",
      "--kid",
      key.kid,
      "--key",
      JSON.stringify(key.privateKeyJwk),
      "--public-key",
      JSON.stringify(key.publicKeyJwk),
      "--out",
      outDir,
    ]);

    expect(code).toBe(2);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain("state BLOCK");
    expect(out).toContain("cache-manifest");
    expect(out).toContain("cache-chunk");
  });
});
