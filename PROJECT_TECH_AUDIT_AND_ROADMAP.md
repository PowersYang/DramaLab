# DramaLab 项目技术盘点与改造路线图

> 盘点时间：2026-04-01
> 盘点视角：技术专家 / 平台化改造 / 商业化落地
> 盘点范围：`backend/`、`frontend/`、`docs/`、根目录工程治理

## 1. 结论先行

### 1.1 当前项目所处阶段

DramaLab 已经明显不是“纯 Demo”：

- 后端已经具备多租户字段、工作区、角色、成员关系、计费账户、任务中心、任务重试/回收等平台化基础。
- 前端已经不只是单页创作器，而是在演进为带鉴权、任务中心、平台管理、计费入口的 Studio 控制台。
- 任务链路已经从同步调用转向 `TaskReceipt -> task_jobs -> worker -> task_events` 的异步执行模型。

但它也还远没到“可规模化商用平台”的状态：

- 缺正式迁移体系，仍依赖启动时补列和兼容性迁移逻辑。
- 缺 CI/CD、容器化、环境基线、发布编排、观测闭环。
- 前后端已有若干超大文件，开始出现“功能堆积、边界变模糊”的迹象。
- 本地开发和测试基线不稳定，工具链一致性不足。

### 1.2 总体判断

这是一个“方向正确、基础不差、但工程化短板开始拖后腿”的项目。

如果继续只堆业务功能，不优先补齐迁移、测试、环境基线、模块拆分和可观测性，后续会出现：

- 新功能越来越慢
- 回归风险越来越高
- 多租户/权限/计费出错代价越来越大
- 部署和问题定位越来越依赖人肉经验

所以当前最优策略不是“继续猛加功能”，而是进入一轮平台化夯实期。

## 2. 盘点依据

本结论基于以下实际观察：

- 主入口：`backend/main.py`、`frontend/src/lib/api.ts`
- 数据模型：`backend/src/db/models.py`
- 任务系统：`backend/src/application/tasks/service.py`、`backend/src/worker/task_worker.py`
- 前端状态层：`frontend/src/store/taskStore.ts`、`frontend/src/store/projectStore.ts`
- 环境与数据库初始化：`backend/src/db/session.py`
- 测试目录：`backend/tests/`、`frontend/src/**/__tests__`
- 文档现状：`frontend/README.md` 仍为默认 Next.js 模板

额外验证结果：

- `./venv/bin/python -m pytest -q backend/tests`：`106 passed, 4 failed`
- 前端 `./node_modules/.bin/vitest run` 启动失败：当前 Node 版本为 `v16.16.0`，不满足现有 Vite/Vitest 运行要求
- 系统 `pytest` 命令不存在，说明本地 Python 工具入口未标准化

## 3. 优先级总表

| 优先级 | 改造主题 | 结论 |
|---|---|---|
| P0 | 数据库迁移体系 | 必须立即补齐，否则后续所有结构演进都存在生产风险 |
| P0 | 工具链与环境基线 | 必须收敛，否则测试、构建、部署不可重复 |
| P0 | 多租户/权限/计费高风险链路回归保障 | 必须加固，否则一旦出错就是平台级事故 |
| P1 | 前后端大文件拆分与边界治理 | 已开始影响维护效率，建议尽快处理 |
| P1 | 可观测性与错误追踪 | 目前只有基础日志，离可运营还差很远 |
| P1 | 发布与部署标准化 | 缺 CI/CD、缺容器化、缺环境自检闭环 |
| P1 | 媒资与本地文件依赖进一步收敛 | 方向对，但仍有本地路径兼容逻辑残留 |
| P2 | 测试体系扩展与覆盖率可视化 | 已有基础，但缺关键链路完整保护 |
| P2 | 前端体验与性能治理 | 页面模块偏重，状态与交互复杂度会继续上升 |
| P2 | 文档体系重建 | 当前文档与真实实现存在明显脱节 |

## 4. 分域问题清单与建议

### 4.1 架构层

#### 问题

- 单仓结构清晰，但“应用演进速度”已经超过“架构边界治理速度”。
- 后端 `service`、`workflow`、`repository` 分层总体正确，但部分文件体量已经偏大。
- 前端 `api.ts` 约 `1999` 行，`projectStore.ts` 约 `954` 行，已经是明显的维护风险信号。
- `TaskService` 约 `670` 行，承担创建、计费、幂等、状态流转、事件记录、重试等过多职责。

#### 风险

