# DramaLab 算力豆扣费规则调研与设计说明

## 1. 文档目标

本文档用于系统整理 DramaLab 当前异步任务的扣费规则设计，重点回答以下问题：

- 当前项目里到底有哪些异步任务。
- 对每一类异步任务来说，哪些参数会显著影响真实成本。
- 哪些结论来自当前仓库代码，哪些来自模型厂商官方规则，哪些属于结合行业惯例做出的工程推断。
- 现有“按任务类型固定扣费”的方案为什么不够用。
- 下一版算力豆计费模型应该如何重构，才能兼顾：
  - 商业化可运营
  - 前后端可实现
  - 分布式部署下状态一致
  - 后续接入新模型时可扩展

本文档默认面向产品、运营、后端和前端共同阅读，因此会同时包含业务视角和工程视角。

## 2. 当前结论摘要

### 2.1 核心结论

当前项目已经不适合继续使用“`task_type -> 固定算力豆`”的单维定价方式。

原因很明确：

- 文本类任务真实成本主要取决于输入和输出 token 数，不只取决于任务名称。
- 生图类任务真实成本至少与生成张数有关，通常还与模型档位有关。
- 生视频类任务真实成本至少与生成条数、时长、分辨率、模型档位有关。
- 语音类任务真实成本通常与字符数或音频时长有关。
- `generate_all`、`generate_project`、`generate_batch` 这类任务本质上是编排任务，不是单次模型调用任务，其真实成本来自内部展开后的多个子任务。

### 2.2 推荐方向

下一版扣费规则应从“固定价”升级为“任务类型 + 计费模式 + 参数维度”的组合模型。

建议支持的计费模式：

- `fixed`：固定价
- `per_token`：按 token 计费
- `per_image`：按张计费
- `per_video_second`：按视频秒数计费
- `per_character`：按字符数计费
- `aggregate_children`：按内部子任务汇总计费

### 2.3 推荐优先级

第一阶段优先把下面这些参数纳入计费：

- 生图：`batch_size`、`model_name`
- 生视频：`batch_size`、`duration`、`resolution`、`model`、`generation_mode`
- 配音：`text_length` 或 `char_count`
- 文本：`input_tokens`、`output_tokens`
- 编排任务：按内部真实生成量汇总

第一阶段不建议就纳入计费的参数：

- `seed`
- `negative_prompt`
- `prompt_extend`
- `movement_amplitude`
- `cfg_scale`
- `shot_type`

这些参数目前更像效果控制参数，而不是稳定、统一、可解释的成本参数。

## 3. 调研依据

### 3.1 仓库代码依据

本次梳理重点参考了以下代码位置：

- 异步任务枚举：
  - `backend/src/schemas/task_models.py`
- 任务标签和平台可配置任务类型：
  - `backend/src/application/services/task_concurrency_service.py`
- 当前计费逻辑：
  - `backend/src/application/services/billing_service.py`
  - `backend/src/repository/billing_pricing_rule_repository.py`
- 模型目录及能力参数：
  - `backend/src/application/services/model_provider_service.py`
- 典型任务 API 入参：
  - `backend/src/api/asset.py`
  - `backend/src/api/media.py`
  - `backend/src/api/storyboard.py`
  - `backend/src/api/project.py`
  - `backend/src/api/series.py`
  - `backend/src/api/system.py`
- 工作流与执行逻辑：
  - `backend/src/application/workflows/asset_workflow.py`
  - `backend/src/application/workflows/storyboard_workflow.py`
  - `backend/src/application/workflows/media_workflow.py`
  - `backend/src/application/services/video_task_service.py`

### 3.2 外部官方口径

以下官方资料主要用于确认“真实成本通常由哪些参数决定”：

- 阿里云百炼模型价格页：
  - <https://help.aliyun.com/zh/model-studio/models>
- Vidu 官方 API 文档：
  - Image To Video: <https://docs.platform.vidu.com/334342150e0>
  - Reference To Video: <https://docs.platform.vidu.com/334378351e0>

### 3.3 口径说明

本文档里会显式区分三种结论：

- `代码确认`：可以直接从当前仓库代码确认。
- `官方确认`：可以从模型厂商官方文档确认。
- `工程推断`：基于代码、官方能力面板和行业惯例推导，当前没有看到统一公开价目表。

