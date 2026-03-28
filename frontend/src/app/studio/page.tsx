import StudioDashboardPage from "@/components/studio/StudioDashboardPage";
import StudioShell from "@/components/studio/StudioShell";

export default function StudioOverviewPage() {
  return (
    <StudioShell
      title="商业化总览"
      description="查看商业化工作台首页、关键运营指标、最近项目和任务追踪入口。"
    >
      <StudioDashboardPage />
    </StudioShell>
  );
}
