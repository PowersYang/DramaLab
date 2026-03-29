"use client";

import Link from "next/link";

import { useAuthStore } from "@/store/authStore";

export default function MarketingFooterLinks() {
  const authStatus = useAuthStore((state) => state.authStatus);

  return (
    <div className="flex gap-8 text-sm text-slate-500">
      <Link href="/solutions" prefetch className="hover:text-slate-900">解决方案</Link>
      <Link href="/pricing" prefetch className="hover:text-slate-900">套餐定价</Link>
      {authStatus === "authenticated" ? <Link href="/studio" prefetch className="hover:text-slate-900">工作台</Link> : null}
    </div>
  );
}
