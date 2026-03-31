# Marketing Resources

官网首页依赖的视频与封面图统一沉淀在这个目录。

- `videos/`：首页背景轮播视频的项目级源文件
- `images/`：对应视频的海报/封面图

当前首页背景轮播使用以下 5 个 OSS 源视频：

- `video_61f4008c-939e-4c60-be56-0ad6053cd932.mp4`
- `video_d114e1e9-c60d-4ed1-96c7-814388d7d0ee.mp4`
- `video_12834f7a-acc4-4a48-955c-6a4e4de7e4b7.mp4`
- `video_5c3d75a3-8fd5-4282-b92b-f90a58f98b38.mp4`
- `video_7d2426cb-aef6-487d-a19f-08dd2d4cb470.mp4`

前端运行 `npm run dev` 或 `npm run build` 前，会通过 `scripts/sync_marketing_assets.mjs` 自动把这里的资源同步到 `frontend/public/.../marketing/`。

这样做的目的：

- 避免首页资源继续依赖历史运行时临时目录
- 让资源在仓库根目录具备稳定来源，换环境发布时不会丢失
- 保持 `frontend/public` 只作为发布镜像目录，减少资源漂移
