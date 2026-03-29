"use client";

import StudioPlaceholderPage from "@/components/studio/StudioPlaceholderPage";
import { useAuthStore } from "@/store/authStore";

export default function StudioBillingRoutePage() {
  const hasCapability = useAuthStore((state) => state.hasCapability);

  if (!hasCapability("workspace.manage_billing")) {
    return (
      <section className="studio-panel rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-7 text-amber-800">
        你当前没有查看计费与套餐配置的权限。普通制作人员与个人空间用户不会暴露账单、额度和企业套餐配置入口。
      </section>
    );
  }

  return (
    <StudioPlaceholderPage
      eyebrow="Billing"
      title="计费权限已经接入，业务计费流程仍待后续补全"
      description="当前页面已经完成角色隔离。后续可以在这里承接套餐状态、额度配额、账单记录和企业升级入口。"
      highlights={["当前套餐总览", "额度与配额管理", "账单记录占位", "企业升级入口"]}
    />
  );
}
