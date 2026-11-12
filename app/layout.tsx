/**
 * PURPOSE
 * Root layout for every page: the top navigation bar (brand, Inbox, Agent quality) and a clear
 * "PayPal Sandbox" badge so nobody mistakes the demo for a live-money system.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "DisputeGuard",
  description: "AI dispute agent for PayPal merchants: investigates, recommends, and acts only after you approve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden />
              DisputeGuard
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">Inbox</Link>
              <Link href="/quality" className="hover:text-slate-900">Agent quality</Link>
              <Link href="/audit" className="hover:text-slate-900">Audit log</Link>
            </nav>
            <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              PayPal Sandbox
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
