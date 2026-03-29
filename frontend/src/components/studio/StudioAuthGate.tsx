"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";

import { useAuthStore } from "@/store/authStore";

const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function StudioAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const authStatus = useAuthStore((state) => state.authStatus);
  const me = useAuthStore((state) => state.me);
  const restoreSnapshot = useAuthStore((state) => state.restoreSnapshot);
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);

  useClientLayoutEffect(() => {
    restoreSnapshot();
  }, [restoreSnapshot]);

  useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  useEffect(() => {
    if (authStatus === "anonymous") {
      router.replace(`/signin?next=${encodeURIComponent(pathname)}`);
    }
  }, [authStatus, pathname, router]);

  if ((authStatus === "idle" || authStatus === "loading") && !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-6">
        <div className="studio-panel w-full max-w-md p-8 text-center">
          <p className="text-sm font-semibold text-primary">正在恢复工作台登录状态</p>
          <p className="mt-3 text-sm leading-7 text-slate-600">我们正在读取你的工作区与角色信息，请稍候。</p>
        </div>
      </div>
    );
  }

  if (authStatus === "authenticated" && me && !me.current_workspace_id && me.workspaces.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-6">
        <div className="studio-panel w-full max-w-lg p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Workspace</p>
          <h1 className="mt-4 text-3xl font-bold text-slate-950">当前账号还没有可用工作区</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            这通常表示账号尚未完成初始化，或正在等待企业管理员邀请加入工作区。
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
