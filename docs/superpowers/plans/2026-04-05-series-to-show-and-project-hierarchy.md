# DramaLab 剧集主入口收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前端工作台的信息架构收敛为“剧集是一级对象，项目是剧集下的制作单元”，减少用户对“系列/项目并列”的理解成本。

**Architecture:** 保持现有 `Series` / `Project` 数据模型不变，优先只调整 Studio 导航、工作台快捷入口、项目中心页的展示文案和入口层级。对全局独立项目能力不做删除，只在 UI 上降级为辅助入口和“最近继续创作”语义，避免一次改动牵动后端接口与生产链路。

**Tech Stack:** Next.js 14、React 18、TypeScript、Vitest、Testing Library

---

### Task 1: 为新的信息架构补前端回归测试

**Files:**
- Create: `frontend/src/components/studio/__tests__/StudioInformationArchitecture.spec.tsx`

- [ ] **Step 1: 写失败测试，约束工作台只突出“新建剧集”**

```tsx
it("shows create show as the primary dashboard action", async () => {
  render(<StudioDashboardPage />);

  await waitFor(() => {
    expect(screen.getByText("新建剧集")).toBeInTheDocument();
  });

  expect(screen.queryByText("新建项目")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd frontend && npx vitest run src/components/studio/__tests__/StudioInformationArchitecture.spec.tsx`
Expected: FAIL，因为当前工作台快捷操作里仍然展示“新建项目”。

- [ ] **Step 3: 写失败测试，约束项目中心把剧集作为主对象**

```tsx
it("treats shows as the primary object in the studio ledger", async () => {
  render(<StudioProjectsPage />);

  await waitFor(() => {
    expect(screen.getByText("剧集台账")).toBeInTheDocument();
  });

  expect(screen.getByText("新建剧集")).toBeInTheDocument();
  expect(screen.getByText("独立创作项目")).toBeInTheDocument();
});
```

- [ ] **Step 4: 运行测试并确认失败**

Run: `cd frontend && npx vitest run src/components/studio/__tests__/StudioInformationArchitecture.spec.tsx`
Expected: FAIL，因为当前页面仍使用“系列台账 / 新建资源 / 新建项目”等旧文案。

### Task 2: 调整 Studio 导航与工作台快捷入口

**Files:**
- Modify: `frontend/src/components/studio/StudioShell.tsx`
- Modify: `frontend/src/components/studio/StudioDashboardPage.tsx`

- [ ] **Step 1: 修改导航文案，突出剧集主入口**

```tsx
{ href: "/studio/projects", label: "剧集中心", shortLabel: "剧集", hint: "作品主档、剧集编排与最近创作入口", icon: FolderKanban, capability: "workspace.view", section: "planning" }
```

- [ ] **Step 2: 修改工作台统计与快捷入口文案**

```tsx
{ label: "剧集总数", value: seriesList.length, icon: Boxes }
```

```tsx
<h4 className="text-sm font-bold text-slate-800">新建剧集</h4>
<p className="text-[10px] text-slate-500">先建立作品主档，再在剧集下推进单集制作</p>
```

```tsx
<h4 className="text-sm font-bold text-slate-800">继续最近项目</h4>
<p className="text-[10px] text-slate-500">从最近的单集或制作项目继续创作</p>
```

- [ ] **Step 3: 运行新增测试确认工作台部分转绿**

Run: `cd frontend && npx vitest run src/components/studio/__tests__/StudioInformationArchitecture.spec.tsx`
Expected: 部分 PASS，若项目中心断言仍失败则继续下一任务。

### Task 3: 调整项目中心页，让剧集成为主对象、项目降级为辅助入口

**Files:**
- Modify: `frontend/src/components/studio/StudioProjectsPage.tsx`
- Modify: `frontend/src/components/studio/CreateSeriesDialog.tsx`
- Modify: `frontend/src/components/series/CreateEpisodeDialog.tsx`

- [ ] **Step 1: 修改筛选、摘要和主标题文案**

```tsx
{ label: "全部制作项目", value: projects.length, icon: FolderKanban }
{ label: "剧集总数", value: seriesList.length, icon: FileText }
```

```tsx
placeholder="搜索剧集、单集项目或关键词"
```

```tsx
{ id: "series", label: "剧集" }
{ id: "project", label: "独立创作项目" }
```

- [ ] **Step 2: 修改新建入口层级，让“新建剧集”成为主动作**

```tsx
<button onClick={() => setIsCreateSeriesOpen(true)} className="studio-button studio-button-primary !h-8 !px-3">
  <Plus size={14} />
  新建剧集
</button>
```

```tsx
<button onClick={() => setIsCreateProjectOpen(true)} className="studio-button studio-button-secondary !h-8 !px-3">
  <FileText size={14} />
  独立创作项目
</button>
```

- [ ] **Step 3: 修改台账标题与辅助说明**

```tsx
<h3 className="text-sm font-bold text-slate-800">剧集台账</h3>
```

```tsx
<h3 className="text-sm font-bold text-slate-800">独立创作项目</h3>
```

```tsx
{series.description || "剧集主档"}
```

```tsx
<p className="mt-1 text-sm text-gray-400">先创建一个单集标题，后续在单集编辑器里推进制作。</p>
```

- [ ] **Step 4: 同步创建弹窗文案**

```tsx
<h2 className="mt-2 text-2xl font-bold text-slate-950">创建剧集</h2>
<label className="mb-2 block text-sm font-medium text-slate-700">剧集标题</label>
<label className="mb-2 block text-sm font-medium text-slate-700">剧集简介</label>
```

- [ ] **Step 5: 运行测试，确认新增 spec 全绿**

Run: `cd frontend && npx vitest run src/components/studio/__tests__/StudioInformationArchitecture.spec.tsx`
Expected: PASS

### Task 4: 运行回归验证并记录结果

**Files:**
- Modify: `docs/superpowers/plans/2026-04-05-series-to-show-and-project-hierarchy.md`

- [ ] **Step 1: 运行关联测试**

Run: `cd frontend && npx vitest run src/components/studio/__tests__/StudioInformationArchitecture.spec.tsx src/app/studio/team/page.spec.tsx`
Expected: PASS

- [ ] **Step 2: 如有时间再补一次类型/构建级检查**

Run: `cd frontend && npm run build`
Expected: BUILD SUCCESS，若环境耗时过长至少记录未执行原因。

- [ ] **Step 3: 在计划文件末尾追加执行结果**

```md
## Execution Notes

- 2026-04-05: 已完成 Studio 导航、工作台快捷入口、剧集中心文案收敛。
- 2026-04-05: 使用 `/Users/will/.nvm/versions/node/v22.22.1/bin/node node_modules/vitest/vitest.mjs run src/components/studio/__tests__/StudioInformationArchitecture.spec.tsx` 验证通过。
- 2026-04-05: 额外回归 `src/components/series/__tests__/SeriesDetailPage.spec.tsx`、`src/app/studio/team/page.spec.tsx` 时发现仓库现有基线失败，分别缺少 `next/navigation` 与新增 team API mock，不属于本次改动引入的问题。
```
