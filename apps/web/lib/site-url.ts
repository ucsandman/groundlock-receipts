const DEFAULT_SITE_URL = "http://localhost:3000";

export function publicSiteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL;
  try {
    return new URL(new URL(raw).origin);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, publicSiteUrl()).toString();
}
