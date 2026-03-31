import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import DramaLabBranding from "@/components/layout/DramaLabBranding";
import MarketingAuthActions from "@/components/site/MarketingAuthActions";
import MarketingAuthDialog from "@/components/site/MarketingAuthDialog";

interface MarketingShellProps {
  children: ReactNode;
  ctaMode?: "default" | "auth";
  theme?: "light" | "dark";
}

export default function MarketingShell({ children, ctaMode = "default", theme = "light" }: MarketingShellProps) {
  const isDark = theme === "dark";

  return (
    <div className={`min-h-screen ${isDark ? "bg-[#020409] text-white" : "bg-transparent text-slate-900"}`}>
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-xl ${
          isDark
            ? "border-white/10 bg-[rgba(5,7,11,0.62)]"
            : "border-slate-200/80 bg-white/85"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
          <Link href="/" className="w-[210px]">
            <DramaLabBranding size="sm" showSlogan={false} tone={isDark ? "light" : "dark"} />
          </Link>
          {/* 中文注释：营销鉴权按钮依赖 URL 查询参数，静态构建时需要 Suspense 边界承接。 */}
          <Suspense fallback={<div className={`h-10 w-[136px] rounded-full ${isDark ? "bg-white/8" : "bg-slate-100"}`} />}>
            <MarketingAuthActions ctaMode={ctaMode} theme={theme} />
          </Suspense>
        </div>
      </header>

      <main>{children}</main>

      <footer className={`border-t ${isDark ? "border-white/10 bg-[#040810]/80" : "border-slate-200/80 bg-white/80"}`}>
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-12 lg:flex-row lg:items-end lg:justify-between lg:px-10">
          <div className="max-w-xl">
            <p className={`text-sm font-semibold uppercase tracking-[0.24em] ${isDark ? "text-cyan-300/80" : "text-primary"}`}>DramaLab</p>
            <h2 className={`mt-3 font-display text-3xl ${isDark ? "text-white" : "text-slate-950"}`}>A production system for short-form narrative teams.</h2>
            <p className={`mt-3 text-sm leading-6 ${isDark ? "text-white/60" : "text-slate-600"}`}>
              Standardize script breakdown, reusable assets, render orchestration, and delivery inside one editorial control room.
            </p>
          </div>
          <p className={`max-w-sm text-sm leading-6 ${isDark ? "text-white/45" : "text-slate-500"}`}>
            Fixed stage in the background. Scrolling notes in the foreground. Less noise, more narrative.
          </p>
        </div>
      </footer>

      {/* 中文注释：登录注册弹窗同样读取营销页查询参数，这里与顶部按钮一起补齐 Suspense。 */}
      <Suspense fallback={null}>
        <MarketingAuthDialog />
      </Suspense>
    </div>
  );
}
