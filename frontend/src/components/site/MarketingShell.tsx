import Link from "next/link";
import type { ReactNode } from "react";

import DramaLabBranding from "@/components/layout/DramaLabBranding";
import MarketingAuthActions from "@/components/site/MarketingAuthActions";
import MarketingFooterLinks from "@/components/site/MarketingFooterLinks";

interface MarketingShellProps {
  children: ReactNode;
  ctaMode?: "default" | "auth";
}

const NAV_ITEMS = [
  { href: "/solutions", label: "解决方案" },
  { href: "/pricing", label: "套餐定价" },
];

export default function MarketingShell({ children, ctaMode = "default" }: MarketingShellProps) {
  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
          <Link href="/" className="w-[210px]">
            <DramaLabBranding size="sm" showSlogan={false} />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} prefetch className="transition-colors hover:text-slate-950">
                {item.label}
              </Link>
            ))}
          </nav>
          <MarketingAuthActions ctaMode={ctaMode} />
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-slate-200/80 bg-white/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-12 lg:flex-row lg:items-end lg:justify-between lg:px-10">
          <div className="max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">DramaLab</p>
            <h2 className="mt-3 font-display text-3xl text-slate-950">A commercial-grade AI studio for short-form storytelling teams.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Standardize creative production, preserve reusable assets, and move from script to delivery in one system.
            </p>
          </div>
          <MarketingFooterLinks />
        </div>
      </footer>
    </div>
  );
}
