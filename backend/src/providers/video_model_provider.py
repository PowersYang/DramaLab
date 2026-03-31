"""
视频模型 provider。

保留对现有模型实现的兼容，同时把 workflow 和底层视频 SDK 解耦。
"""

import os

try:
    from ..models.kling import KlingModel
except Exception:
    KlingModel = None

try:
    from ..models.vidu import ViduModel
except Exception:
    ViduModel = None

from .video.video_generation_provider import VideoGenerator


class VideoModelProvider:
    """视频生成稳定门面，负责按模型类型路由到底层实现。"""

    def __init__(self):
        self._video_generator = VideoGenerator()
        self._kling_model = None
        self._vidu_model = None

    def generate_i2v(self, image_url: str, prompt: str, duration: int = 5, audio_url: str | None = None, negative_prompt: str | None = None):
        """根据静态图片生成动作参考视频。"""
        return self._video_generator.generate_i2v(
            image_url=image_url,
            prompt=prompt,
            duration=duration,
            audio_url=audio_url,
            negative_prompt=negative_prompt,
        )

    def generate_clip(self, frame):
        """为分镜帧生成标准视频片段。"""
        return self._video_generator.generate_clip(frame)

    def generate_task_video(self, task, output_path: str, img_path: str | None = None, img_url: str | None = None):
        """
        按任务配置路由到具体视频模型。

        这里保留了原 pipeline 中的模型路由语义，但把细节收敛到 provider 内。
        """
        model_prefix = (task.model or "").split("-")[0] if task.model else ""

        if model_prefix in ("kling",):
            # 可选 provider 采用延迟初始化，避免缺少依赖时影响默认视频链路。
            if self._kling_model is None:
                if KlingModel is None:
                    raise RuntimeError("KlingModel is unavailable. Check Kling dependencies and configuration.")
                self._kling_model = KlingModel({})
            return self._kling_model.generate(
                prompt=task.prompt,
                output_path=output_path,
                img_url=img_url,
                img_path=img_path,
                duration=task.duration,
                model=task.model,
                negative_prompt=task.negative_prompt,
                aspect_ratio="16:9",
                mode=task.mode or "std",
                sound=task.sound or "off",
                cfg_scale=task.cfg_scale,
            )

        if model_prefix in ("vidu", "viduq2", "viduq3"):
            if self._vidu_model is None:
                if ViduModel is None:
                    raise RuntimeError("ViduModel is unavailable. Check Vidu dependencies and configuration.")
                self._vidu_model = ViduModel({})
            return self._vidu_model.generate(
                prompt=task.prompt,
                output_path=output_path,
                img_url=img_url,
                img_path=img_path,
                duration=task.duration,
                model=task.model,
                resolution=task.resolution,
                aspect_ratio="16:9",
                seed=task.seed or 0,
                audio=task.vidu_audio if task.vidu_audio is not None else True,
                movement_amplitude=task.movement_amplitude or "auto",
            )

        final_audio_url = None
        final_generate_audio = False
        # Wanx 仍沿用 audio_url 和 generate_audio 拆开的旧接口，这里统一归一化一次。
        if task.audio_url:
            final_audio_url = task.audio_url
        elif task.generate_audio:
            final_generate_audio = True

        return self._video_generator.model.generate(
            prompt=task.prompt,
            output_path=output_path,
            img_path=img_path,
            img_url=img_url,
            duration=task.duration,
            seed=task.seed,
            resolution=task.resolution,
            audio_url=final_audio_url,
            audio=final_generate_audio,
            prompt_extend=task.prompt_extend,
            negative_prompt=task.negative_prompt,
            model=task.model,
            shot_type=task.shot_type,
            ref_video_urls=task.reference_video_urls if task.generation_mode == "r2v" else None,
            camera_motion=None,
            subject_motion=None,
        )

    def build_output_path(self, task_id: str) -> str:
        """构建并创建视频任务默认输出路径。"""
        output_filename = f"video_{task_id}.mp4"
        output_path = os.path.join("output", "video", output_filename)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        return output_path
