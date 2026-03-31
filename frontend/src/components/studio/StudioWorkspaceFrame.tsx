"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { PROJECT_REFRESH_PATH_STORAGE_KEY, isPageReloadNavigation } from "@/components/project/projectNavigation";
import StudioShell from "@/components/studio/StudioShell";

interface StudioWorkspaceFrameProps {
  children: ReactNode;
}

const STUDIO_SHELL_META: Record<string, { title: string; description: string }> = {
  "/studio": {
    title: "工作台总览",
    description: "从短剧生产、任务调度、异常信号和资源沉淀四个维度总览当前工作区。",
  },
  "/studio/projects": {
    title: "项目与系列",
    description: "用后台台账视角管理系列母体、项目单元、分集编排与导入入口。",
  },
  "/studio/library": {
    title: "角色场景资产",
    description: "统一管理角色、场景、道具与来源归属，把制作资产沉淀成可复用资源层。",
  },
  "/studio/tasks": {
    title: "生产调度中心",
    description: "聚合查看排队、执行、重试与异常任务，用业务语言理解 AI 生产链路。",
  },
  "/studio/styles": {
    title: "美术风格策略",
    description: "统一管理视觉风格模板和历史沉淀，让项目风格策略可复用、可治理。",
  },
  "/studio/team": {
    title: "团队协同",
    description: "按工作区角色管理成员、邀请协作者，并控制制作与运营权限边界。",
  },
  "/studio/billing": {
    title: "算力与成本",
    description: "组织管理员可见全部算力与扣费数据，成员查看自己相关消耗与余额。",
  },
  "/studio/billing-admin": {
    title: "计费规则配置",
    description: "仅平台超级管理员可配置任务扣费规则、充值赠送规则，并执行手工充值。",
  },
  "/studio/model-config": {
    title: "模型配置",
    description: "通过表格统一管理平台级模型供应商、模型目录以及前台可见范围。",
  },
  "/studio/task-concurrency": {
    title: "任务并发管理",
    description: "按组织和任务类型配置平台总并发上限，让超额任务自动留在队列中等待执行位。",
  },
  "/studio/settings": {
    title: "工作台设置",
    description: "根据当前角色收敛账号、工作区、后台偏好与管理员配置边界。",
  },
};

export default function StudioWorkspaceFrame({ children }: StudioWorkspaceFrameProps) {
  const pathname = usePathname();
  const shellMeta = STUDIO_SHELL_META[pathname];

  useEffect(() => {
    const refreshedProjectPath = window.sessionStorage.getItem(PROJECT_REFRESH_PATH_STORAGE_KEY);
    if (!refreshedProjectPath) {
      return;
    }

    // 中文注释：刷新后的同一路径允许继续保留标记，避免开发态双挂载把恢复信息提前清掉。
    // 一旦当前文档内跳转到其他 Studio 页面，就清理掉旧标记，防止后续重新打开项目时误恢复。
    if (!isPageReloadNavigation() || refreshedProjectPath !== pathname) {
      window.sessionStorage.removeItem(PROJECT_REFRESH_PATH_STORAGE_KEY);
    }
  }, [pathname]);

  // 中文注释：让 Studio 壳层在 layout 里常驻，切换左侧导航时只替换右侧内容区，避免整页重挂载。
  if (!shellMeta) {
    return <>{children}</>;
  }

  return (
    <StudioShell title={shellMeta.title} description={shellMeta.description}>
      {children}
    </StudioShell>
  );
}
