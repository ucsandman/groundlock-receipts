const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

function isLaunchHttpsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    isDnsHostname(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

function isDnsHostname(hostname: string): boolean {
  const host = hostname.trim().replace(/\.$/, "").toLowerCase();
  if (!host || host.length > 253 || !host.includes(".")) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":") || host.includes("[")) {
    return false;
  }
  return host.split(".").every((label) => DNS_LABEL_RE.test(label));
}
