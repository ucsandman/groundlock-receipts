#!/usr/bin/env node

import { readFileSync } from "node:fs";

const contract = JSON.parse(
  readFileSync(
    new URL("../apps/web/lib/security-header-contract.json", import.meta.url),
    "utf8",
  ),
);

if (
  !contract ||
  typeof contract !== "object" ||
  !contract.requiredHeaderValues ||
  typeof contract.requiredHeaderValues !== "object" ||
  !Array.isArray(contract.forbiddenCspValues)
) {
  throw new Error("security header contract is malformed");
}

const REQUIRED_HEADER_VALUES = contract.requiredHeaderValues;
const FORBIDDEN_CSP_VALUES = contract.forbiddenCspValues;

for (const [headerName, expectedValues] of Object.entries(REQUIRED_HEADER_VALUES)) {
  if (
    typeof headerName !== "string" ||
    !Array.isArray(expectedValues) ||
    !expectedValues.every((value) => typeof value === "string" && value)
  ) {
    throw new Error("security header contract has malformed header values");
  }
}
if (
  !FORBIDDEN_CSP_VALUES.every((value) => typeof value === "string" && value)
) {
  throw new Error("security header contract has malformed forbidden values");
}

function usage() {
  console.error(
    [
      "Usage: node scripts/smoke_web_response.mjs <base-url> [options]",
      "",
      "Options:",
      "  --expect-live",
      "  --expected-origin <https-origin>",
      "  --status-key-lookup <lookup>",
      "  --status-claim-lookup <lookup>",
      "  --verify-file-text <text>",
      "  --verify-hash <sha256:...>",
      "  --expect-verify-state <PASS|BLOCK|REVOKED|UNVERIFIABLE>",
    ].join("\n"),
  );
}

function normalizeBaseUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function normalizeExpectedOrigin(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const [rawBaseUrl, ...rest] = argv;
  const options = {
    baseUrl: normalizeBaseUrl(rawBaseUrl),
    expectLive: false,
    expectedOrigin: null,
    statusKeyLookup: null,
    statusClaimLookup: null,
    verifyFileText: null,
    verifyHash: null,
    expectVerifyState: null,
  };
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === "--expect-live") {
      options.expectLive = true;
    } else if (token === "--expected-origin") {
      options.expectedOrigin = normalizeExpectedOrigin(rest[++i]);
      if (!options.expectedOrigin) throw new Error("--expected-origin must be a public HTTPS origin");
    } else if (token === "--status-key-lookup") {
      options.statusKeyLookup = rest[++i];
      if (!options.statusKeyLookup) throw new Error("--status-key-lookup requires a value");
    } else if (token === "--status-claim-lookup") {
      options.statusClaimLookup = rest[++i];
      if (!options.statusClaimLookup) throw new Error("--status-claim-lookup requires a value");
    } else if (token === "--verify-file-text") {
      options.verifyFileText = rest[++i];
      if (!options.verifyFileText) throw new Error("--verify-file-text requires a value");
    } else if (token === "--verify-hash") {
      options.verifyHash = rest[++i];
      if (!/^sha256:[A-Za-z0-9_-]{8,}$/.test(options.verifyHash)) {
        throw new Error("--verify-hash requires a sha256: hash");
      }
    } else if (token === "--expect-verify-state") {
      options.expectVerifyState = rest[++i];
      if (!["PASS", "BLOCK", "REVOKED", "UNVERIFIABLE"].includes(options.expectVerifyState)) {
        throw new Error("--expect-verify-state must be PASS, BLOCK, REVOKED, or UNVERIFIABLE");
      }
    } else {
      throw new Error(`unknown option ${token}`);
    }
  }
  if (options.verifyFileText && options.verifyHash) {
    throw new Error("use either --verify-file-text or --verify-hash, not both");
  }
  if (options.expectVerifyState && !options.verifyFileText && !options.verifyHash) {
    throw new Error("--expect-verify-state requires --verify-file-text or --verify-hash");
  }
  if ((options.verifyFileText || options.verifyHash) && !options.expectVerifyState) {
    options.expectVerifyState = "PASS";
  }
  return options;
}

function endpoint(baseUrl, path) {
  const url = new URL(baseUrl.toString());
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  return url;
}

function requireHeader(response, path, headerName) {
  const value = response.headers.get(headerName);
  if (!value) {
    throw new Error(`${path} missing ${headerName}`);
  }
  return value;
}

