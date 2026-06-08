import { afterEach, describe, expect, it } from "vitest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { metadata } from "../lib/site-metadata";
import { absoluteUrl, publicSiteUrl } from "../lib/site-url";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe("site metadata", () => {
  it("uses an absolute public site URL when configured", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev/path";

    expect(publicSiteUrl().toString()).toBe("https://receipts.groundlock.dev/");
    expect(absoluteUrl("/threat-model")).toBe("https://receipts.groundlock.dev/threat-model");
  });

  it("configures sharing metadata with an Open Graph image", () => {
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(metadata.openGraph).toEqual(
      expect.objectContaining({
        title: "GroundLock Receipts",
        type: "website",
        url: "/",
        images: ["/groundlock-receipt-desk.png"],
      }),
    );
    expect(metadata.twitter).toEqual(
      expect.objectContaining({
        card: "summary",
        images: ["/groundlock-receipt-desk.png"],
      }),
    );
  });

  it("publishes robots and sitemap entries for the marketing site", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";

    expect(robots()).toEqual(
      expect.objectContaining({
        sitemap: "https://receipts.groundlock.dev/sitemap.xml",
      }),
    );
    expect(JSON.stringify(robots())).toContain("/api/");
    expect(JSON.stringify(robots())).toContain("/groundlock/status/");
    expect(sitemap()).toEqual([
      { url: "https://receipts.groundlock.dev/" },
      { url: "https://receipts.groundlock.dev/threat-model" },
    ]);
  });
});
