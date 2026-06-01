import { describe, it, expect } from "vitest";
import {
  canonicalizeText,
  canonicalizeJson,
  sha256,
  digestText,
  digestJson,
} from "../src/canonicalize";

describe("canonicalizeText", () => {
  it("is idempotent", () => {
    const s = "Smart \u201cquotes\u201d and an em\u2014dash.";
    expect(canonicalizeText(canonicalizeText(s))).toBe(canonicalizeText(s));
  });

  it("normalizes smart quotes, dashes, and ellipsis to ASCII", () => {
    const out = canonicalizeText("\u201cHi\u201d \u2014 wait\u2026 it\u2019s fine");
    expect(out).toBe('"Hi" - wait... it\'s fine');
  });

  it("preserves a hyphen between digits", () => {
    expect(canonicalizeText("92.103-92.109")).toBe("92.103-92.109");
  });

  it("treats NFC and decomposed Unicode as equal", () => {
    const precomposed = "caf\u00e9";
    const decomposed = "cafe\u0301";
    expect(canonicalizeText(precomposed)).toBe(canonicalizeText(decomposed));
  });
});

describe("canonicalizeJson", () => {
  it("is independent of object key order", () => {
    expect(canonicalizeJson({ a: 1, b: 2 })).toBe(canonicalizeJson({ b: 2, a: 1 }));
  });

  it("omits undefined object values and emits no whitespace", () => {
    expect(canonicalizeJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("sha256 / digests", () => {
  it("matches the canonical SHA-256 empty-string vector (base64url framed)", () => {
    const emptyHex =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(sha256("")).toBe("sha256:" + Buffer.from(emptyHex, "hex").toString("base64url"));
  });

  it("matches the canonical SHA-256 'abc' vector", () => {
    const abcHex =
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256("abc")).toBe("sha256:" + Buffer.from(abcHex, "hex").toString("base64url"));
  });

  it("digestText and digestJson are stable across calls", () => {
    expect(digestText("hello")).toBe(digestText("hello"));
    expect(digestJson({ x: 1 })).toBe(digestJson({ x: 1 }));
  });
});
