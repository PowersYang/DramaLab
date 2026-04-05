# Series Entity Master Design

## 背景

DramaLab 当前已经同时支持 `project` 级资产与 `series` 级资产，但剧本重解析与实体提取仍然主要按 `project` 粒度落库。对于同一系列下的多个分集，这会导致同一角色、场景、道具在多个 `project` 中被重复提取、重复创建、重复生成素材，最终带来以下问题：

- 同一系列角色出现多个实体 ID，身份真源分叉
- 角色图、语音、视频等素材重复生成，浪费算力豆
- 分镜帧和后续视频任务引用的角色身份不稳定
- 系列长线设定难以维护，人工合并成本越来越高

项目当前已经具备 `owner_type="series"` 的资产能力，因此本次设计不新增第二套资产模型，而是把系列模式下的实体归属和提取流程收敛到已有的系列资产容器上。

## 目标

把系列模式下的角色、场景、道具统一收敛为“系列主档 + 分集引用”的结构，确保系列内实体原则上唯一，分集只能引用系列主档并做轻量覆盖，不再继续创建分集级完整实体真源。

## 非目标

- 不在本次改造中引入复杂的向量召回或 embedding 基础设施
- 不一次性清理全部历史脏数据，只保证新链路正确并为历史迁移留出口
- 不重构独立项目模式，独立项目仍允许保留 `project` 级实体

## 核心设计

### 1. 真源规则

- 独立项目：
  - 继续使用 `characters/scenes/props` 表中的 `owner_type="project"` 记录作为真源
- 系列项目：
  - `characters/scenes/props` 表中的 `owner_type="series"` 记录成为系列主档真源
  - `project` 不再拥有独立完整实体真源
  - `project` 通过新的 link 表引用系列实体

对角色而言，最终关系为：

- `Series -> Character`
- `Project -> ProjectCharacterLink -> Character`

### 2. 新增引用层

系列模式下新增 `project_character_links`，后续同理扩展到场景与道具。

建议字段：

- `id`
- `project_id`
- `series_id`
- `character_id`
- `source_name`
- `source_alias`
- `episode_notes`
- `override_json`
- `match_confidence`
- `match_status`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`
- `is_deleted`
- `deleted_at`
- `deleted_by`

字段职责：

- `character_id`：指向系列角色主档
- `source_name`：本次提取时原文命中的角色名
- `source_alias`：用户确认后的本集称呼
- `episode_notes`：本集局部备注
- `override_json`：本集允许覆盖的轻量字段
- `match_confidence`：自动匹配置信度
- `match_status`：自动匹配、待确认、人工确认等状态

### 3. 角色主档补充字段

为支持系列内稳定身份匹配，建议为 `characters` 表补充：

- `canonical_name`
- `aliases_json`
- `identity_fingerprint`
- `merge_status`

其中：

- `canonical_name`：系列级标准展示名
- `aliases_json`：别名列表
- `identity_fingerprint`：归一化身份指纹，用于规则匹配
- `merge_status`：主档状态，例如 `active/pending_merge/merged`

同一系列下应至少保证 `canonical_name` 在有效记录范围内唯一。

### 4. 提取与重解析流程

当 `project.series_id is null` 时：

- 沿用当前 `project` 级提取逻辑

当 `project.series_id is not null` 时：

1. LLM 解析出候选角色列表
2. 读取该系列下已有角色主档
3. 对每个候选角色执行匹配：
   - 精确匹配 `canonical_name`
   - 别名匹配 `aliases_json`
   - 归一化名称匹配
   - 描述相似度规则匹配
4. 如果命中高置信角色：
   - 创建或更新 `project_character_links`
   - 不创建新的 `project` 角色
5. 如果未命中：
   - 创建新的系列角色主档
   - 创建对应 `project_character_links`
   - 视置信度标为 `confirmed_new` 或 `pending_review`

### 5. 覆盖边界

系列项目允许的分集覆盖应限定在展示级或场景化信息：

- `display_name`
- `episode_costume`
- `episode_state`
- `episode_notes`

不允许通过分集覆盖修改系列主档核心字段：

- `canonical_name`
- 主描述
- 主形象图
- 系列主语音配置
- 系列主身份字段

### 6. 分镜与下游引用

系列项目中的分镜帧 `character_ids` 最终应统一引用系列角色主档 ID，而不是历史的分集级角色 ID。这样角色图生成、语音绑定、视频任务与时间轴引用才能落在统一身份上。

本次改造允许过渡兼容，但新链路必须优先写入统一后的系列角色 ID。

## 接口与服务边界

### 后端

当前 `ProjectService.reparse_project(...)` 和 `ProjectCommandService.sync_entities(...)` 只适合独立项目，不适合作为系列项目的最终实体真源写入入口。

建议新增：

- `ProjectCharacterLinkRepository`
- `SeriesEntityResolutionService`
- `ProjectSeriesCastingService`

职责：

- `ProjectCharacterLinkRepository`
  - 负责系列项目角色 link 的查询、同步、软删除
- `SeriesEntityResolutionService`
  - 负责候选角色与系列主档的匹配、创建与状态判定
- `ProjectSeriesCastingService`
  - 负责把一次提取结果同步为“系列主档 + 分集 link”

### 前端

- 系列项目页的角色列表改为读取“series character + project link”组合视图
- 系列详情页继续展示角色主档
- 当匹配结果存在中低置信度时，在 Studio 中提供待确认入口

## 落地阶段

### Phase 1: 新链路先正确

- 建立 `project_character_links`
- 系列项目的 `reparse` 切到“系列主档 + 分集 link”
- 系列项目不再新建 `owner_type="project"` 的角色

### Phase 2: 读路径切换

- 系列项目页面改读 link 视图
- 系列项目分镜与下游任务优先引用系列角色 ID

### Phase 3: 历史数据迁移

- 扫描同系列下多个项目的重复角色
- 生成候选合并组
- 用户确认后改写引用并软删旧项目角色

## 风险与注意事项

- 历史分镜帧、视频任务与角色素材引用必须评估是否需要同步迁移
- 不能仅新增 link 表而保留 project 级角色继续作为系列项目真源，否则会变成双轨模型
- 匹配逻辑第一版应保守，优先高置信自动绑定，避免误合并
- 所有新表和新查询必须继续遵守 `organization_id/workspace_id` 多租户边界

## 成功标准

- 同一系列中重复提取同名角色时，不再创建多个 project 级角色实体
- 系列项目的角色列表来自系列主档引用，而不是 project 自有完整角色
- 新系列角色只在未命中现有主档时创建
- 系列项目分镜和后续素材链路可以稳定引用统一角色 ID
