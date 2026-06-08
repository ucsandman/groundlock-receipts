import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

const title = "GroundLock Receipts";
const description = "Signed AI-message receipts stored in DNS resolver caches.";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s | GroundLock Receipts",
  },
  description,
  applicationName: title,
  openGraph: {
    title,
    description,
    siteName: title,
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f3f7ec",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
