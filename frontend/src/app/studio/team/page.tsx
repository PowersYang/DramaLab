import StudioPlaceholderPage from "@/components/studio/StudioPlaceholderPage";
import StudioShell from "@/components/studio/StudioShell";

export default function StudioTeamRoutePage() {
  return (
    <StudioShell
      title="团队与角色"
      description="为未来的组织、成员、角色和席位能力预留商业化页面位置。"
    >
      <StudioPlaceholderPage
        eyebrow="Team"
        title="团队页先做高保真页面壳"
        description="这里会承接组织成员、角色分工、审批流程和工作区访问控制。本轮先完成导航位、信息架构和商业表达。"
        highlights={["成员列表与角色", "工作区访问控制", "创作/运营分工", "席位与协作边界"]}
      />
    </StudioShell>
  );
}
