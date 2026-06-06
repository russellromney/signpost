import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signpost",
  description: "Structured mail for delegated work: request → gate → session → release → receipt.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Signpost
          </Link>
          <span className="tagline">request → gate → session → release → receipt</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
