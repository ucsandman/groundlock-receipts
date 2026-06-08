import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "GroundLock Receipts",
  description: "Signed AI-message receipts stored in DNS resolver caches.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
