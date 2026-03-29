# frontend/src/store/AGENTS.md

## 文档目的
这份文件记录前端 store 层的职责边界，避免以后在状态管理上重复造轮子，或者把任务、鉴权、项目详情重新耦回一个难维护的大 store。

## 当前 store 分工
- `authStore.ts`
  - 负责会话 bootstrap、当前用户信息、工作区切换、能力判断、退出登录
- `taskStore.ts`
  - 负责 `TaskReceipt` 入队、`TaskJob` 详情拉取、项目级任务聚合、取消与重试
- `projectStore.ts`
  - 负责项目、角色、场景、道具、分镜、视频资产等主业务数据

## 最近稳定下来的状态管理约定
- 鉴权态和业务态分离
  - `authStore` 不承载项目详情
  - `projectStore` 不负责登录态恢复
- 任务态和项目详情分离
  - `taskStore` 管执行态
  - `projectStore` 管业务对象
  - 任务完成后再刷新项目详情，而不是让业务对象自己承担完整任务状态机
- `TaskReceipt -> taskStore -> refresh project detail` 是当前标准闭环
  - 页面拿到 `TaskReceipt`
  - 调 `enqueueReceipts(...)`
  - 单任务场景可用 `waitForJob(...)`
  - 项目级场景可用 `fetchProjectJobs(...)` 或活跃任务轮询
  - 任务结束后再调用项目详情接口刷新产物
- 浏览器缓存恢复只允许在安全时机做
  - `authStore` 的 snapshot 恢复发生在 bootstrap 流程
  - 不要在模块顶层直接读取 `window` / `sessionStorage`

## 修改 store 时的默认检查点
- 新增字段时：
  - 先确认应该归属 `authStore`、`taskStore` 还是 `projectStore`
  - 不要因为页面开发方便就临时塞进不相关的 store
- 改任务状态流时：
  - 同步检查 `src/lib/api.ts` 的 `TaskReceipt` / `TaskJob` 类型
  - 同步检查使用 `waitForJob(...)` 的页面模块
- 改工作区或用户信息时：
  - 确认是否需要在切换工作区后刷新页面或失效旧缓存
- 改持久化策略时：
  - 优先考虑 hydration 风险
  - 避免让 SSR 首帧和客户端首帧结构不一致

## 不建议再做的事情
- 不要让每个页面自己维护一份任务轮询状态
- 不要把接口 response 原样散落在多个局部 `useState` 里作为长期真源
- 不要把 task job 状态重新塞回 project 对象作为唯一依据

## 对未来自己的提醒
- 如果你在某个页面里又想写一套“loading + polling + retry + refresh”逻辑，先回来看 `taskStore`
- 如果你在某个组件里想直接读浏览器缓存恢复登录态，先回来看 `authStore`