- 新人接手成本高。
- 改一处容易误伤多条链路。
- 单文件冲突概率上升，协作效率下降。

#### 建议

- 后端优先把 `TaskService` 拆为：
  - `TaskCreationService`
  - `TaskStateService`
  - `TaskBillingPolicy`
  - `TaskDedupePolicy`
- 前端优先把 `api.ts` 拆为：
  - `api/core.ts`
  - `api/auth.ts`
  - `api/tasks.ts`
  - `api/projects.ts`
  - `api/platform.ts`
- `projectStore.ts` 拆为：
  - `projectEntitiesStore`
  - `projectTimelineStore`
  - `projectGenerationStore`

优先级：`P1`

### 4.2 数据库与迁移体系

#### 问题

- 当前没有 Alembic 或等价正式迁移体系。
- `backend/src/db/session.py` 里存在 `_ensure_incremental_columns(...)` 和 `_migrate_legacy_user_art_styles(...)` 这类“启动时修表/补列/迁移”的逻辑。
- `docs/timeline-phase1-design.md` 也明确说明“当前仓库还没有正式 migration 体系”。

#### 风险

- 多环境 schema 漂移。
- 发布结果依赖启动顺序和历史库状态。
- 线上问题难以回溯。
- 数据结构变更无法纳入审计与回滚流程。

#### 建议

- 立刻引入 Alembic。
- 冻结一次当前 PostgreSQL schema，建立 baseline migration。
- 把 `_ensure_incremental_columns(...)` 中的结构变更逐步迁出为正式 migration。
- 启动阶段只允许“校验”和“只读兼容”，不再承担正式改表职责。
- 建立迁移规范：
  - 每次模型变更必须附 migration
  - CI 执行 upgrade + downgrade smoke test
  - SQLite 测试与 PostgreSQL 迁移分别验证

优先级：`P0`

### 4.3 多租户、权限、组织边界

#### 现状亮点

- ORM 已广泛引入 `organization_id`、`workspace_id`、`created_by`、`updated_by`。
- API 层大量使用 `RequestContext` 和 capability 依赖。
- `series`、`project`、`task`、`billing`、`tenant_admin` 已有明显边界意识。

#### 问题

- 现在主要靠“接口层记得传/校验”来维持边界，仍偏人工纪律。
- 仓储层和服务层暂未看到统一的租户强制策略基础设施。
- 一旦后续新接口、新任务类型、新管理页增多，容易出现漏传或漏过滤。

#### 建议

- 建立统一的 `TenantScope` / `WorkspaceScope` 注入机制。
- 关键 repository 提供“必须带 scope 的查询接口”，减少裸查询。
- 对高风险对象增加自动化回归：
  - `projects`
  - `series`
  - `task_jobs`
  - `billing_accounts`
  - `model_provider_configs`
- 建立权限矩阵文档，明确 capability、平台角色、组织角色、工作区角色之间的关系。

优先级：`P0`

### 4.4 异步任务体系

#### 现状亮点

- 任务主链路设计是当前项目最成熟的基础设施之一。
- 已具备：
  - `task_jobs`
  - `task_attempts`
  - `task_events`
  - 幂等键
  - 去重键
  - 心跳
  - 僵尸任务回收
  - cancel / retry 接口

#### 问题

- Worker 仍以内嵌线程方式跟随 API 进程启动。
- 当前模型更适合单实例或轻量多实例，不适合真正独立扩缩容。
- `queue_name` 已存在，但尚未看到真正独立 worker 进程/部署拓扑。
- 任务并发、优先级、失败隔离、事件订阅和监控仍偏基础版。

#### 建议

- 第二阶段把 worker 从 `backend/main.py` 生命周期中解耦，支持独立进程部署。
- 引入：
  - worker 分组
  - queue 分级
  - 更细粒度并发限额
  - 任务死信/人工介入机制
- 补“任务状态机约束测试”和“任务事件审计查询”。
- 给 `task_events` 加统一事件 schema，避免后续 result/event payload 失控。

优先级：`P1`

### 4.5 计费、配额、成本治理

#### 现状亮点

- 已有 `billing_accounts`、`billing_transactions`、`billing_pricing_rules`。
- `TaskService.create_job(...)` 已在任务提交时接入计费。

#### 问题

- 当前更像“初步计费骨架”，还不是完整商业化闭环。
- 供应商调用成本、失败补偿、退款规则、配额预占/释放、超额保护仍未完整体现。
- 计费和任务最终结果的一致性仍需重点验证。

#### 建议

