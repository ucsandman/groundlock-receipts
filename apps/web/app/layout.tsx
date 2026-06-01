import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "GroundLock", description: "Non-fabrication guarantee for AI messages" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900">{children}</body>
    </html>
  );
}