## 4. 当前系统中的异步任务清单

根据 `backend/src/schemas/task_models.py`，当前异步任务包括：

- `project.reparse`
- `project.sync_descriptions`
- `series.assets.import`
- `series.import.confirm`
- `series.import.preview`
- `storyboard.refine_prompt`
- `video.polish_prompt`
- `video.polish_r2v_prompt`
- `video.generate.project`
- `video.generate.frame`
- `video.generate.asset`
- `audio.generate.project`
- `audio.generate.line`
- `mix.generate.sfx`
- `mix.generate.bgm`
- `media.merge`
- `project.export`
- `storyboard.analyze`
- `storyboard.render`
- `storyboard.generate_all`
- `asset.generate`
- `asset.generate_batch`
- `asset.motion_ref.generate`
- `series.asset.generate`
- `art_direction.analyze`

## 5. 当前计费实现的局限

### 5.1 当前实现方式

当前后端扣费逻辑位于 `backend/src/application/services/billing_service.py` 的 `charge_task_submission(...)`。

当前逻辑特点：

- 只按 `job.task_type` 查一条生效中的价格规则。
- 价格字段只有 `price_credits`。
- 扣费时不读取具体任务参数。
- 同一个 `task_type` 下，无论调用参数怎么变化，扣费都一样。

### 5.2 当前方案存在的问题

#### 问题 1：同类任务成本差异被抹平

例如：

- 生图生成 1 张和 4 张，现在如果都算 50 豆，就不合理。
- 生成 5 秒 480P 视频和 15 秒 1080P 视频，如果都算 200 豆，也不合理。

#### 问题 2：项目级任务无法公平定价

例如：

- `storyboard.generate_all`
- `asset.generate_batch`
- `video.generate.project`
- `audio.generate.project`

这些任务的真实资源消耗取决于：

- 项目里有多少角色、场景、道具
- 有多少分镜
- 每个分镜是否有对白
- 每个分镜的视频时长和分辨率

如果仍然给它们一个固定价，最终要么亏损，要么严重高估。

#### 问题 3：难以对齐模型厂商成本

主流模型厂商的成本单位通常是：

- token
- 每张图
- 每秒视频
- 每千字符语音

而不是“某个业务动作统一一口价”。

#### 问题 4：前端预计扣费也会失真

如果前端要展示“预计消耗 xx 算力豆”，而后端规则仍只有固定价，就无法准确告诉用户：

- 多张图为什么更贵
- 更长视频为什么更贵
- 更高分辨率为什么更贵

## 6. 按任务类型重新梳理成本影响因素

下面这部分是本文档最核心的内容。

---

## 7. 文本分析与提示词类任务

### 7.1 涉及任务

- `project.reparse`
- `project.sync_descriptions`
- `storyboard.analyze`
- `storyboard.refine_prompt`
- `video.polish_prompt`
- `video.polish_r2v_prompt`
- `art_direction.analyze`
- `series.import.preview`

### 7.2 当前代码特征

`代码确认`

这类任务主要经过文本处理 provider：

- `backend/src/providers/text/script_processor.py`
- `backend/src/providers/text/llm_adapter.py`

这些任务通常都会把较长文本、角色信息、场景信息、历史提示词等一并送给大模型。

### 7.3 影响成本的主要参数

- 输入文本长度
- 输出文本长度
- 使用的模型档位
- 是否附带较长的上下文素材信息

### 7.4 官方口径

`官方确认`

阿里云百炼文本模型按 Token 计费，且输入、输出价格可能不同。  
这说明文本类任务的真实成本核心不是“任务类型”，而是“消耗了多少 token”。

参考：

- <https://help.aliyun.com/zh/model-studio/models>

### 7.5 推荐计费方式

推荐使用 `per_token`。

建议公式：

```text
credits = ceil((input_tokens * input_rate + output_tokens * output_rate) / credit_unit_value)
```

如果一期不想立即打通真实 token 统计，也可以先做一个过渡版：

- 小于 2k token：低档
- 2k 到 8k token：中档
- 大于 8k token：高档

即：

```text
small / medium / large token bucket
```

### 7.6 推荐业务规则

- `storyboard.refine_prompt`
  - 可先按低档文本任务计费
