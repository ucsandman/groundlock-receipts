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
  console.error("Usage: node scripts/smoke_web_response.mjs <base-url>");
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

async function smoke(baseUrl) {
  const paths = ["/", "/api/health"];
  for (const path of paths) {
    const url = endpoint(baseUrl, path);
    const { response, text } = await fetchText(url);
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    validateSecurityHeaders(response, path);

    if (path === "/api/health") {
      if ((response.headers.get("cache-control") ?? "") !== "no-store") {
        throw new Error("/api/health missing Cache-Control: no-store");
      }
      const body = JSON.parse(text);
      if (body?.service !== "groundlock-web" || body?.ok !== true) {
        throw new Error("/api/health did not return a live health JSON shape");
      }
    }
  }
}

const baseUrl = normalizeBaseUrl(process.argv[2]);
if (!baseUrl) {
  usage();
  process.exit(2);
}

smoke(baseUrl)
  .then(() => {
    console.log(`PASS web response smoke ${baseUrl.origin}${baseUrl.pathname}`);
  })
  .catch((error) => {
    console.error(`FAIL web response smoke: ${error.message}`);
    process.exit(1);
  });
