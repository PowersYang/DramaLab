"""基于 Wanx 模型的具体视频生成实现。"""

import os
import uuid
from typing import Any, Dict

from ...schemas.models import GenerationStatus, StoryboardFrame

from ...models.wanx import WanxModel
from ...utils import get_logger
from ...utils.oss_utils import OSSImageUploader

logger = get_logger(__name__)


class VideoGenerator:
    """
    视频生成 provider。

    这里承接原 `src/service/video.py` 的实现，作为第一批目录迁移结果。
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.model = WanxModel(self.config.get("model", {}))
        self.output_dir = self.config.get("output_dir", "output/video")

    def generate_i2v(self, image_url: str, prompt: str, duration: int = 5, audio_url: str = None, negative_prompt: str | None = None) -> Dict[str, Any]:
        """根据输入图片生成动作参考视频。"""

        logger.info("Generating I2V motion reference: prompt=%s..., duration=%s", prompt[:50], duration)

        img_path = None
        if image_url and not image_url.startswith("http"):
            # 本地路径通常是 output 相对路径，但调用方偶尔也会直接传绝对路径。
            potential_path = os.path.join("output", image_url)
            if os.path.exists(potential_path):
                img_path = os.path.abspath(potential_path)
            elif os.path.exists(image_url):
                img_path = image_url

        try:
            output_filename = f"motion_ref_{uuid.uuid4().hex[:8]}.mp4"
            output_path = os.path.join(self.output_dir, output_filename)
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

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
            logger.info("Uploaded motion ref video to OSS: %s", object_key)
            video_url = object_key

            return {"video_url": video_url}
        except Exception as exc:
            logger.error("Failed to generate I2V motion reference: %s", exc)
            raise

    def generate_clip(self, frame: StoryboardFrame) -> StoryboardFrame:
        """根据分镜帧生成视频片段。"""
        if not frame.image_url:
            logger.error("Frame %s has no image URL. Cannot generate video.", frame.id)
            frame.status = GenerationStatus.FAILED
            return frame

        frame.status = GenerationStatus.PROCESSING
        prompt = frame.video_prompt or frame.image_prompt or frame.action_description
        img_url = frame.image_url
        img_path = None

        if img_url and not img_url.startswith("http"):
            # 分镜图片地址可能已经是 OSS 或其它远程地址；只有本地 output 路径才去落盘解析。
            potential_path = os.path.join("output", img_url)
            if os.path.exists(potential_path):
                img_path = os.path.abspath(potential_path)
            elif os.path.exists(img_url):
                img_path = img_url

        try:
            output_path = os.path.join(self.output_dir, f"{frame.id}.mp4")
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
            logger.info("Uploaded video for frame %s to OSS: %s", frame.id, object_key)
            frame.video_url = object_key
            frame.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("Failed to generate video for frame %s: %s", frame.id, exc)
            frame.status = GenerationStatus.FAILED

        return frame