- `video.polish_prompt`
  - 可先按低档或中档文本任务计费
- `storyboard.analyze`
  - 建议按剧本长度分档计费
- `project.reparse`
  - 建议按剧本长度分档计费
- `art_direction.analyze`
  - 建议按输入文本长度分档计费

---

## 8. 生图类任务

### 8.1 涉及任务

- `asset.generate`
- `series.asset.generate`
- `storyboard.render`
- `asset.generate_batch`
- `storyboard.generate_all`

### 8.2 当前代码特征

`代码确认`

生图相关接口里已经明确暴露出这些参数：

- `batch_size`
- `model_name`
- `generation_type`
- `reference_image_url`
- `composition_data`
- 画面尺寸或宽高比

其中最关键的是：

- `batch_size`
- `model_name`

因为：

- 在 `asset.generate` 和 `series.asset.generate` 中，`batch_size` 决定一次生成几张图。
- 在 `storyboard.render` 中，`batch_size` 也决定单次渲染生成几张候选图。
- `storyboard.generate_all` 和 `asset.generate_batch` 则会展开为多个具体素材或多个具体分镜的生成动作。

### 8.3 影响成本的主要参数

- 生成张数 `batch_size`
- 模型档位 `model_name`
- 是否是文生图 / 图生图
- 分辨率或尺寸档位
- 是否采用高质量模式

### 8.4 官方口径

`官方确认`

阿里云百炼的图像模型价格口径是“按张计费”，不同模型每张价格不同。  
这非常适合映射到平台的“每张图对应若干算力豆”。

参考：

- <https://help.aliyun.com/zh/model-studio/models>

### 8.5 推荐计费方式

推荐使用 `per_image`。

建议基础公式：

```text
credits = image_count × unit_price(model_tier, generation_mode, size_bucket)
```

其中：

- `image_count = batch_size`
- `model_tier` 可区分：
  - 标准
  - 高质量
  - 极速
- `generation_mode` 可区分：
  - `t2i`
  - `i2i`
- `size_bucket` 一期可以先不纳入，后续有必要再加

### 8.6 推荐平台规则

#### 单资产生成

- `asset.generate`
- `series.asset.generate`

建议：

- 基础计费单位：1 张
- 实际扣费：`batch_size × 模型单价`

#### 单分镜渲染

- `storyboard.render`

建议：

- 基础计费单位：1 张
- 实际扣费：`batch_size × 分镜渲染模型单价`

#### 批量资产生成

- `asset.generate_batch`

建议：

- 不要配置固定价
- 应按内部实际生成的角色、场景、道具总数，再乘各自 `batch_size`

#### 批量分镜生成

- `storyboard.generate_all`

建议：

- 不要配置固定价
- 应按内部待生成分镜数量 × 每帧生成张数汇总

---

## 9. 视频生成类任务

### 9.1 涉及任务

- `asset.motion_ref.generate`
- `video.generate.frame`
- `video.generate.asset`
- `video.generate.project`

### 9.2 当前代码特征

`代码确认`

当前仓库中，视频生成相关参数已经非常完整，主要包括：

- `batch_size`
- `duration`
- `resolution`
- `generate_audio`
- `audio_url`
- `prompt_extend`
- `negative_prompt`
- `model`
- `shot_type`
- `generation_mode`
- `reference_video_urls`
- `mode`（Kling）
- `sound`（Kling）
- `cfg_scale`（Kling）
- `vidu_audio`（Vidu）
- `movement_amplitude`（Vidu）

这些参数可以从以下位置确认：

- `backend/src/api/asset.py`
- `backend/src/api/media.py`
- `backend/src/application/services/video_task_service.py`
- `backend/src/application/services/model_provider_service.py`

此外，`VideoTask` 模型里也已经显式保存了：

- `duration`
- `resolution`
- `generate_audio`
- `audio_url`
- `model`
- `generation_mode`

### 9.3 影响成本的主要参数

#### 一级参数

这些参数建议第一阶段就直接纳入扣费：

- 视频条数 `batch_size`
- 视频时长 `duration`
- 视频分辨率 `resolution`
- 模型档位 `model`
- 生成模式 `generation_mode`

#### 二级参数

这些参数当前建议只保留在快照中，先不直接计费：

