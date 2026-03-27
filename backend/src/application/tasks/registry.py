from .executors.art_direction_analyze import ArtDirectionAnalyzeExecutor
from .executors.asset_generate import AssetGenerateExecutor
from .executors.asset_generate_batch import AssetGenerateBatchExecutor
from .executors.asset_motion_ref import AssetMotionRefExecutor
from .executors.series_asset_generate import SeriesAssetGenerateExecutor
from .executors.storyboard_analyze import StoryboardAnalyzeExecutor
from .executors.storyboard_generate_all import StoryboardGenerateAllExecutor
from .executors.storyboard_render import StoryboardRenderExecutor
from .executors.video_generate import VideoGenerateExecutor


class TaskExecutorRegistry:
    """按 task_type 返回对应执行器。"""

    def __init__(self):
        self._executors = {
            "art_direction.analyze": ArtDirectionAnalyzeExecutor(),
            "asset.generate": AssetGenerateExecutor(),
            "asset.generate_batch": AssetGenerateBatchExecutor(),
            "asset.motion_ref.generate": AssetMotionRefExecutor(),
            "series.asset.generate": SeriesAssetGenerateExecutor(),
            "storyboard.analyze": StoryboardAnalyzeExecutor(),
            "storyboard.generate_all": StoryboardGenerateAllExecutor(),
            "storyboard.render": StoryboardRenderExecutor(),
            "video.generate.frame": VideoGenerateExecutor(),
            "video.generate.asset": VideoGenerateExecutor(),
        }

    def get(self, task_type: str):
        executor = self._executors.get(task_type)
        if executor is None:
            raise ValueError(f"Unsupported task type: {task_type}")
        return executor
