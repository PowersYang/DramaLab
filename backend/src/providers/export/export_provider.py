"""项目渲染导出的具体实现。"""

import time
from typing import Any, Dict, List

from ...schemas.models import Script

from ...utils import get_logger
from ...utils.oss_utils import OSSImageUploader
from ...utils.temp_media import create_temp_file_path, remove_temp_file

logger = get_logger(__name__)


class ExportManager:
    """
    导出 provider。

    这里承接原 `src/service/export.py` 的实现，作为第一批目录迁移结果。
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}

    def render_project(self, script: Script, options: Dict[str, Any]) -> str:
        """导出项目最终视频，并返回 OSS 对象键。"""
        logger.info("开始导出：项目编号=%s 选项=%s", script.id, options)

        _resolution = options.get("resolution", "1080p")
        format_name = options.get("format", "mp4")
        _subtitles = options.get("subtitles", "burn-in")

        try:
            duration = len(script.frames) * 0.5
            time.sleep(min(duration, 5))
            output_path = create_temp_file_path(prefix=f"dramalab-export-{script.id}-", suffix=f".{format_name}")
            with open(output_path, "wb") as file_obj:
                file_obj.write(b"dummy video content")
            uploader = OSSImageUploader()
            object_key = uploader.upload_file(output_path, sub_path="export") if uploader.is_configured else None
            if not object_key:
                raise RuntimeError("Failed to upload exported video to OSS.")
            logger.info("导出完成：本地路径=%s 对象键=%s", output_path, object_key)
            return object_key
        except Exception as exc:
            logger.error("导出失败：%s", exc)
            raise
        finally:
            remove_temp_file(output_path if "output_path" in locals() else None)

    def _stitch_video(self, frames: List[Any], output_path: str):
        """为后续多片段拼接预留占位方法。"""
        pass

    def _mix_audio(self, audio_tracks: List[Any], output_path: str):
        """为后续音频混流预留占位方法。"""
        pass

    def _add_subtitles(self, video_path: str, subtitles: List[Any]):
        """为后续字幕烧录或外挂字幕生成预留占位方法。"""
        pass