- `prompt_extend`
- `negative_prompt`
- `shot_type`
- `sound`
- `cfg_scale`
- `movement_amplitude`
- `seed`

### 9.4 官方口径

#### 阿里云百炼

`官方确认`

阿里云百炼的视频模型明确按“秒数 + 分辨率”计费。  
这和我们的视频计费设计高度一致。

参考：

- <https://help.aliyun.com/zh/model-studio/models>

#### Vidu

`官方确认 + 工程推断`

Vidu 官方 API 文档中，请求参数里明确包含：

- `duration`
- `resolution`
- `movement_amplitude`

而响应结构中包含 `credits` 字段。  
这说明 Vidu 至少在平台层面已经把“本次调用消耗 credits”作为一等结果返回。

参考：

- <https://docs.platform.vidu.com/334342150e0>
- <https://docs.platform.vidu.com/334378351e0>

严格来说，文档没有在本次调研中拿到一张完整“公开单价矩阵”，因此：

- “时长和分辨率影响成本”属于官方确认
- “动作幅度等参数是否稳定影响 credits”当前仍偏工程推断

#### Kling

`工程推断`

当前仓库里 Kling 接入已经支持：

- `duration`
- `mode`
- `sound`
- `cfg_scale`

但本次没有拿到一个稳定可引用的公开官方价目表。  
因此 Kling 相关扣费规则建议先按平台统一口径设计，再通过后续真实成本数据校准。

### 9.5 推荐计费方式

推荐使用 `per_video_second`。

建议公式：

```text
credits = video_count × duration_seconds × resolution_factor × model_factor × mode_factor
```

更适合运营配置的写法是：

```text
credits = video_count × duration_seconds × unit_price(model, resolution, generation_mode)
```

其中：

- `video_count = batch_size`
- `duration_seconds = duration`
- `unit_price(...)` 从规则表中读取

### 9.6 推荐平台规则

#### 单帧/单素材视频生成

- `video.generate.frame`
- `video.generate.asset`
- `asset.motion_ref.generate`

建议至少按以下维度组合定价：

- `model`
- `generation_mode`
- `resolution`
- `duration`

#### 项目级视频生成

- `video.generate.project`

建议：

- 不配置固定价
- 应按项目内所有待生成视频条目汇总计费

也就是：

```text
sum(each_video_cost)
```

### 9.7 推荐的最小视频定价矩阵

第一阶段可以先把矩阵收敛到：

- 模型档位：
  - 标准
  - 高质量
  - 极速
- 生成模式：
  - `i2v`
  - `r2v`
- 分辨率：
  - `480p`
  - `720p`
  - `1080p`

而不是一上来就把每个具体模型都配成一整张大表。

---

## 10. 音频与语音类任务

### 10.1 涉及任务

- `audio.generate.line`
- `audio.generate.project`
- `mix.generate.sfx`
- `mix.generate.bgm`

### 10.2 当前代码特征

`代码确认`

当前音频工作流里：

- `audio.generate.line` 会针对单个分镜台词生成对白音频。
- `audio.generate.project` 会遍历项目所有分镜，生成对白、音效和背景音乐。
- `mix.generate.sfx` 和 `mix.generate.bgm` 也属于音频生成链路中的独立任务。

### 10.3 影响成本的主要参数

#### 对白生成

- 台词字符数
- 音色/模型档位
- 是否使用更高质量语音模型

#### SFX / BGM

- 提示词长度
- 生成段数
- 目标时长

当前代码里这部分还没有形成足够统一、透明的模型参数面板，所以第一阶段建议先聚焦对白生成。

### 10.4 官方口径

`官方确认`

阿里云百炼的 TTS 计费通常按字符数计费。  
这和“对白越长越贵”的直觉完全一致，也比固定价更好向用户解释。

参考：

- <https://help.aliyun.com/zh/model-studio/models>

### 10.5 推荐计费方式

#### 对白生成

推荐使用 `per_character`。

公式：

```text
credits = ceil(char_count / 1000 × unit_price(voice_model))
```

#### 项目级音频生成

`audio.generate.project` 不建议固定价。  
应按内部真实对白字符总量、SFX 生成数、BGM 生成数汇总。

#### SFX / BGM

第一阶段建议：