function validateSecurityHeaders(response, path) {
  for (const [headerName, expectedValues] of Object.entries(REQUIRED_HEADER_VALUES)) {
    const value = requireHeader(response, path, headerName);
    for (const expected of expectedValues) {
      if (!value.includes(expected)) {
        throw new Error(`${path} ${headerName} missing ${expected}`);
      }
    }
  }

  const csp = response.headers.get("content-security-policy") ?? "";
  for (const forbidden of FORBIDDEN_CSP_VALUES) {
    if (csp.includes(forbidden)) {
      throw new Error(`${path} Content-Security-Policy contains ${forbidden}`);
    }
  }
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  return { response, text };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return { response, text };
}

function validateHomepageMetadata(html, expectedOrigin) {
  if (!expectedOrigin) return;
  const expectedRoot = `${expectedOrigin}/`;
  const checks = [
    ["canonical", /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i],
    ["og:url", /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i],
    ["og:image", /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i],
    ["twitter:image", /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i],
  ];
  for (const [label, pattern] of checks) {
    const match = html.match(pattern);
    if (!match) throw new Error(`/ missing ${label} metadata`);
    const value = match[1] ?? "";
    if (label.endsWith("image")) {
      if (!value.startsWith(expectedRoot)) throw new Error(`/ ${label} does not use ${expectedRoot}`);
    } else if (value !== expectedRoot && value !== expectedOrigin) {
      throw new Error(`/ ${label} is ${value}, expected ${expectedRoot}`);
    }
  }
}

function validateDiscoveryText(robotsText, sitemapText, expectedOrigin) {
  if (!expectedOrigin) return;
  const expectedRoot = `${expectedOrigin}/`;
  const expectedSitemap = `${expectedOrigin}/sitemap.xml`;
  const robotsLines = new Set(
    robotsText
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith("#")),
  );
  const requiredRobotsLines = [
    "user-agent: *",
    "allow: /",
    "disallow: /api/",
    "disallow: /groundlock/status/",
    `sitemap: ${expectedSitemap}`.toLowerCase(),
  ];
  for (const line of requiredRobotsLines) {
    if (!robotsLines.has(line)) throw new Error(`/robots.txt missing ${line}`);
  }

  const locs = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) =>
    (match[1] ?? "").trim(),
  );
  for (const loc of [expectedRoot, `${expectedOrigin}/threat-model`]) {
    if (!locs.includes(loc)) throw new Error(`/sitemap.xml missing ${loc}`);
  }
  for (const loc of locs) {
    let parsed;
    try {
      parsed = new URL(loc);
    } catch {
      throw new Error(`/sitemap.xml has invalid URL ${loc}`);
    }
    if (parsed.origin !== expectedOrigin) {
      throw new Error(`/sitemap.xml loc is outside launch origin: ${loc}`);
    }
    if (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/groundlock/status/")) {
      throw new Error(`/sitemap.xml exposes non-public path: ${loc}`);
    }
  }
}

async function validateDiscoveryFiles(baseUrl, expectedOrigin) {
  if (!expectedOrigin) return;
  const robotsUrl = endpoint(baseUrl, "/robots.txt");
  const sitemapUrl = endpoint(baseUrl, "/sitemap.xml");
  const robots = await fetchText(robotsUrl);
  if (!robots.response.ok) throw new Error(`/robots.txt returned HTTP ${robots.response.status}`);
  validateSecurityHeaders(robots.response, "/robots.txt");
  const sitemap = await fetchText(sitemapUrl);
  if (!sitemap.response.ok) throw new Error(`/sitemap.xml returned HTTP ${sitemap.response.status}`);
  validateSecurityHeaders(sitemap.response, "/sitemap.xml");
  validateDiscoveryText(robots.text, sitemap.text, expectedOrigin);
}

function validateHealthBody(body, opts) {
  if (body?.service !== "groundlock-web" || body?.ok !== true) {
    throw new Error("/api/health did not return a live health JSON shape");
  }
  if (!opts.expectLive) return;
  if (body.mode !== "live") throw new Error(`/api/health mode is ${body.mode}, expected live`);
  const checks = body.checks ?? {};
  const requiredChecks = [
    "signerDomainConfigured",
    "siteUrlConfigured",
    "dohEndpointConfigured",
    "statusBaseUrlConfigured",
  ];
  if (opts.statusKeyLookup || opts.statusClaimLookup) {
    requiredChecks.push("statusRecordsConfigured");
  }
  for (const check of requiredChecks) {
    if (checks[check] !== true) throw new Error(`/api/health check ${check} was not true`);
  }
}

