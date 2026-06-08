#!/usr/bin/env node

const REQUIRED_HEADER_VALUES = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "connect-src 'self'",
    "upgrade-insecure-requests",
  ],
  "x-content-type-options": ["nosniff"],
  "x-frame-options": ["DENY"],
  "referrer-policy": ["strict-origin-when-cross-origin"],
  "strict-transport-security": ["max-age=31536000"],
  "cross-origin-opener-policy": ["same-origin"],
  "x-dns-prefetch-control": ["off"],
  "x-permitted-cross-domain-policies": ["none"],
  "permissions-policy": ["camera=()", "microphone=()", "geolocation=()", "payment=()"],
};

const FORBIDDEN_CSP_VALUES = ["'unsafe-eval'", "localhost", "127.0.0.1"];

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
