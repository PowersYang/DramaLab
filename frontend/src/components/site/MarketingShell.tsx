import Link from "next/link";
import type { ReactNode } from "react";

import LumenXBranding from "@/components/layout/LumenXBranding";

interface MarketingShellProps {
  children: ReactNode;
  ctaMode?: "default" | "auth";
}

const NAV_ITEMS = [
  { href: "/solutions", label: "解决方案" },
  { href: "/pricing", label: "套餐定价" },
  { href: "/studio", label: "工作台" },
];

export default function MarketingShell({ children, ctaMode = "default" }: MarketingShellProps) {
  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
          <Link href="/" className="w-[210px]">
            <LumenXBranding size="sm" showSlogan={false} />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="transition-colors hover:text-slate-950">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {ctaMode === "auth" ? (
              <>
                <Link href="/signin" className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
                  登录
                </Link>
                <Link href="/signup" className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-slate-800">
                  注册
                </Link>
              </>
            ) : (
              <>
                <Link href="/signin" className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
                  登录
                </Link>
                <Link href="/signup" className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950">
                  注册
                </Link>
                <Link href="/studio" className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-secondary">
                  进入工作台
                </Link>
              </>
            )}
          </div>
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
          <div className="flex gap-8 text-sm text-slate-500">
            <Link href="/solutions" className="hover:text-slate-900">解决方案</Link>
            <Link href="/pricing" className="hover:text-slate-900">套餐定价</Link>
            <Link href="/studio" className="hover:text-slate-900">工作台</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