async function validateStatusEndpoint(baseUrl, kind, lookup) {
  if (!lookup) return;
  const keyMatch = lookup.match(/^key:([^:]+):([^:]+)$/);
  const claimMatch = lookup.match(/^claim:(sha256:[A-Za-z0-9_-]+)$/);
  if (kind === "key" && !keyMatch) throw new Error("--status-key-lookup must be key:<domain>:<kid>");
  if (kind === "claim" && !claimMatch) throw new Error("--status-claim-lookup must be claim:<sha256:...>");
  const url = endpoint(baseUrl, `/groundlock/status/${kind}`);
  url.searchParams.set("lookup", lookup);
  const { response, text } = await fetchText(url);
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}`);
  validateSecurityHeaders(response, url.pathname);
  if ((response.headers.get("cache-control") ?? "") !== "no-store") {
    throw new Error(`${url.pathname} missing Cache-Control: no-store`);
  }
  const body = JSON.parse(text);
  if (body?.version !== "groundlock-status/v1" || body?.kind !== kind || body?.status !== "active") {
    throw new Error(`${url.pathname} did not return an active ${kind} status record`);
  }
  if (kind === "key") {
    const [, signerDomain, kid] = keyMatch;
    if (body?.subject?.signerDomain !== signerDomain || body?.subject?.kid !== kid) {
      throw new Error(`${url.pathname} subject does not match ${lookup}`);
    }
  }
  if (kind === "claim" && body?.subject?.receiptHash !== claimMatch[1]) {
    throw new Error(`${url.pathname} subject does not match ${lookup}`);
  }
}

async function validateVerifyEndpoint(baseUrl, opts) {
  if (!opts.verifyFileText && !opts.verifyHash) return;
  const url = endpoint(baseUrl, "/api/verify");
  const payload = opts.verifyFileText ? { fileText: opts.verifyFileText } : { hash: opts.verifyHash };
  const { response, text } = await postJson(url, payload);
  validateSecurityHeaders(response, url.pathname);
  if ((response.headers.get("cache-control") ?? "") !== "no-store") {
    throw new Error(`${url.pathname} missing Cache-Control: no-store`);
  }
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}`);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url.pathname} returned invalid JSON`);
  }

  if (body?.state !== opts.expectVerifyState) {
    throw new Error(`${url.pathname} returned state ${body?.state}, expected ${opts.expectVerifyState}`);
  }
  if (opts.expectVerifyState === "PASS") {
    if (body.code !== "verified") throw new Error(`${url.pathname} PASS response code was ${body.code}`);
    if (body.receiptSummary?.verdict !== "pass") {
      throw new Error(`${url.pathname} PASS response did not include a pass receipt summary`);
    }
    if (opts.verifyHash && body.receiptSummary?.contentHash !== opts.verifyHash) {
      throw new Error(`${url.pathname} receiptSummary contentHash did not match verify hash`);
    }
  }
}

async function smoke(opts) {
  const baseUrl = opts.baseUrl;
  const paths = ["/", "/api/health"];
  for (const path of paths) {
    const url = endpoint(baseUrl, path);
    const { response, text } = await fetchText(url);
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    validateSecurityHeaders(response, path);

    if (path === "/") {
      validateHomepageMetadata(text, opts.expectedOrigin);
    }

    if (path === "/api/health") {
      if ((response.headers.get("cache-control") ?? "") !== "no-store") {
        throw new Error("/api/health missing Cache-Control: no-store");
      }
      validateHealthBody(JSON.parse(text), opts);
    }
  }
  await validateStatusEndpoint(baseUrl, "key", opts.statusKeyLookup);
  await validateStatusEndpoint(baseUrl, "claim", opts.statusClaimLookup);
  await validateDiscoveryFiles(baseUrl, opts.expectedOrigin);
  await validateVerifyEndpoint(baseUrl, opts);
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`FAIL web response smoke: ${error.message}`);
  usage();
  process.exit(2);
}

if (!opts.baseUrl) {
  usage();
  process.exit(2);
}

smoke(opts)
  .then(() => {
    console.log(`PASS web response smoke ${opts.baseUrl.origin}${opts.baseUrl.pathname}`);
  })
  .catch((error) => {
    console.error(`FAIL web response smoke: ${error.message}`);
    process.exit(1);
  });
