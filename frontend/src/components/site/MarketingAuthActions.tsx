"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useAuthStore } from "@/store/authStore";

interface MarketingAuthActionsProps {
  ctaMode?: "default" | "auth";
}

export default function MarketingAuthActions({ ctaMode = "default" }: MarketingAuthActionsProps) {
  const authStatus = useAuthStore((state) => state.authStatus);
  const me = useAuthStore((state) => state.me);
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
  const currentWorkspace = me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id);

  useEffect(() => {
    if (authStatus === "idle") {
      void bootstrapAuth();
    }
  }, [authStatus, bootstrapAuth]);

  if (authStatus === "authenticated" && me) {
    return (
      <div className="flex items-center gap-3">
        <div className="hidden rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 md:block">
          <span className="font-semibold text-slate-900">{me.user.display_name || me.user.email || "已登录用户"}</span>
          {currentWorkspace?.workspace_name ? <span className="ml-2 text-slate-400">· {currentWorkspace.workspace_name}</span> : null}
        </div>
        <Link href="/studio" prefetch className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-secondary">
          进入工作台
        </Link>
      </div>
    );
  }

  if (authStatus === "loading" || authStatus === "idle") {
    return <div className="h-10 w-28 rounded-full bg-slate-100" />;
  }

  if (ctaMode === "auth") {
    return (
      <div className="flex items-center gap-3">
        <Link href="/signin" prefetch className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
          登录
        </Link>
        <Link href="/signup" prefetch className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-slate-800">
          注册
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link href="/signin" prefetch className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
        登录
      </Link>
      <Link href="/signup" prefetch className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950">
        注册
      </Link>
    </div>
  );
}
