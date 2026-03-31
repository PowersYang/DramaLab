"use client";

import { useEffect } from "react";
import { ChevronDown, LogOut } from "lucide-react";

import { useAuthStore } from "@/store/authStore";
import { useMarketingAuthStore } from "@/store/marketingAuthStore";

interface MarketingAuthActionsProps {
  ctaMode?: "default" | "auth";
  theme?: "light" | "dark";
}

export default function MarketingAuthActions({ ctaMode = "default", theme = "light" }: MarketingAuthActionsProps) {
  const authStatus = useAuthStore((state) => state.authStatus);
  const me = useAuthStore((state) => state.me);
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
  const signOut = useAuthStore((state) => state.signOut);
  const openAuthDialog = useMarketingAuthStore((state) => state.open);
  const currentWorkspace = me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id);
  const roleLabel = me?.current_role_name || currentWorkspace?.role_name || "成员";
  const userLabel = me?.user.display_name || me?.user.email || "已登录用户";
  const isDark = theme === "dark";

  useEffect(() => {
    if (authStatus === "idle") {
      void bootstrapAuth();
    }
  }, [authStatus, bootstrapAuth]);

  const loggedOutActions = ctaMode === "auth" ? (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => openAuthDialog("signin")}
        className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
          isDark ? "text-white/72 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        }`}
      >
        登录
      </button>
      <button
        type="button"
        onClick={() => openAuthDialog("signup")}
        className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.01] ${
          isDark ? "bg-white text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.08)]" : "bg-slate-950 text-white shadow-sm hover:bg-slate-800"
        }`}
      >
        注册
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => openAuthDialog("signin")}
        className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
          isDark ? "text-white/72 hover:bg-white/8 hover:text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        }`}
      >
        登录
      </button>
      <button
        type="button"
        onClick={() => openAuthDialog("signup")}
        className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
          isDark ? "border border-white/14 text-white hover:border-white/30 hover:bg-white/6" : "border border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-950"
        }`}
      >
        注册
      </button>
    </div>
  );

  if (authStatus === "authenticated" && me) {
    return (
      <div className="flex items-center gap-3">
        <details className="group relative">
          <summary
            className={`flex list-none items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-sm transition-colors ${
              isDark
                ? "border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-950"
            }`}
          >
            <span className={isDark ? "font-semibold text-white" : "font-semibold text-slate-900"}>{roleLabel}</span>
            <ChevronDown size={16} className={isDark ? "text-white/45 transition-transform group-open:rotate-180" : "text-slate-400 transition-transform group-open:rotate-180"} />
          </summary>

          <div className={`absolute right-0 top-[calc(100%+0.75rem)] w-64 overflow-hidden rounded-3xl border p-2 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.35)] ${
            isDark ? "border-white/10 bg-[#0b1120]" : "border-slate-200 bg-white"
          }`}>
            <div className={`rounded-2xl px-4 py-3 text-sm ${isDark ? "bg-white/5 text-white/65" : "bg-slate-50 text-slate-600"}`}>
              <p className={isDark ? "font-semibold text-white" : "font-semibold text-slate-900"}>{userLabel}</p>
              <p className="mt-1">{roleLabel}</p>
              {currentWorkspace?.workspace_name ? <p className={`mt-1 ${isDark ? "text-white/45" : "text-slate-500"}`}>{currentWorkspace.workspace_name}</p> : null}
            </div>

            <div className="mt-2 flex flex-col">
              <a href="/studio" className={`rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                isDark ? "text-white/80 hover:bg-white/5 hover:text-white" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
              }`}>
                进入工作台
              </a>
              <button
                type="button"
                onClick={() => {
                  void signOut().then(() => openAuthDialog("signin"));
                }}
                className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
                  isDark ? "text-white/72 hover:bg-rose-500/10 hover:text-rose-300" : "text-slate-700 hover:bg-rose-50 hover:text-rose-600"
                }`}
              >
                <LogOut size={16} />
                退出登录
              </button>
            </div>
          </div>
        </details>
        <a href="/studio" className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.01] ${
          isDark ? "bg-cyan-300 text-slate-950 shadow-[0_14px_36px_rgba(34,211,238,0.2)]" : "bg-primary text-white shadow-sm hover:bg-secondary"
        }`}>
          进入工作台
        </a>
      </div>
    );
  }

  if ((authStatus === "loading" || authStatus === "idle") && me) {
    return <div className={`h-10 w-28 rounded-full ${isDark ? "bg-white/8" : "bg-slate-100"}`} />;
  }

  return loggedOutActions;
}
