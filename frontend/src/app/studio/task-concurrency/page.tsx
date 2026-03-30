"use client";

import StudioTaskConcurrencyPage from "@/components/studio/StudioTaskConcurrencyPage";
import { useAuthStore } from "@/store/authStore";

export default function StudioTaskConcurrencyRoutePage() {
  const me = useAuthStore((state) => state.me);

  if (!me?.is_platform_super_admin) {
    return (
      <section className="studio-panel rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-7 text-amber-800">
        你当前没有查看任务并发管理的权限。这里承载的是平台级组织并发配额配置，仅向平台超级管理员开放。
      </section>
    );
  }

  return <StudioTaskConcurrencyPage />;
}
