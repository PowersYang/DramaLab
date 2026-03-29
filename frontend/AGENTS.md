# frontend/AGENTS.md

## 文档目的
这份文件只记录前端目录里最近已经沉淀下来的实现约定，重点帮助以后快速恢复 Studio 后台、鉴权、任务中心和平台管理页的认知。

## 当前前端主结构
- 技术栈：`Next.js 14`、`React 18`、`TypeScript`、`Tailwind CSS`
- App Router 入口：
  - 营销/门户页在 `frontend/src/app/*`
  - Studio 后台主链路在 `frontend/src/app/studio/*`
- 组件分层：
  - `components/studio/` 负责后台壳层与平台管理页
  - `components/modules/` 负责生产链路模块
  - `components/project/`、`components/series/` 负责核心业务对象视图
- 状态层：
  - `src/store/authStore.ts`
  - `src/store/taskStore.ts`
  - `src/store/projectStore.ts`

## 最近稳定下来的前端约定
- `StudioShell` 已经成为后台主壳层
  - 统一处理左侧导航、工作区切换、用户信息和退出登录
  - 导航显隐依赖 capability
  - 平台级页面可继续叠加 `is_platform_super_admin` 控制
- 鉴权 bootstrap 已经从“页面各自探测”收敛到 `authStore`
  - 先尝试 `getMe`
  - 失败再走 `refreshSession`
  - 用 `sessionStorage` 保存轻量 snapshot，避免刷新后完全丢失前端态
  - 为避免 hydration mismatch，不要在模块初始化阶段直接读 `window` 或 `sessionStorage`
- API 层已经补齐请求链路可观测性
  - `src/lib/api.ts` 会统一注入 `X-Request-ID`
  - axios / fetch 都会打日志
  - 401 时会尝试刷新会话并重放请求
- 长任务状态不再依赖“整份项目详情轮询”
  - 长任务接口应该优先返回 `TaskReceipt`
  - 页面再经由 `taskStore` 跟踪任务
- Studio 正在从“单项目页面”走向“后台管理台”
  - 已经有 `tasks`、`team`、`billing`、`model-config`、`settings` 等页面
  - 平台级模型配置页默认只对平台超级管理员开放

## 修改前端时的默认检查点
- 改接口调用时：
  - 类型定义是否同步更新 `src/lib/api.ts`
  - 错误信息是否仍保留 request_id / detail 的可追踪能力
- 改后台导航或页面权限时：
  - 同时检查 capability 和平台角色限制
  - 不要只做前端隐藏，后端权限也必须存在
- 改任务相关页面时：
  - 优先复用 `taskStore`
  - 不要重新引入整份项目详情高频轮询
- 改鉴权相关页面时：
  - 避免在 SSR / hydration 阶段直接使用浏览器对象
  - 优先沿用 `authStore.bootstrapAuth()` 的既有节奏

## 高风险热点
- `frontend/src/lib/api.ts`
  - 这里承载 API URL 判定、错误格式化、请求日志、会话刷新
- `frontend/src/store/`
  - 这里已经是前端数据流核心，重复造 store 往往会造成状态分叉
- `frontend/src/components/studio/StudioShell.tsx`
  - 改动会影响整个后台页面的进入体验和权限显隐
- `frontend/src/components/modules/`
  - 这里和异步任务链路耦合最深

## 对未来自己的提醒
- 现在的前端不只是 Demo 首页，而是逐步演化成真正的 Studio 控制台
- 新页面优先接入既有壳层、鉴权和任务体系，不要再各自发明一套状态流