- `mix.generate.sfx`：固定低价或按段数计费
- `mix.generate.bgm`：固定低价

等后续真正接入稳定的云音频模型成本后，再进一步细化。

---

## 11. 合成与导出类任务

### 11.1 涉及任务

- `media.merge`
- `project.export`

### 11.2 当前代码特征

`代码确认`

当前这两类任务更多是本地或服务端 FFmpeg / 导出逻辑：

- `media.merge`：把已有视频片段合并
- `project.export`：当前仍主要回退到 merge

这类任务当前不是直接调用高成本模型推理。

### 11.3 影响成本的主要参数

- 成片时长
- 输出分辨率
- 字幕、音轨、混音复杂度
- 片段数量

### 11.4 推荐计费方式

第一阶段建议：

- `media.merge`：0 豆或极低固定价
- `project.export`：0 豆或极低固定价

原因：

- 当前主要消耗的是平台算力和磁盘 IO，不是模型推理成本
- 如果现在对它们高价收费，用户感知会比较差
- 等真正切到云转码或更高成本导出能力，再升级规则

---

## 12. 导入与确认类任务

### 12.1 涉及任务

- `series.assets.import`
- `series.import.confirm`
- `series.import.preview`

### 12.2 推荐计费方式

第一阶段建议：

- `series.import.preview`：如果包含明显 LLM 分析，可按低档文本任务计费
- `series.assets.import`
- `series.import.confirm`

后两者建议先 0 豆或低固定价，因为它们更偏平台数据处理，不是高成本推理。

---

## 13. 建议的新版任务分组

为了让运营页面更可理解，不建议直接对 20 多个任务类型逐个配置复杂规则。  
建议在规则层面先抽象成以下业务分组：

### 13.1 文本推理组

- `project.reparse`
- `project.sync_descriptions`
- `storyboard.analyze`
- `storyboard.refine_prompt`
- `video.polish_prompt`
- `video.polish_r2v_prompt`
- `art_direction.analyze`
- `series.import.preview`

### 13.2 图像生成组

- `asset.generate`
- `series.asset.generate`
- `storyboard.render`

### 13.3 图像批量编排组

- `asset.generate_batch`
- `storyboard.generate_all`

### 13.4 视频生成组

- `asset.motion_ref.generate`
- `video.generate.frame`
- `video.generate.asset`

### 13.5 视频批量编排组

- `video.generate.project`

### 13.6 音频生成组

- `audio.generate.line`
- `mix.generate.sfx`
- `mix.generate.bgm`

### 13.7 音频批量编排组

- `audio.generate.project`

### 13.8 平台处理组

- `media.merge`
- `project.export`
- `series.assets.import`
- `series.import.confirm`

## 14. 推荐的最终扣费规则矩阵

下面给出推荐规则矩阵。

| 任务组 | 推荐 charge_mode | 必选计费参数 | 可选后续参数 | 第一阶段建议 |
|---|---|---|---|---|
| 文本推理组 | `per_token` | `input_tokens` `output_tokens` `model` | 上下文素材量 | 先做 token 分档也可 |
| 图像生成组 | `per_image` | `batch_size` `model` | `size` `generation_mode` | 第一阶段就应上线 |
| 图像批量编排组 | `aggregate_children` | 子任务总张数 | 模型混用 | 不要固定价 |
| 视频生成组 | `per_video_second` | `batch_size` `duration` `resolution` `model` `generation_mode` | `audio` `mode` | 第一阶段就应上线 |
| 视频批量编排组 | `aggregate_children` | 子任务汇总成本 | 项目层修正系数 | 不要固定价 |
| 音频生成组 | `per_character` | `char_count` `model` | 音色克隆、时长 | 第一阶段先覆盖对白 |
| 音频批量编排组 | `aggregate_children` | 子任务汇总成本 | 项目折扣 | 不要固定价 |
| 平台处理组 | `fixed` 或 `free` | 无 | 时长、分辨率 | 一期宜低价或免费 |

## 15. 编排型任务的定价原则

这是非常关键的一点。

以下任务不建议继续给单独固定价：

- `asset.generate_batch`
- `storyboard.generate_all`
- `video.generate.project`
- `audio.generate.project`

原因是这些任务只是入口动作，不是成本原子。

### 15.1 推荐做法

