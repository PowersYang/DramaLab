import Link from "next/link";

import MarketingShell from "@/components/site/MarketingShell";

export default function SignInPage() {
  return (
    <MarketingShell>
      <section className="mx-auto flex min-h-[70vh] max-w-7xl items-center px-6 py-16 lg:px-10">
        <div className="studio-panel mx-auto w-full max-w-xl p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">登录入口</p>
          <h1 className="mt-4 text-4xl font-bold text-slate-950">登录页面占位</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            当前版本以工作台结构重设计为主，认证体系后续再接入。你可以先直接进入工作台体验新的商业化页面框架。
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/studio" className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
              直接进入工作台
            </Link>
            <Link href="/" className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700">
              返回官网
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
