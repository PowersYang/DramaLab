# 剧集级美术设定最终方案

## 背景

DramaLab 当前同时存在两套美术设定心智：

- 项目制作页把“美术设定”作为主流程步骤，用户容易把单集制作中的风格选择当作全局标准。
- 数据层与任务层又已经开始支持 `Series.art_direction`，说明系统已经具备剧集级视觉主档的落点。

这会导致三个长期问题：

1. 同一剧集的角色、场景、道具、分镜和视频容易发生视觉漂移。
2. 项目级 `style_preset/style_prompt` 与 `art_direction` 并存，形成双真源。
3. 任务执行时很难解释“本次生成到底使用了哪一层风格配置”。

本方案定义 DramaLab 的最终目标形态，不包含旧方案兼容过渡设计。

## 最终决策

DramaLab 的美术设定采用以下层级：

- 工作区风格库：沉淀可复用风格模板。
- 剧集美术主档：`Series` 维度的唯一默认真源。
- 项目美术覆写：`Project` 维度的显式差异层，默认不生效，只有用户明确覆写后才持久化。
- 任务执行快照：每次异步任务在入队时解析并记录本次实际使用的美术配置。

核心原则如下：

1. 剧集层负责制定视觉标准。
2. 项目层负责执行剧集标准，并允许有限的显式偏离。
3. 没有显式覆写时，项目不得再保存独立的美术主档。
4. 所有生成任务都必须可追踪到本次实际生效的美术配置。

## 产品目标

### 目标

- 让同一剧集下所有分集默认共享一套稳定视觉世界观。
- 让项目页回归“生产执行”角色，而不是“标准制定”角色。
- 保留单集特殊需求，例如回忆、梦境、番外、试播样片等场景的局部覆写能力。
- 为后续资产一致性检查、批量重生成建议、任务审计提供稳定基础。

### 非目标

- 不在本次方案中设计旧数据迁移流程。
- 不在本次方案中引入复杂版本回滚系统。
- 不在本次方案中扩展新的风格分析模型能力。

## 信息架构

### 工作区层

工作区已有的“美术风格策略”页继续保留，职责明确为风格资源台账：

- 管理系统预设与用户自定义风格。
- 提供风格模板检索、编辑、沉淀。
- 不直接承担某个剧集的最终官方视觉标准。

### 剧集层

剧集详情页新增并固定“美术设定”主入口，定位为剧集视觉圣经：

- 选择基础风格模板。
- 编辑剧集官方正向/负向提示词。
- 配置参考图、视觉关键词、禁用项、适用范围。
- 查看当前所有分集是否继承或偏离剧集标准。

剧集层是默认真源，所有属于该剧集的项目都从这里解析默认美术配置。

### 项目层

项目制作页不再保留“美术设定”作为主流程步骤，改为：

- 删除 `art_direction` 主步骤。
- 在项目制作页头部或右侧提供“美术来源”状态卡。
- 展示当前项目是否继承剧集、是否存在项目覆写、是否偏离剧集。
- 提供“查看剧集设定”“创建项目覆写”“重置为剧集设定”入口。

项目页的重点改为执行和感知，不再承担主设定编辑职责。

## 用户心智与状态模型

每个项目的美术来源只有三种状态：

1. `series_default`
   - 默认状态。
   - 项目完全继承剧集美术主档。
   - 项目上不保存独立主档内容。

2. `project_override`
   - 用户明确发起“本项目局部覆写”后进入该状态。
   - 项目只保存差异字段，而不是复制一整份剧集主档。
   - UI 必须持续显示“已偏离剧集设定”。

3. `standalone`
   - 仅允许无 `series_id` 的独立项目使用。
   - 独立项目仍可使用 `Project.art_direction` 作为主档。

同一项目不可同时拥有“继承剧集”和“项目完整主档”两种真源。

## 数据模型

### Series

`Series.art_direction` 升级为剧集官方美术主档，作为该剧集的默认视觉真源。

新增字段：

- `art_direction_updated_at`
- `art_direction_updated_by`

字段语义：

- `art_direction.style_config` 表示当前剧集官方选定风格。
- `art_direction.ai_recommendations` 仅作为推荐记录，不参与任务真源解析。
- `art_direction.custom_styles` 不再作为剧集主档长期真源的一部分，风格资源仍优先沉淀到工作区风格库。

