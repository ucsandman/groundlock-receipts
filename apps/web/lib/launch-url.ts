const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_HOSTS = new Set(["example.com", "example.net", "example.org", "localhost"]);
const RESERVED_SUFFIXES = [".example", ".example.com", ".example.net", ".example.org", ".invalid", ".localhost", ".test"];

export function configuredLaunchHttpsUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return isLaunchHttpsUrl(url) ? raw : null;
  } catch {
    return null;
  }
}

export function configuredLaunchDomain(value: string | null | undefined): string | null {
  const raw = value?.trim().replace(/\.$/, "").toLowerCase();
  if (!raw) return null;
  return isDnsHostname(raw) ? raw : null;
}

function isLaunchHttpsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    isDnsHostname(url.hostname) &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

function isDnsHostname(hostname: string): boolean {
  const host = hostname.trim().replace(/\.$/, "").toLowerCase();
  if (!host || host.length > 253 || !host.includes(".")) return false;
  if (RESERVED_HOSTS.has(host) || RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return false;
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":") || host.includes("[")) {
    return false;
  }
  return host.split(".").every((label) => DNS_LABEL_RE.test(label));
}
