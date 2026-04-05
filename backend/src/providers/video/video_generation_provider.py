"""基于 Wanx 模型的具体视频生成实现。"""

import os
import uuid
from typing import Any, Dict

from ...schemas.models import GenerationStatus, StoryboardFrame

from ...models.wanx import WanxModel
from ...utils import get_logger
from ...utils.oss_utils import OSSImageUploader, is_object_key
from ...utils.temp_media import create_temp_file_path, remove_temp_file

logger = get_logger(__name__)


class VideoGenerator:
    """
    视频生成 provider。

    这里承接原 `src/service/video.py` 的实现，作为第一批目录迁移结果。
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.model = WanxModel(self.config.get("model", {}))

    def generate_i2v(self, image_url: str, prompt: str, duration: int = 5, audio_url: str = None, negative_prompt: str | None = None) -> Dict[str, Any]:
        """根据输入图片生成动作参考视频。"""

        logger.info("生成动作参考视频：提示词=%s... 时长=%s秒", prompt[:50], duration)

        img_path = None
        if image_url and not image_url.startswith("http") and not is_object_key(image_url) and os.path.exists(image_url):
            img_path = os.path.abspath(image_url)

        output_path = create_temp_file_path(prefix="dramalab-motion-ref-", suffix=".mp4")
        try:
            self.model.generate(
                prompt=prompt,
                output_path=output_path,
                img_path=img_path,
                img_url=image_url if not img_path else None,
                audio_url=audio_url,
                negative_prompt=negative_prompt,
            )

            uploader = OSSImageUploader()
            object_key = uploader.upload_file(output_path, sub_path="motion_ref") if uploader.is_configured else None
            if not object_key:
                raise RuntimeError("Failed to upload motion reference video to OSS.")
            logger.info("已上传动作参考视频到对象存储：对象键=%s", object_key)
            video_url = object_key

            return {"video_url": video_url}
        except Exception as exc:
            logger.error("生成动作参考视频失败：%s", exc)
            raise
        finally:
            remove_temp_file(output_path)

    def generate_clip(self, frame: StoryboardFrame) -> StoryboardFrame:
        """根据分镜帧生成视频片段。"""
        if not frame.image_url:
            logger.error("分镜帧缺少图片链接，无法生成视频：帧编号=%s", frame.id)
            frame.status = GenerationStatus.FAILED
            return frame

        frame.status = GenerationStatus.PROCESSING
        prompt = frame.video_prompt or frame.image_prompt or frame.action_description
        img_url = frame.image_url
        img_path = None

        if img_url and not img_url.startswith("http") and not is_object_key(img_url) and os.path.exists(img_url):
            img_path = os.path.abspath(img_url)

        output_path = create_temp_file_path(prefix=f"dramalab-frame-{frame.id}-", suffix=".mp4")
        try:
            self.model.generate(
                prompt=prompt,
                output_path=output_path,
                img_path=img_path,
                img_url=img_url if not img_path else None,
            )

            uploader = OSSImageUploader()
            object_key = uploader.upload_file(output_path, sub_path="video") if uploader.is_configured else None
            if not object_key:
                raise RuntimeError(f"Failed to upload video for frame {frame.id} to OSS.")
            logger.info("已上传分镜视频到对象存储：帧编号=%s 对象键=%s", frame.id, object_key)
            frame.video_url = object_key
            frame.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("生成分镜视频失败：帧编号=%s 错误=%s", frame.id, exc)
            frame.status = GenerationStatus.FAILED
        finally:
            remove_temp_file(output_path)

        return frame