### Project

`Project` 引入显式的美术来源元信息：

- `art_direction_source: "standalone" | "series_default" | "project_override"`
- `art_direction_override: dict | null`
- `art_direction_resolved: dict | null`
- `art_direction_overridden_at`
- `art_direction_overridden_by`

字段语义：

- `art_direction_source`
  - 独立项目默认是 `standalone`
  - 挂到剧集下的项目默认是 `series_default`
- `art_direction_override`
  - 只保存项目相对剧集的差异字段
  - 不复制整份剧集主档
- `art_direction_resolved`
  - 作为后端返回给前端的解析后结果缓存
  - 内容来自 `series.art_direction + override patch`

`Project.art_direction` 保留，但语义调整为：

- 对独立项目：仍是主档。
- 对剧集项目：API 返回时可映射为解析后的结果，避免前端大量重写；数据库真源不再依赖它。

### 旧字段收口

项目级以下字段退出主流程真源：

- `style_preset`
- `style_prompt`

最终状态要求：

- 新流程不再写入这两个字段作为主设定。
- 任务解析优先基于 `resolved art direction`，而不是直接读取 `style_preset/style_prompt`。

## 核心接口设计

### 剧集层接口

新增或调整以下接口：

- `GET /series/{series_id}/art-direction`
  - 返回剧集美术主档。
- `PUT /series/{series_id}/art-direction`
  - 更新剧集美术主档。
- `GET /series/{series_id}/art-direction/projects`
  - 返回该剧集下各项目的美术来源状态与偏离摘要。

### 项目层接口

新增或调整以下接口：

- `GET /projects/{project_id}/art-direction`
  - 返回项目当前解析后的有效美术配置。
  - 对剧集项目返回：
    - `source`
    - `inherits_series`
    - `is_overridden`
    - `series_art_direction`
    - `project_override`
    - `resolved_art_direction`
- `PUT /projects/{project_id}/art-direction/override`
  - 创建或更新项目级覆写。
- `DELETE /projects/{project_id}/art-direction/override`
  - 清空项目覆写，恢复为剧集默认。

废弃以下项目主入口语义：

- `POST /projects/{script_id}/art_direction/save`
  - 不再直接理解为“保存项目主美术设定”。
  - 若项目属于剧集，默认应改走 override 接口。
  - 若项目不属于剧集，可视为 standalone 保存。

### 返回契约

前端所有需要展示当前风格的页面与组件，都应优先消费统一结构：

- `source`
- `resolved_art_direction`
- `series_art_direction`
- `project_override`
- `is_dirty_from_series`

前端不得再自行猜测当前项目是继承还是覆写。

## 任务链路改造

### 任务入队

所有素材生成、分镜生成、视频生成相关任务，在入队前统一解析有效美术配置。

解析顺序：

1. 若项目无 `series_id`，使用项目独立主档。
2. 若项目属于剧集且 `art_direction_source=series_default`，使用剧集主档。
3. 若项目属于剧集且 `art_direction_source=project_override`，使用剧集主档与项目 override 合并后的结果。
4. 若本次请求带临时任务参数，仅作为本次任务局部参数覆盖，但不回写主档。

### 任务 payload

任务 payload 不再以 `style_preset/style_prompt` 作为主语义，而是写入：

- `art_direction_source`
- `resolved_style_config`
- `style_resolution_scope`

允许额外保留：

- `style_preset`
- `style_prompt`

但只作为向下兼容字段，不作为任务执行主真源。

### 任务审计

每个任务最终应能回答：

- 本任务使用的是剧集设定还是项目覆写。
- 本任务解析后的正向/负向提示词是什么。
- 本任务是否使用了临时任务级覆盖。

这为后续计费、问题排查、重生成建议提供依据。

## 前端改造方案

### 项目制作页

对 `ProjectClient` 做如下调整：

- 删除 `art_direction` 作为独立生产步骤。
- 侧边主流程从
  - 剧本处理 -> 美术设定 -> 资产制作 ...
  调整为
  - 剧本处理 -> 资产制作 -> 分镜设计 -> 视频生成 -> 视频组装 -> 配音制作 -> 最终混剪 -> 导出成片
