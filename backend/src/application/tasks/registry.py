from .executors.audio_generate_line import AudioGenerateLineExecutor
from .executors.audio_generate_project import AudioGenerateProjectExecutor
from .executors.art_direction_analyze import ArtDirectionAnalyzeExecutor
from .executors.asset_generate import AssetGenerateExecutor
from .executors.asset_generate_batch import AssetGenerateBatchExecutor
from .executors.asset_motion_ref import AssetMotionRefExecutor
from .executors.media_merge import MediaMergeExecutor
from .executors.mix_generate_bgm import MixGenerateBgmExecutor
from .executors.mix_generate_sfx import MixGenerateSfxExecutor
from .executors.project_export import ProjectExportExecutor
from .executors.project_reparse import ProjectReparseExecutor
from .executors.project_sync_descriptions import ProjectSyncDescriptionsExecutor
from .executors.series_asset_generate import SeriesAssetGenerateExecutor
from .executors.series_import_assets import SeriesImportAssetsExecutor
from .executors.series_import_confirm import SeriesImportConfirmExecutor
from .executors.series_import_preview import SeriesImportPreviewExecutor
from .executors.storyboard_analyze import StoryboardAnalyzeExecutor
from .executors.storyboard_generate_all import StoryboardGenerateAllExecutor
from .executors.storyboard_refine_prompt import StoryboardRefinePromptExecutor
from .executors.storyboard_render import StoryboardRenderExecutor
from .executors.video_generate import VideoGenerateExecutor
from .executors.video_generate_project import VideoGenerateProjectExecutor
from .executors.video_polish_prompt import VideoPolishPromptExecutor
from .executors.video_polish_r2v_prompt import VideoPolishR2VPromptExecutor


class TaskExecutorRegistry:
    """按 task_type 返回对应执行器。"""

    def __init__(self):
        self._executors = {
            "audio.generate.project": AudioGenerateProjectExecutor(),
            "audio.generate.line": AudioGenerateLineExecutor(),
            "art_direction.analyze": ArtDirectionAnalyzeExecutor(),
            "asset.generate": AssetGenerateExecutor(),
            "asset.generate_batch": AssetGenerateBatchExecutor(),
            "asset.motion_ref.generate": AssetMotionRefExecutor(),
            "media.merge": MediaMergeExecutor(),
            "mix.generate.bgm": MixGenerateBgmExecutor(),
            "mix.generate.sfx": MixGenerateSfxExecutor(),
            "project.export": ProjectExportExecutor(),
            "project.reparse": ProjectReparseExecutor(),
            "project.sync_descriptions": ProjectSyncDescriptionsExecutor(),
            "series.asset.generate": SeriesAssetGenerateExecutor(),
            "series.assets.import": SeriesImportAssetsExecutor(),
            "series.import.confirm": SeriesImportConfirmExecutor(),
            "series.import.preview": SeriesImportPreviewExecutor(),
            "storyboard.analyze": StoryboardAnalyzeExecutor(),
            "storyboard.generate_all": StoryboardGenerateAllExecutor(),
            "storyboard.refine_prompt": StoryboardRefinePromptExecutor(),
            "storyboard.render": StoryboardRenderExecutor(),
            "video.generate.project": VideoGenerateProjectExecutor(),
            "video.generate.frame": VideoGenerateExecutor(),
            "video.generate.asset": VideoGenerateExecutor(),
            "video.polish_prompt": VideoPolishPromptExecutor(),
            "video.polish_r2v_prompt": VideoPolishR2VPromptExecutor(),
        }

    def get(self, task_type: str):
        executor = self._executors.get(task_type)
        if executor is None:
            raise ValueError(f"Unsupported task type: {task_type}")
        return executor
