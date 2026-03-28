"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2 } from "lucide-react";

import { api, type TaskJob } from "@/lib/api";
import { useTaskStore } from "@/store/taskStore";

const TASK_COPY: Record<string, string> = {
  "art_direction.analyze": "AI 风格分析",
  "asset.generate": "资产生成",
  "asset.generate_batch": "批量资产生成",
  "audio.generate.line": "台词配音生成",
  "audio.generate.project": "项目音频生成",
  "media.merge": "视频合成",
  "mix.generate_bgm": "背景音乐生成",
  "mix.generate.sfx": "音效生成",
  "project.export": "项目导出",
  "project.reparse": "项目重解析",
  "project.sync_descriptions": "描述同步",
  "series.assets.import": "系列资产导入",
  "series.import.confirm": "系列导入确认",
  "series.import.preview": "系列导入预分析",
  "storyboard.analyze": "分镜分析",
  "storyboard.generate_all": "分镜生成",
  "storyboard.refine_prompt": "分镜提示词润色",
  "storyboard.render": "分镜渲染",
  "video.generate.asset": "资产视频生成",
  "video.generate.frame": "分镜视频生成",
  "video.generate.project": "项目视频生成",
  "video.polish_prompt": "视频提示词润色",
  "video.polish_r2v_prompt": "R2V 提示词润色",
};

const STATUS_META = {
  running: { label: "进行中", tone: "bg-amber-100 text-amber-700", icon: Clock3 },
  queued: { label: "排队中", tone: "bg-slate-100 text-slate-700", icon: Clock3 },
  claimed: { label: "已领取", tone: "bg-slate-100 text-slate-700", icon: Clock3 },
  succeeded: { label: "已完成", tone: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  failed: { label: "失败", tone: "bg-rose-100 text-rose-700", icon: AlertTriangle },
  cancelled: { label: "已取消", tone: "bg-slate-100 text-slate-700", icon: AlertTriangle },
  timed_out: { label: "超时", tone: "bg-rose-100 text-rose-700", icon: AlertTriangle },
  retry_waiting: { label: "等待重试", tone: "bg-orange-100 text-orange-700", icon: Clock3 },
  cancel_requested: { label: "取消中", tone: "bg-slate-100 text-slate-700", icon: Clock3 },
} as const;

const formatTime = (value?: string | number | null) => {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
};

const getTimestamp = (value?: string | number | null) => {
  if (!value) return 0;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const ACTIVE_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"];

export default function StudioTasksPage() {
  const upsertJobs = useTaskStore((state) => state.upsertJobs);
  const [tasks, setTasks] = useState<TaskJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 任务中心直接拉聚合任务列表，避免依赖项目列表是否先成功加载。
    const load = async (showLoading = false) => {
      if (showLoading) {
        setLoading(true);
      }
      try {
        setError(null);
        const taskList = await api.listTasks(undefined, undefined, { limit: 200 });
        if (cancelled) return;

        upsertJobs(taskList);
        setTasks(
          [...taskList].sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at))
        );
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "任务中心加载失败";
        console.error("Failed to load tasks:", loadError);
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load(true);
    const timer = window.setInterval(() => {
      void load(false);
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [upsertJobs]);

  const groups = useMemo(() => ({
    active: tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)),
    failed: tasks.filter((task) => ["failed", "timed_out"].includes(task.status)),
    done: tasks.filter((task) => task.status === "succeeded"),
  }), [tasks]);

  if (loading) {
    return (
      <div className="studio-panel flex min-h-[320px] items-center justify-center p-12">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="studio-panel rounded-[1.5rem] border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-700">任务中心加载失败</p>
        <p className="mt-2 text-sm text-rose-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {[
        { title: "进行中", items: groups.active },
        { title: "异常任务", items: groups.failed },
        { title: "最近完成", items: groups.done.slice(0, 8) },
      ].map((section) => (
        <section key={section.title} className="studio-panel p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-950">{section.title}</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{section.items.length} items</span>
          </div>

          {section.items.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              当前没有{section.title}任务
            </div>
          ) : (
            <div className="space-y-3">
              {section.items.map((task) => {
                const meta = STATUS_META[task.status as keyof typeof STATUS_META] ?? STATUS_META.queued;
                const Icon = meta.icon;
                return (
                  <div key={task.id} className="flex flex-col gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${meta.tone}`}>
                          <Icon size={14} />
                          {meta.label}
                        </span>
                        <span className="text-sm font-semibold text-slate-950">
                          {TASK_COPY[task.task_type] || task.task_type}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        项目 ID: {task.project_id || "-"} · 系列 ID: {task.series_id || "-"} · 创建于 {formatTime(task.created_at)}
                      </p>
                      {task.error_message && (
                        <p className="mt-2 text-sm text-rose-600">{task.error_message}</p>
                      )}
                    </div>
                    <div className="text-right text-sm text-slate-500">
                      <p>尝试 {task.attempt_count}/{task.max_attempts}</p>
                      <p className="mt-1">结束时间 {formatTime(task.finished_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
