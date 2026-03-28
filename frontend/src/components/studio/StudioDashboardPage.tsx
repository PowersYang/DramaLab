"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";

const formatDate = (value?: string | number | null) => {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN");
};

export default function StudioDashboardPage() {
  const projects = useProjectStore((state) => state.projects);
  const seriesList = useProjectStore((state) => state.seriesList);
  const setProjects = useProjectStore((state) => state.setProjects);
  const setSeriesList = useProjectStore((state) => state.setSeriesList);
  const [runningTasks, setRunningTasks] = useState(0);

  useEffect(() => {
    const load = async () => {
      const [projectsData, seriesData] = await Promise.all([api.getProjects(), api.listSeries()]);
      setProjects(projectsData);
      setSeriesList(seriesData);

      const tasks = await Promise.all(
        projectsData.map(async (project: { id: string }) => {
          try {
            return await api.listTasks(project.id, ["queued", "claimed", "running", "retry_waiting"]);
          } catch (error) {
            console.error("Failed to load active tasks for project:", project.id, error);
            return [];
          }
        })
      );

      setRunningTasks(tasks.flat().length);
    };

    void load();
  }, [setProjects, setSeriesList]);

  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => String(b.updated_at || b.updatedAt).localeCompare(String(a.updated_at || a.updatedAt))).slice(0, 4),
    [projects]
  );
  const recentSeries = useMemo(
    () => [...seriesList].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 3),
    [seriesList]
  );

  const stats = [
    { label: "项目总数", value: projects.length, note: "活跃项目与独立创作任务" },
    { label: "系列总数", value: seriesList.length, note: "可复用世界观与资产库" },
    { label: "进行中任务", value: runningTasks, note: "统一追踪异步生成链路" },
    { label: "最近导出", value: projects.filter((item) => item.merged_video_url).length, note: "已生成可交付成片" },
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="studio-panel p-6">
            <p className="text-sm font-medium text-slate-500">{item.label}</p>
            <p className="mt-4 text-4xl font-bold text-slate-950">{item.value}</p>
            <p className="mt-2 text-sm text-slate-500">{item.note}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="studio-panel p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-950">最近项目</h3>
            <Link href="/studio/projects" className="text-sm font-semibold text-primary">查看全部</Link>
          </div>
          <div className="space-y-3">
            {recentProjects.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                暂无项目，先从创建系列或导入剧本开始。
              </div>
            ) : (
              recentProjects.map((project) => (
                <Link key={project.id} href={`/studio/projects/${project.id}`} className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4 transition-colors hover:border-primary/40 hover:bg-white">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{project.title}</p>
                    <p className="mt-1 text-xs text-slate-500">更新于 {formatDate(project.updated_at || project.updatedAt)} · 分镜 {project.frames?.length || 0}</p>
                  </div>
                  <ArrowRight size={16} className="text-slate-400" />
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="studio-panel p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-950">最近系列</h3>
            <Link href="/studio/projects" className="text-sm font-semibold text-primary">进入系列管理</Link>
          </div>
          <div className="space-y-3">
            {recentSeries.length === 0 ? (
              <p className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500">暂无系列，适合多集内容的项目会显示在这里。</p>
            ) : (
              recentSeries.map((series) => (
                <Link key={series.id} href={`/studio/series/${series.id}`} className="block rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4 transition-colors hover:border-primary/40 hover:bg-white">
                  <p className="text-sm font-semibold text-slate-950">{series.title}</p>
                  <p className="mt-1 text-xs text-slate-500">集数 {series.episode_ids?.length || 0} · 更新于 {formatDate(series.updated_at)}</p>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
