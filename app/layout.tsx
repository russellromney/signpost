import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, ShieldCheck, Signpost as SignpostIcon } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signpost",
  description: "Structured mail for delegated work: request → gate → session → release → receipt.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-foreground antialiased">
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <SignpostIcon className="size-5 text-primary" />
              Signpost
            </Link>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              request → gate → session → release → receipt
            </span>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Inbox className="size-4" />
                Inbox
              </Link>
              <Link
                href="/owner"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ShieldCheck className="size-4" />
                Owner console
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
