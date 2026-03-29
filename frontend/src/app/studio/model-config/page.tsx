"use client";

import PlatformModelAdmin from "@/components/studio/PlatformModelAdmin";
import { useAuthStore } from "@/store/authStore";

export default function StudioModelConfigRoutePage() {
  const me = useAuthStore((state) => state.me);

  if (!me?.is_platform_super_admin) {
    return (
      <section className="studio-panel rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-7 text-amber-800">
        你当前没有查看模型配置的权限。这里承载的是平台级供应商密钥、模型目录和上下线策略，不会向普通成员或组织管理员开放。
      </section>
    );
  }

  return <PlatformModelAdmin />;
}
