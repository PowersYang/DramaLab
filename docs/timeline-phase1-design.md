# Timeline Phase 1 设计稿

## 目标
- 把“最终混剪”从前端本地草稿升级为后端可落库的时间轴工程。
- 第一阶段先解决：
  - 片段顺序
  - 入点/出点裁切
  - 视频/对白/音效/BGM 轨道建模
  - 前后端统一真源
- 第一阶段暂不解决：
  - 音量包络
  - 关键帧
  - 转场
  - 波形分析
  - 真正的混音渲染

## 落库策略
- 暂时不新增 timeline 子表。
- 先把工程整体落在 `projects.timeline_json`。
- 原因：
  - 当前仓库还没有正式 migration 体系。
  - 第一阶段重点是统一前后端真源和 API 契约。
  - 等交互模型稳定后，再拆 `timeline_tracks / timeline_clips / timeline_assets / timeline_versions`。

## JSON 结构
```json
{
  "project_id": "project_123",
  "version": 3,
  "updated_at": "2026-03-31T10:00:00+08:00",
  "tracks": [
    { "id": "track_video_main", "track_type": "video", "label": "视频", "order": 0, "enabled": true, "locked": false },
    { "id": "track_dialogue_main", "track_type": "dialogue", "label": "对白", "order": 1, "enabled": true, "locked": false },
    { "id": "track_sfx_main", "track_type": "sfx", "label": "音效", "order": 2, "enabled": true, "locked": false },
    { "id": "track_bgm_main", "track_type": "bgm", "label": "背景音乐", "order": 3, "enabled": true, "locked": false }
  ],
  "assets": [
    {
      "id": "asset_video_frame_1_task_1",
      "kind": "video",
      "source_url": "oss://video.mp4",
      "label": "镜头 1",
      "source_duration": 5.0,
      "frame_id": "frame_1",
      "video_task_id": "task_1",
      "role": "main",
      "metadata": {}
    }
  ],
  "clips": [
    {
      "id": "clip_video_frame_1_task_1",
      "asset_id": "asset_video_frame_1_task_1",
      "track_id": "track_video_main",
      "clip_order": 0,
      "timeline_start": 0.0,
      "timeline_end": 5.0,
      "source_start": 0.0,
      "source_end": 5.0,
      "volume": 1.0,
      "lane_index": 0,
      "linked_clip_id": null,
      "metadata": { "frame_id": "frame_1", "video_task_id": "task_1" }
    }
  ]
}
```

## API

### `GET /projects/{project_id}/timeline`
- 返回项目时间轴。
- 如果数据库尚未保存 timeline，则根据当前已选视频、对白、音效、BGM 即时生成默认工程。

### `PUT /projects/{project_id}/timeline`
- 请求体：
```json
{
  "version": 2,
  "tracks": [],
  "assets": [],
  "clips": []
}
```
- 行为：
  - 服务端做归一化
  - 自动重排 `clip_order`
  - 自动修正 `timeline_start/timeline_end`
  - 自动清空 `merged_video_url`

## 与现有链路兼容
- 现有 `media.merge` 仍消费旧的 `final_mix_timeline` 结构。
- 第一阶段通过服务端把 `timeline` 降级为：
  - `frame_id`
  - `video_id`
  - `clip_order`
  - `trim_start`
  - `trim_end`
- 这样不需要重写整条导出链路，就能先把时间轴真源切到后端。

## 前端改造点
- `FinalMixStudio` 改为：
  - 首次进入时调用 `GET /timeline`
  - 本地编辑 `clips`
  - debounce 调 `PUT /timeline`
  - 保存成功后同步更新 `projectStore.currentProject.timeline`
- `projectStore.final_mix_timeline` 继续保留一层派生字段，供老的 merge/export 调用兼容。

## 下一阶段
- 拆分 timeline 子表
- 接入音频时长/波形分析
- 引入真实音量、mute/solo、ducking
- 用 `ffmpeg filter_complex` 做音视频统一渲染
