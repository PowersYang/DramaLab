# backend/AGENTS.md

## 文档目的
这份文件只描述后端目录内最值得长期复用的协作上下文，避免每次进入 `backend/` 都重新梳理入口、分层和近期稳定下来的平台化约束。

## 当前后端主入口
- 启动文件：`backend/main.py`
- 本地默认地址：`127.0.0.1:17177`
- 当前不是“API 进程 + 独立 worker 进程”模式
- `backend/main.py` 的 FastAPI `lifespan` 会统一启动 `TaskWorker`
- 这意味着：
  - 不能默认假设 worker 另有部署入口
  - 改动任务体系时，要同时考虑 API 生命周期和 worker 生命周期
  - 生产若走多实例部署，任务认领和幂等必须依赖数据库状态，而不是进程内状态

## 当前后端分层
- `backend/src/api/`
  - 负责 HTTP 参数校验、权限依赖、调用应用服务、返回 `signed_response`
- `backend/src/application/services/`
  - 负责普通业务服务编排，例如租户管理、平台配置等
- `backend/src/application/tasks/`
  - 负责统一任务创建、状态流转、执行器注册
- `backend/src/application/workflows/`
  - 负责跨步骤业务编排，不建议把长链路逻辑直接堆在 API 层
- `backend/src/repository/`
  - 负责数据库访问和实体持久化
- `backend/src/db/`
  - 负责模型、会话、数据库基础设施
- `backend/src/providers/`
  - 负责文本、图像、视频、导出、存储等外部能力适配
- `backend/src/settings/`
  - 环境配置统一入口，新增环境变量优先落在这里

## 最近稳定下来的后端约定
- API 层不再直接执行长任务
  - 长任务统一入 `task_jobs`
  - API 返回 `TaskReceipt`
  - 前端再通过 `/tasks` 相关接口轮询
- 多租户和工作区边界已经开始严格收口
  - 典型读取接口会根据 `RequestContext.current_workspace_id` 做过滤
  - 新接口如果返回项目、任务、配置等对象，需要同步检查 workspace / organization 边界
- 平台管理入口已经从“演示配置页”向“真实平台级配置”演进
  - `tenant_admin.py` 已承载组织、工作区、用户、角色、成员关系、模型供应商、模型目录等平台对象
  - 平台级配置默认需要平台角色依赖，不能直接暴露给普通工作区成员
- 请求日志和请求 ID 已经是稳定链路的一部分
  - 前端会发 `X-Request-ID`
  - 后端返回错误时尽量保留可追踪信息，方便联查浏览器日志与服务端日志

## 修改后端时的默认检查点
- 改 API 路由时：
  - 是否需要 `Depends(get_request_context)` 或更严格的 capability / role 校验
  - 是否需要按 `workspace_id` 或 `organization_id` 过滤返回值
  - 是否仍通过 `signed_response` 返回
- 改应用服务或仓储层时：
  - 是否破坏了 `organization_id` / `workspace_id` / `created_by` / `updated_by` 贯穿
  - 是否影响软删除字段语义
  - 是否同时兼容 SQLite 测试和 PostgreSQL 生产结构
- 改 provider 或输出逻辑时：
  - 不要重新引入仓库内本地持久化目录
  - 统一沿用 `tempfile + OSS / 对象存储` 的运行方式
- 新增依赖时：
  - 同步更新 `backend/requirements.txt`

## 高风险热点
- `backend/src/api/task.py`
  - 这里是前端任务中心和异步链路的统一读取入口，改动会直接影响多个前端模块
- `backend/src/application/tasks/`
  - 幂等、去重、重试、心跳、僵尸任务回收都集中在这里
- `backend/src/api/tenant_admin.py` 及对应 service/repository
  - 这里承载平台级管理对象，权限和数据边界出错会直接影响多租户隔离
- `backend/src/providers/`
  - 供应商差异、超时、重试、成本统计后续都容易继续收敛到这里

## 后续如果要继续演进
- 优先延续“API 轻、应用层编排、仓储层持久化、任务系统异步化”的方向
- 不要把临时脚本式逻辑重新塞回路由层
- 如果某类后端子系统继续明显变复杂，例如租户管理或模型配置，也可以再就近补一份该目录自己的 `AGENTS.md`
