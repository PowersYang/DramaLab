import StudioShell from "@/components/studio/StudioShell";
import StudioTasksPage from "@/components/studio/StudioTasksPage";

export default function StudioTasksRoutePage() {
  return (
    <StudioShell
      title="任务中心"
      description="聚合查看进行中、失败与已完成的生成任务，用业务语言理解异步生产链路。"
    >
      <StudioTasksPage />
    </StudioShell>
  );
}
