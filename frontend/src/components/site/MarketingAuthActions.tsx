"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChevronDown, LogOut } from "lucide-react";

import { useAuthStore } from "@/store/authStore";

interface MarketingAuthActionsProps {
  ctaMode?: "default" | "auth";
}

export default function MarketingAuthActions({ ctaMode = "default" }: MarketingAuthActionsProps) {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.authStatus);
  const me = useAuthStore((state) => state.me);
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
  const signOut = useAuthStore((state) => state.signOut);
  const currentWorkspace = me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id);
  const roleLabel = me?.current_role_name || currentWorkspace?.role_name || "成员";
  const userLabel = me?.user.display_name || me?.user.email || "已登录用户";

  useEffect(() => {
    if (authStatus === "idle") {
      void bootstrapAuth();
    }
  }, [authStatus, bootstrapAuth]);

  const loggedOutActions = ctaMode === "auth" ? (
    <div className="flex items-center gap-3">
      <Link href="/signin" prefetch className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
        登录
      </Link>
      <Link href="/signup" prefetch className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-slate-800">
        注册
      </Link>
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <Link href="/signin" prefetch className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
        登录
      </Link>
      <Link href="/signup" prefetch className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950">
        注册
      </Link>
    </div>
  );

  if (authStatus === "authenticated" && me) {
    return (
      <div className="flex items-center gap-3">
        <details className="group relative">
          <summary className="flex list-none items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-950">
            <span className="font-semibold text-slate-900">{roleLabel}</span>
            <ChevronDown size={16} className="text-slate-400 transition-transform group-open:rotate-180" />
          </summary>

          <div className="absolute right-0 top-[calc(100%+0.75rem)] w-64 overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.35)]">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">{userLabel}</p>
              <p className="mt-1">{roleLabel}</p>
              {currentWorkspace?.workspace_name ? <p className="mt-1 text-slate-500">{currentWorkspace.workspace_name}</p> : null}
            </div>

            <div className="mt-2 flex flex-col">
              <Link href="/studio" prefetch className="rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950">
                进入工作台
              </Link>
              <button
                type="button"
                onClick={() => {
                  // 中文注释：官网头部与 Studio 共用同一套登出逻辑，保证 sessionStorage 和 access token 一并清空。
                  void signOut().then(() => router.replace("/signin"));
                }}
                className="flex items-center gap-2 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut size={16} />
                退出登录
              </button>
            </div>
          </div>
        </details>
        <Link href="/studio" prefetch className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] hover:bg-secondary">
          进入工作台
        </Link>
      </div>
    );
  }

  if ((authStatus === "loading" || authStatus === "idle") && me) {
    // 中文注释：只有已经拿到本地用户快照时才显示占位态；未登录访客要直接看到登录/注册入口，而不是等待鉴权探测超时。
    return <div className="h-10 w-28 rounded-full bg-slate-100" />;
  }

  return loggedOutActions;
}
