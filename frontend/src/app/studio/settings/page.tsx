import StudioPlaceholderPage from "@/components/studio/StudioPlaceholderPage";
import StudioShell from "@/components/studio/StudioShell";

export default function StudioSettingsRoutePage() {
  return (
    <StudioShell
      title="工作台设置"
      description="普通用户只看到账号资料、通知与工作区展示设置，不暴露系统密钥和模型配置。"
    >
      <StudioPlaceholderPage
        eyebrow="Settings"
        title="这里只保留普通用户设置边界"
        description="后续可以承接账号信息、通知偏好和工作区展示设置。密钥、模型、Prompt、环境与供应商配置不出现在这里。"
        highlights={["账号资料", "通知偏好", "工作区展示设置", "管理员配置隔离"]}
      />
    </StudioShell>
  );
}
