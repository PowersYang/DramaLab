# backend/src/application/tasks/AGENTS.md

## 文档目的
这份文件专门记录当前异步任务体系已经稳定下来的实现约定，方便以后进入任务目录时，能快速恢复“任务是怎么入队、怎么执行、怎么被前端消费”的完整链路。

## 当前任务体系的真实主链路
- API 层调用 `TaskService.create_job(...)` 或特定封装方法
- 服务层写入：
  - `task_jobs`
  - `task_events`
  - 必要时写业务占位对象，例如 `video_tasks`
- API 立即返回 `TaskReceipt`
- `TaskWorker` 在后台线程里轮询数据库认领任务
- `TaskExecutorRegistry` 按 `task_type` 选择执行器
- 执行器调用 workflow / provider 完成真实工作
- 成功或失败后回写：
  - `task_jobs.status`
  - `task_jobs.result_json` / `error_message`
  - `task_attempts`
  - `task_events`
- 前端通过 `/tasks/{job_id}` 或 `/tasks?project_id=...` 感知最终状态

## 这里最重要的几个角色
- `service.py`
  - 统一任务创建、幂等、去重、状态流转、attempt/event 记录
- `registry.py`
  - `task_type -> executor` 的唯一映射入口
- `executors/*.py`
  - 真正的任务执行入口
- `backend/src/worker/task_worker.py`
  - 负责认领、启动执行、打心跳、处理成功/失败、停机回收

## 当前已经成型的关键约定
- `TaskReceipt` 是 API 与前端之间的轻量契约
  - 长任务接口尽量先返回 `TaskReceipt`
  - 不要把长任务重新做回同步阻塞接口
- 去重与幂等已经进入基础设施层
  - `idempotency_key` 负责显式幂等
  - `dedupe_key` 负责同类活动任务复用
  - 新任务类型如果没有想清楚这两者，很容易造成重复生成或并发冲突
- worker 已支持心跳与僵尸任务回收
  - `heartbeat_at` 用于长任务保活
  - 重启后会回收 `claimed/running` 且长时间无心跳的任务
  - 所以执行器不要假设“只要进程没报错，任务一定还被认为活着”
- 任务状态和业务产物是分离的
  - `task_jobs` 负责执行态
  - `video_tasks`、`storyboard_frames`、资产表等负责业务结果
  - 不要再把“执行中/失败中间态”塞回业务表当唯一状态来源

## 新增一个 task_type 时的默认步骤
1. 在 API 或应用服务里决定入队时机，并返回 `TaskReceipt`
2. 设计好 `payload_json`、`resource_type`、`resource_id`
3. 评估 `idempotency_key` 和 `dedupe_scope`
4. 在 `registry.py` 注册执行器
5. 在执行器里把最终结果写回业务对象，并返回适合落到 `result_json` 的结果
6. 检查前端是走单任务 `waitForJob(...)`，还是项目级 `/tasks` 轮询
7. 补至少一层测试
   - 服务层状态流转
   - 或执行器关键行为
   - 或 API 入队与任务查询

## 改动任务系统时最容易误伤的点
- `queue_name`
  - 需要与 worker 当前监听队列对应
- `project_id` / `series_id` / `workspace_id`
  - 会直接影响前端聚合查询和多租户可见性
- `result_json`
  - 前端或后续服务可能会依赖这个结果做刷新判断，格式不要随意漂移
- `cancel_requested_at`
  - 执行器如果是长阻塞外部调用，取消通常只能做到“尽快停止后续步骤”，不要承诺即时中断
- `max_attempts` / `timeout_seconds`
  - 改默认值前，要考虑供应商耗时和失败重试的副作用

## 对未来自己的提醒
- 这里是平台从“同步 Demo”走向“可恢复异步系统”的关键支点
- 如果某个功能开始难以维护，优先继续把状态机、幂等和事件链路往这里收，而不是回退到页面轮询整份项目详情