- 建立计费状态机：
  - 提交预扣
  - 成功确认
  - 失败回补
  - 人工调整
- 把“模型调用成本快照”和“账务规则版本”落到任务执行结果或账单关联中。
- 增加财务一致性测试：
  - 幂等提交不重复扣费
  - 去重复用不重复扣费
  - 失败重试不超扣

优先级：`P0`

### 4.6 媒资存储与分布式兼容

#### 现状亮点

- 设计方向是正确的，已明确往“临时文件 + OSS”收敛。
- 上传入口、导出、分镜、音频等链路已经大量接入 OSS。

#### 问题

- 代码里仍保留不少“如果是本地路径就直接用”的兼容分支。
- 说明项目还处于“从本地文件时代迁移中”，并未完全去本地路径化。
- FFmpeg、音频波形、部分 provider 仍依赖本地物化。

#### 建议

- 将“允许本地路径输入”的范围压缩到运行时临时目录。
- 明确区分三类地址：
  - OSS object key
  - 稳定展示 URL
  - 运行时临时本地路径
- 引入统一媒资引用类型，避免字符串字段同时承载三种含义。
- 中期考虑抽象 Media Asset Service，统一负责：
  - 解析
  - 下载
  - 上传
  - 签名/展示 URL
  - 生命周期清理

优先级：`P1`

### 4.7 前端工程治理

#### 问题

- `frontend/README.md` 仍是默认 Next 模板，明显失真。
- `package.json` 没有标准 `test` 脚本。
- 当前 Node 版本 `v16.16.0`，而依赖组合已无法稳定跑 `vitest`。
- `api.ts` 和 `projectStore.ts` 体量过大。
- 存在 `console.log(...)` 调试残留。

#### 建议

- 明确前端基线：
  - Node `>=18.17` 已写在 `package.json`，应落实到 `.nvmrc` 或 `volta` / `mise`
  - 增加 `npm run test`
  - 增加 `npm run typecheck`
- 清理调试日志，建立开发日志规范。
- 为 Studio、营销站、平台管理台建立更清晰的模块边界。
- 给重量模块做按领域拆分，避免继续把复杂逻辑塞回 `projectStore`。

优先级：`P0` 到 `P1`

### 4.8 后端工程治理

#### 问题

- 依赖管理停留在 `requirements.txt`，可以用，但对锁版本、复现和环境隔离不够强。
- 当前测试运行依赖 `./venv/bin/python -m pytest`，系统级 `pytest` 不可用。
- 部分调试 `print(...)` 残留在 `oss_utils.py`。

#### 建议

- 至少补齐：
  - `Makefile` 或 `justfile`
  - 标准化命令入口
  - 统一 lint / test / run / migrate 命令
- 中期考虑迁移到 `uv` 或 `poetry + lockfile` 之一，提升环境复现能力。
- 清理 provider / utils 层调试输出，统一走日志框架。

优先级：`P0` 到 `P1`

### 4.9 测试体系

#### 现状

- 后端测试基础比前端更扎实。
- 实测结果：`106 passed, 4 failed, 1 warning`。
- 失败点集中在：
  - `test_llm_adapter.py`
  - `test_tenant_admin_api.py`

#### 暴露出的真实问题

- 不是“没有测试”，而是“已有测试正在反向暴露模型配置与管理接口回归”。
- 这恰恰说明测试体系开始发挥价值，但还需要继续扩。

#### 建议

- 先把当前 4 个失败修掉，恢复主干稳定。
- 后续测试优先补四条主链路：
  - 多租户权限
  - 任务提交/重试/取消/回收
  - 计费一致性
  - 平台管理接口
- 前端增加：
  - `taskStore` 行为测试
  - Studio 权限导航测试
  - 项目详情刷新与任务完成联动测试

优先级：`P0`

### 4.10 可观测性、日志、故障定位

#### 现状

- 已有 request logging、request_id、前端请求日志、后端结构化日志基础。

#### 缺口

- 没看到完整监控栈。
- 没看到异常聚合平台接入。
- 没看到任务指标、队列指标、计费异常告警、供应商调用统计面板。

#### 建议

- 第一阶段先补：
  - 错误聚合
  - 任务成功率/失败率/平均耗时
  - 供应商调用耗时/错误码
  - 计费异常告警
- 第二阶段接入：
  - tracing
  - metrics
  - dashboard
  - 告警策略

优先级：`P1`

### 4.11 发布、部署、运维

#### 问题