方案 A：提交前预估后一次性扣费

- 根据当前项目状态，先算出内部会生成多少张图、多少段视频、多少段音频
- 预估总成本
- 提交前一次性扣除

方案 B：拆成子任务逐个扣费

- 父任务本身不扣费
- 内部创建的实际子任务逐个扣费

### 15.2 推荐选型

从当前项目实现和分布式一致性角度看，更推荐方案 A。

原因：

- 用户体验更清晰，提交前就知道要花多少豆
- 更容易做“余额不足禁止提交”
- 更容易和当前任务提交入口对齐
- 不容易出现父任务进了一半、子任务扣一半的体验混乱

### 15.3 实现注意点

如果采用方案 A，必须把“预估明细快照”写入任务或流水中，便于后续审计：

- 预计生成几张图
- 预计生成几段视频
- 每段视频的时长、分辨率、模型
- 预估总费用

## 16. 算力豆单位设计建议

### 16.1 当前问题

当前产品规则是：

- 1 元 = 10 算力豆
- 算力豆余额最低为 0

如果账本底层只支持整数豆，会遇到一个现实问题：

- 厂商很多价格不是 0.1 元、0.2 元这种刚好整除的值
- 换算成豆以后经常会出现 1.4 豆、2.7 豆、4.8 豆

### 16.2 推荐方案

建议把账本底层单位改成“更细粒度的内部单位”，而不是直接存整数豆。

例如：

- UI 显示单位仍然叫“算力豆”
- 数据库存储单位改成 `credit_units`
- 定义 `1 算力豆 = 10 credit_units`

这样：

- 1.4 豆可以存成 14 units
- 2.7 豆可以存成 27 units

### 16.3 为什么这很重要

- 更容易对齐厂商真实成本
- 更容易做促销、折扣、赠送
- 更容易避免反复四舍五入导致的利润损失

## 17. 前端展示建议

前端如果要展示“预计消耗”，建议直接展示“构成明细”，而不是只显示总数。

### 17.1 生图

示例：

```text
预计消耗 12 算力豆
构成：3 张图片 × 4 豆/张
```

### 17.2 生视频

示例：

```text
预计消耗 96 算力豆
构成：2 条视频 × 8 秒 × 6 豆/秒（720p，标准模型）
```

### 17.3 编排任务

示例：

```text
预计消耗 148 算力豆
构成：
- 分镜渲染 12 张
- 视频生成 4 条 × 5 秒
- 台词配音 860 字
```

这会显著降低用户对扣费的不信任感。

## 18. 数据结构改造建议

为了支持参数化计费，现有 `billing_pricing_rules` 需要升级。

### 18.1 当前表结构问题

当前规则核心字段只有：

- `task_type`
- `charge_mode`
- `price_credits`

这不够表达：

- “按张”
- “按秒”
- “按 token”
- “按字符”
- “按模型 + 分辨率 + 时长”

### 18.2 推荐新增字段

建议扩展为下面这些字段：

- `task_type`
- `scope_type`
- `organization_id`
- `charge_mode`
- `base_price_units`
- `pricing_dimensions_json`
- `estimation_strategy`
- `status`
- `effective_from`
- `effective_to`
- `description`

### 18.3 推荐字段含义

#### `charge_mode`

枚举建议：

- `fixed`
- `per_token`
- `per_image`
- `per_video_second`
- `per_character`
- `aggregate_children`

#### `base_price_units`

表示最小内部计费单位，建议用更细粒度单位而不是直接豆。

#### `pricing_dimensions_json`

示例：

```json
{
  "model_tiers": {
    "standard": 10,
    "pro": 16,
    "flash": 6
  },
  "resolution_factors": {
    "480p": 1.0,
    "720p": 2.0,
    "1080p": 4.8
  },
  "generation_mode_factors": {
    "i2v": 1.0,
    "r2v": 1.2
  }
}
```

#### `estimation_strategy`

用于说明如何从任务 payload 中提取计费维度。  
例如：

- `image_batch`
- `video_duration_resolution`
- `text_token_usage`
- `project_storyboard_rollup`

## 19. 后端计算策略建议

### 19.1 推荐增加独立计费计算器

