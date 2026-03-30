"use client";

import PlatformBillingAdmin from "@/components/studio/PlatformBillingAdmin";
import { useAuthStore } from "@/store/authStore";

export default function StudioBillingAdminRoutePage() {
  const me = useAuthStore((state) => state.me);

  if (!me?.is_platform_super_admin) {
    return (
      <section className="studio-panel rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-7 text-amber-800">
        你当前没有查看计费规则配置的权限。这里承载的是平台级扣费标准、充值赠送规则和手工充值入口，仅向平台超级管理员开放。
      </section>
    );
  }

  return <PlatformBillingAdmin />;
}