- 仓库内未见 `.github/workflows`、`Dockerfile`、`docker-compose`、`alembic.ini`。
- 当前部署明显仍偏人工经验驱动。
- 已知测试环境依赖 `supervisor`，但仓库内未体现标准化发布资产。

#### 建议

- 至少建立：
  - backend image
  - frontend image
  - CI 测试
  - build artifact
  - deploy 脚本
- 明确区分：
  - 本地开发
  - 测试环境
  - 生产环境
- 把环境变量、健康检查、版本信息、启动检查标准化。

优先级：`P1`

### 4.12 文档与认知管理

#### 问题

- 根目录 `README.md` 实际缺失。
- `frontend/README.md` 仍为默认模板。
- 说明“真实系统认知”主要靠代码和 AGENTS 文档，而非正式项目文档。

#### 建议

- 重建三层文档：
  - 面向外部：项目介绍、快速启动、核心能力
  - 面向开发：架构、模块、任务系统、环境、测试
  - 面向运维：部署、迁移、故障排查、回滚
- AGENTS.md 继续保留，但不要让它替代正式文档体系。

优先级：`P2`

## 5. 推荐的改造顺序

### 第一阶段：止血与基线收口（1-2 周）

目标：先把“随时可能出事”的点压住。

1. 引入正式 migration 体系，冻结 baseline。
2. 修复当前后端 4 个失败测试。
3. 统一本地环境基线：
   - Python 启动方式
   - Node 版本
   - 标准 test/build/run 命令
4. 补 CI 最小闭环：
   - backend tests
   - frontend typecheck
   - frontend tests
5. 清理调试输出与明显工程杂质。

### 第二阶段：平台骨架加固（2-4 周）

目标：把“能跑”提升到“能稳定演进”。

1. 统一租户上下文与 repository scope 约束。
2. 拆分超大文件：
   - `frontend/src/lib/api.ts`
   - `frontend/src/store/projectStore.ts`
   - `backend/src/application/tasks/service.py`
3. 建立任务、计费、权限三条关键回归套件。
4. 抽象媒资引用模型，减少本地路径兼容逻辑。

### 第三阶段：可运营化（4-8 周）

目标：把项目从“研发内可用”提升到“平台可维护”。

1. 引入容器化与标准发布资产。
2. 接入异常聚合、指标监控、任务看板。
3. 支持独立 worker 进程部署。
4. 完善平台管理、模型供应商、计费与任务运营后台。

## 6. 90 天建议路线图

### P0 必做

- 正式 migration 体系
- 修复现有失败测试
- 统一 Node / Python / test 命令基线
- 补多租户/权限/计费关键链路回归

### P1 应做

- 拆大文件、治理边界
- worker 独立化设计
- 可观测性补齐
- 部署标准化
- 媒资服务进一步抽象

### P2 可排期

- 文档体系重建
- 前端性能与交互精修
- 更细的运营能力、分析能力、成本分析能力

## 7. 如果只做三件事

如果资源有限，我建议只先做这三件：

1. **上 Alembic，停止继续靠启动补列。**
2. **修复测试并补 CI，让主干重新可信。**
3. **统一环境基线和命令入口，避免“本地能不能跑”继续靠运气。**

这三件事情看起来不性感，但决定后面所有功能开发是不是在健康地基上进行。

## 8. 当前已确认的具体风险信号

- `backend/src/db/session.py` 仍承担结构补齐与兼容迁移职责。
- `frontend/src/lib/api.ts` 约 `1999` 行。
- `frontend/src/store/projectStore.ts` 约 `954` 行。
- `backend/src/application/tasks/service.py` 约 `670` 行。
- 仓库工作区当前非完全干净：`git status --short` 显示已有改动。
- 本地存在运行/构建产物目录：`.next`、`node_modules`、`__pycache__`、`.pytest_cache`。
- 前端测试在当前 Node `v16.16.0` 环境下无法启动。
- 后端测试虽整体可跑，但已出现 4 个实际失败用例。

## 9. 最终判断

DramaLab 最值得肯定的，不是它现在已经多完善，而是它已经选对了平台化方向：

- 多租户
- 异步任务
- 平台管理
- 计费
- 媒资上云

真正需要警惕的，是“方向已经升级到平台化，但工程手段还带着 Demo 阶段惯性”。

下一阶段不应该只是继续加功能，而应该明确进入一轮“平台工程化补课期”。这轮补课做得越早，后面商业化推进越顺；做得越晚，后面每一个功能都要用更高成本去偿还技术债。
