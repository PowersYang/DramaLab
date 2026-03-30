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
    title: "商业化总览",
    description: "查看商业化工作台首页、关键运营指标、最近项目和任务追踪入口。",
  },
  "/studio/projects": {
    title: "项目中心",
    description: "以商业化资源管理方式查看系列、独立项目、导入入口与创建入口。",
  },
  "/studio/library": {
    title: "资产库",
    description: "统一浏览角色、场景、道具与来源归属，把资产沉淀成可复用资源中心。",
  },
  "/studio/tasks": {
    title: "任务中心",
    description: "聚合查看进行中、失败与已完成的生成任务，用业务语言理解异步生产链路。",
  },
  "/studio/team": {
    title: "团队与角色",
    description: "按工作区角色管理成员、邀请协作者，并控制制作权限边界。",
  },
  "/studio/billing": {
    title: "计费与套餐",
    description: "为组织管理员提供套餐、额度、账单和企业升级视图。",
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
    description: "根据当前角色收敛账号、工作区与管理员配置边界。",
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
