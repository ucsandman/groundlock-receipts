import type { Metadata, Viewport } from "next";
import { publicSiteUrl } from "./site-url";

const title = "GroundLock Receipts";
const description = "Signed AI-message receipts stored in DNS resolver caches.";
const ogImage = "/groundlock-receipt-desk.png";

export const metadata: Metadata = {
  metadataBase: publicSiteUrl(),
  title: {
    default: title,
    template: "%s | GroundLock Receipts",
  },
  description,
  applicationName: title,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description,
    siteName: title,
    type: "website",
    url: "/",
    images: [ogImage],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: [ogImage],
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f3f7ec",
};
