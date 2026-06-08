import { canonicalizeText } from "./canonicalize.js";
import { verify } from "./verify.js";
import type { SourceOfTruth, VerifyResult } from "./types.js";

export interface Refiner {
  refine(draft: string): Promise<string>;
}

export const echoRefiner: Refiner = {
  async refine(draft: string): Promise<string> {
    return draft;
  },
};

export interface GuaranteeOptions {
  build: () => string;
  source: SourceOfTruth;
  refiner?: Refiner;
}

export interface GuaranteeResult {
  text: string;
  source: "model" | "deterministic";
  result: VerifyResult;
}

export async function guarantee(opts: GuaranteeOptions): Promise<GuaranteeResult> {
  const draft = canonicalizeText(opts.build());
  if (!opts.refiner) {
    return { text: draft, source: "deterministic", result: verify(draft, opts.source) };
  }
  try {
    const refined = canonicalizeText(await opts.refiner.refine(draft));
    const result = verify(refined, opts.source);
    if (result.verdict === "pass") return { text: refined, source: "model", result };
  } catch {
    // fall through to deterministic
  }
  return { text: draft, source: "deterministic", result: verify(draft, opts.source) };
}
