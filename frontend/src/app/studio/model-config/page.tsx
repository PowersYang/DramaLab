"use client";

import PlatformModelAdmin from "@/components/studio/PlatformModelAdmin";
import StudioShell from "@/components/studio/StudioShell";
import { useAuthStore } from "@/store/authStore";

export default function StudioModelConfigRoutePage() {
  const me = useAuthStore((state) => state.me);

  if (!me?.is_platform_super_admin) {
    return (
      <StudioShell title="模型配置" description="只有平台超级管理员可以管理平台级模型供应商和模型目录。">
        <section className="studio-panel rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-7 text-amber-800">
          你当前没有查看模型配置的权限。这里承载的是平台级供应商密钥、模型目录和上下线策略，不会向普通成员或组织管理员开放。
        </section>
      </StudioShell>
    );
  }

  return (
    <StudioShell title="模型配置" description="通过表格统一管理平台级模型供应商、模型目录以及前台可见范围。">
      <PlatformModelAdmin />
    </StudioShell>
  );
}
