import StudioProjectsPage from "@/components/studio/StudioProjectsPage";
import StudioShell from "@/components/studio/StudioShell";

export default function StudioProjectsRoutePage() {
  return (
    <StudioShell
      title="项目中心"
      description="以商业化资源管理方式查看系列、独立项目、导入入口与创建入口。"
    >
      <StudioProjectsPage />
    </StudioShell>
  );
}