建议不要把参数解析逻辑直接写进 `BillingService.charge_task_submission(...)`。  
应该拆出一个独立的 `BillingPricingEngine` 或 `BillingEstimatorService`。

推荐职责：

- 根据 `task_type` 识别计费模式
- 从 `payload_json` 提取相关参数
- 查出对应规则
- 计算预计消耗
- 生成结构化“费用明细快照”

### 19.2 推荐返回结构

建议返回：

```json
{
  "amount_units": 96,
  "amount_credits_display": "9.6",
  "charge_mode": "per_video_second",
  "breakdown": {
    "video_count": 2,
    "duration": 8,
    "resolution": "720p",
    "model": "wan2.6-i2v"
  },
  "rule_snapshot": {}
}
```

### 19.3 为什么必须做快照

因为计费规则会变。  
如果扣费时不保存快照，后续运营改价后，就无法还原“这笔扣费当时为什么是这个数字”。

## 20. 分布式部署下的状态一致性要求

### 20.1 为什么这部分必须强调

当前项目明确朝分布式部署演进。  
计费属于强一致业务，不能依赖单机内存。

### 20.2 必须满足的原则

- 余额校验与余额扣减必须在同一数据库事务中完成
- 余额更新与流水写入必须在同一数据库事务中完成
- 账本行必须支持加锁读取
- 编排任务的预估结果要持久化，不能只在内存里算一次
- 重试和幂等必须防止重复扣费

### 20.3 编排任务特别注意

对于 `aggregate_children` 类型任务：

- 必须在任务提交前先形成“预估快照”
- 快照写入任务 payload 或扣费流水
- 后续 worker 执行时即使跨实例，也不应重新发散出不同费用

否则会出现：

- A 实例预估 100 豆
- B 实例重试时又预估成 120 豆

这是不能接受的。

## 21. 推荐的第一阶段落地方案

### 21.1 业务上先做到这些

- 文本类任务：按 token 档位计费
- 生图类任务：按 `batch_size × model`
- 生视频类任务：按 `batch_size × duration × resolution × model`
- 对白生成：按字符数
- 编排任务：按内部资源数量预估汇总
- 合成与导出：暂时免费或低固定价

### 21.2 工程上先做到这些

- 引入更细粒度账本单位
- 新增计费计算器
- 扩展规则表支持维度配置
- 在任务提交前进行统一费用估算
- 流水中保存 `breakdown` 与 `rule_snapshot`

### 21.3 页面上先做到这些

- 任务提交前展示预计消耗和构成
- 超管规则页面支持按分组配置，而不是对所有 task_type 单独配复杂矩阵
- 流水详情可查看这次费用的构成明细

## 22. 不建议的做法

以下做法不建议继续采用：

- 所有任务继续只按 `task_type` 固定价
- 批量任务继续配置一个固定价
- 只在前端做预估、不在后端固化
- 扣费明细里不保存参数快照
- 为了方便，直接把所有高级参数都纳入运营配置

这些做法会分别带来：

- 价格不公平
- 真实成本失真
- 分布式重试不一致
- 后续无法审计
- 运营后台过度复杂

## 23. 推荐的下一步开发顺序

### 第一步

改账本底层计费单位，支持更细粒度存储。

### 第二步

设计新版规则模型：

- `charge_mode`
- `pricing_dimensions_json`
- `estimation_strategy`

### 第三步

实现统一计费计算引擎。

### 第四步

先接入以下高价值任务：

- `asset.generate`
- `series.asset.generate`
- `storyboard.render`
- `video.generate.frame`
- `video.generate.asset`
- `audio.generate.line`

### 第五步

再接入编排任务：

- `asset.generate_batch`
- `storyboard.generate_all`
- `video.generate.project`
- `audio.generate.project`

## 24. 最终建议

如果只用一句话总结：

> DramaLab 的算力豆扣费模型，应该从“按任务类型固定价”升级为“按真实资源消耗计费”，其中最关键的资源维度是：文本 token、图片张数、视频秒数、视频分辨率、语音字符数，以及编排任务内部展开后的实际生成量。

如果要用更工程化的话总结：

> 下一版计费系统的核心不是“多配几张价格表”，而是建设一个稳定的参数化计费引擎，并把费用估算快照、余额扣减、流水写入、幂等控制放进同一套分布式一致的事务模型中。

