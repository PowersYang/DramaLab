import StudioPlaceholderPage from "@/components/studio/StudioPlaceholderPage";
import StudioShell from "@/components/studio/StudioShell";

export default function StudioBillingRoutePage() {
  return (
    <StudioShell
      title="计费与套餐"
      description="为套餐、账单、配额和企业扩展能力预留商业化承载页。"
    >
      <StudioPlaceholderPage
        eyebrow="Billing"
        title="计费页先完成产品表达层"
        description="这里会承接套餐状态、账单记录、额度与配额策略。当前版本先把商业化结构与视觉基线搭好，不接真实支付流程。"
        highlights={["套餐状态总览", "账单与发票占位", "额度与配额表达", "企业升级入口"]}
      />
    </StudioShell>
  );
}
