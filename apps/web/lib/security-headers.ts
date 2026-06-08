import securityHeaderContract from "./security-header-contract.json";

type SecurityHeaderName = keyof typeof securityHeaderContract.requiredHeaderValues;

function contractHeaderValue(name: SecurityHeaderName): string {
  const separator = name === "Permissions-Policy" ? ", " : "; ";
  return securityHeaderContract.requiredHeaderValues[name].join(separator);
}

export const PRODUCTION_CONTENT_SECURITY_POLICY = contractHeaderValue(
  "Content-Security-Policy",
);

const DEVELOPMENT_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

export const SECURITY_HEADERS = [
  {
    key: "X-Content-Type-Options",
    value: contractHeaderValue("X-Content-Type-Options"),
  },
  { key: "X-Frame-Options", value: contractHeaderValue("X-Frame-Options") },
  { key: "Referrer-Policy", value: contractHeaderValue("Referrer-Policy") },
  {
    key: "Strict-Transport-Security",
    value: contractHeaderValue("Strict-Transport-Security"),
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: contractHeaderValue("Cross-Origin-Opener-Policy"),
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: contractHeaderValue("X-DNS-Prefetch-Control"),
  },
  {
    key: "X-Permitted-Cross-Domain-Policies",
    value: contractHeaderValue("X-Permitted-Cross-Domain-Policies"),
  },
  {
    key: "Permissions-Policy",
    value: contractHeaderValue("Permissions-Policy"),
  },
  { key: "Content-Security-Policy", value: PRODUCTION_CONTENT_SECURITY_POLICY },
] as const;

export function securityHeadersForEnvironment(
  env = process.env.NODE_ENV,
): Array<{ key: string; value: string }> {
  if (env !== "development") return [...SECURITY_HEADERS];
  return SECURITY_HEADERS.map((header) =>
    header.key === "Content-Security-Policy"
      ? { key: header.key, value: DEVELOPMENT_CONTENT_SECURITY_POLICY }
      : { key: header.key, value: header.value },
  );
}