- 在项目页顶层增加“美术来源卡”：
  - 当前来源：继承剧集 / 项目覆写 / 独立项目
  - 当前生效风格名称
  - 是否偏离剧集
  - 操作按钮：查看剧集设定、创建覆写、恢复继承

### 剧集页

剧集详情新增“美术设定”面板：

- 选择剧集官方风格模板。
- 编辑剧集主提示词。
- 查看引用该剧集的项目状态。
- 标记哪些项目已覆写、哪些项目仍继承。

### 组件职责

现有 `frontend/src/components/modules/ArtDirection.tsx` 需要拆分为两个职责明确的组件：

- `SeriesArtDirectionEditor`
  - 剧集主档编辑器
- `ProjectArtDirectionOverridePanel`
  - 项目级覆写管理面板

不得继续让同一个组件既承担项目主档编辑，又承担风格库交互。

### Store 设计

`projectStore` 与 `series` 状态增加以下结构：

- `currentProject.art_direction_source`
- `currentProject.art_direction_override`
- `currentProject.resolved_art_direction`
- `currentSeries.art_direction`

前端默认使用 `resolved_art_direction` 参与展示与下游生成调用。

## 后端服务设计

新增一个聚焦职责的服务：

- `ArtDirectionResolutionService`

职责如下：

1. 解析项目当前生效的美术配置。
2. 校验项目是否允许保存 override。
3. 负责剧集主档与项目 patch 的合并。
4. 为任务服务输出标准化的 resolved 结果。

现有服务职责调整：

- `SystemService`
  - 继续管理风格预设、用户风格库、分析能力。
- `SeriesService`
  - 管理剧集美术主档读写。
- `ProjectService`
  - 不再直接承担项目美术主档的长期真源写入。
- `AssetWorkflow`
  - 不再自己推断风格来源，只消费已解析结果。

## 解析与合并规则

项目 override 采用 patch 语义，而不是整对象替换。

合并规则：

1. `series.art_direction` 作为 base。
2. `project.art_direction_override` 仅覆盖允许覆写的字段。
3. 未允许覆写的字段继续继承剧集。

允许覆写字段：

- `style_config.name`
- `style_config.description`
- `style_config.positive_prompt`
- `style_config.negative_prompt`

不允许在项目 override 中长期持久化的字段：

- `ai_recommendations`
- `custom_styles`

原因：

- `ai_recommendations` 属于推荐过程产物，不是视觉真源。
- `custom_styles` 属于风格库资源，不是项目状态。

## 权限与边界

剧集层美术主档修改必须经过剧集所在工作区权限校验。

项目覆写必须满足：

- 项目与所属剧集在同一工作区。
- 当前用户具备项目编辑能力。

任何读取解析后美术配置的接口，都必须在 `workspace_id` 边界内执行。

## 验证要求

### 后端

至少补以下测试：

- `ArtDirectionResolutionService`
  - 独立项目解析
  - 剧集继承解析
  - 项目 override 合并解析
- 剧集美术主档 API
- 项目 override API
- 任务入队时的 resolved payload 写入

### 前端

至少补以下测试：

- 项目页不再展示主流程“美术设定”步骤。
- 项目页正确显示来源状态。
- 创建项目 override 后显示“已偏离剧集”。
- 重置 override 后恢复“继承剧集”。

## 实施顺序

1. 后端补充 art direction source / override / resolved 数据结构与解析服务。
2. 后端新增剧集主档和项目 override 接口。
3. 任务入队统一接入 resolved art direction。
4. 前端移除项目主流程中的“美术设定”步骤。
5. 前端增加剧集主档编辑器与项目覆写面板。
6. 前后端测试补齐并验证。

## 验收标准

满足以下条件才算方案完成：

1. 剧集项目默认继承 `Series.art_direction`。
2. 项目页不再作为主设定入口。
3. 项目可以显式创建 override，并清晰显示“已偏离剧集”。
4. 所有生成任务都能读取统一解析后的美术配置。
5. 新流程不再依赖项目级 `style_preset/style_prompt` 作为真源。
6. 前端和后端都能明确回答“当前项目正在使用哪一层美术设定”。
