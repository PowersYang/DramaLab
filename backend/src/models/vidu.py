"""
Vidu 视频模型适配层。

接口地址：`https://api.vidu.cn/ent/v2`
鉴权方式：通过平台模型供应商配置中的 `api_key` 走 Token Header
常用模型：`viduq3-pro`（默认）、`viduq3-turbo`（更快）
"""

import logging
import time
from typing import Dict, Any, Tuple

import requests

from .base import VideoGenModel
from ..application.services.model_provider_service import ModelProviderService
from ..utils.endpoints import get_provider_base_url

logger = logging.getLogger(__name__)
DEFAULT_T2V_MODEL = "viduq3-pro"
DEFAULT_I2V_MODEL = "viduq3-pro"


class ViduModel(VideoGenModel):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get("api_key") or ModelProviderService().get_provider_credential("VIDU", "api_key") or ""
        self.model_name = config.get("params", {}).get("model_name", DEFAULT_I2V_MODEL)

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _map_status(raw_state: str) -> str:
        """把 Vidu 原始状态映射成统一状态值。"""
        mapping = {
            "created": "pending",
            "queueing": "pending",
            "processing": "running",
            "success": "succeeded",
            "failed": "failed",
        }
        return mapping.get(raw_state.lower(), "pending")

    def generate(self, prompt: str, output_path: str, img_url: str = None,
                 img_path: str = None, **kwargs) -> Tuple[str, float]:
        """调用 Vidu 生成视频，兼容 T2V 和 I2V。"""
        duration = kwargs.get("duration", 5)
        resolution = (kwargs.get("resolution") or "720p").lower()
        aspect_ratio = kwargs.get("aspect_ratio", "16:9")

        start_time = time.time()

        is_i2v = bool(img_url or img_path)
        provider_service = ModelProviderService()
        poll_model_id = kwargs.get("model") or self.model_name
        poll_path_template = provider_service.require_model_setting(
            poll_model_id,
            "poll_path_template",
            task_type="i2v",
        )

        if is_i2v:
            task_id, used_model = self._submit_i2v(
                prompt=prompt,
                image_url=img_url or img_path,
                model=kwargs.get("model"),
                duration=duration,
                resolution=resolution,
                seed=kwargs.get("seed", 0),
                movement_amplitude=kwargs.get("movement_amplitude", "auto"),
                audio=kwargs.get("audio", True),
            )
        else:
            task_id, used_model = self._submit_t2v(
                prompt=prompt,
                model=kwargs.get("model"),
                duration=duration,
                resolution=resolution,
                aspect_ratio=aspect_ratio,
                seed=kwargs.get("seed", 0),
                style=kwargs.get("style", "general"),
                bgm=kwargs.get("bgm", True),
            )

        logger.info("视频模型：任务已提交 任务编号=%s 模型=%s", task_id, used_model)

        # 轮询等待任务完成
        poll_url = provider_service.build_provider_url(
            "VIDU",
            base_url=get_provider_base_url("VIDU"),
            path_suffix=str(poll_path_template).format(task_id=task_id),
        )
        max_wait = 600
        poll_interval = 10
        elapsed = 0

        while elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval

            resp = requests.get(poll_url, headers=self._headers(), timeout=30)
            if resp.status_code not in (200, 201):
                logger.warning("视频模型：轮询返回非成功状态码=%s", resp.status_code)
                continue

            data = resp.json()
            state = data.get("state", "unknown")
            normalized = self._map_status(state)
            logger.info("视频模型：任务状态 原始=%s 归一=%s 已等待=%s秒", state, normalized, elapsed)

            if normalized == "succeeded":
                video_url = data["creations"][0]["url"]
                # 下载成品视频
                video_content = requests.get(video_url, timeout=120).content
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, "wb") as f:
                    f.write(video_content)

                generation_time = time.time() - start_time
                logger.info("视频模型：任务完成 用时=%.1f秒 输出路径=%s", generation_time, output_path)
                return output_path, generation_time

            elif normalized == "failed":
                raise RuntimeError(f"Vidu task failed: {data}")

        raise RuntimeError(f"Vidu task timed out after {max_wait}s")

    def _submit_t2v(self, *, prompt: str, model: str = None, duration: int = 5,
                    resolution: str = "720p", aspect_ratio: str = "16:9",
                    seed: int = 0, style: str = "general", bgm: bool = True,
                    ) -> Tuple[str, str]:
        """提交文生视频任务，返回 `(task_id, model_used)`。"""
        used_model = model or DEFAULT_T2V_MODEL

        body: Dict[str, Any] = {
            "model": used_model,
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
            "seed": seed,
            "style": style,
            "bgm": bgm,
        }

        provider_service = ModelProviderService()
        submit_path = provider_service.require_model_setting(
            used_model,
            "t2v_create_path",
            task_type="i2v",
        )
        submit_url = provider_service.build_provider_url(
            "VIDU",
            base_url=get_provider_base_url("VIDU"),
            path_suffix=str(submit_path),
        )
        logger.info("视频模型：提交文生视频任务 模型=%s 时长=%s秒", used_model, duration)

        resp = requests.post(submit_url, headers=self._headers(), json=body, timeout=30)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Vidu t2v submission failed (HTTP {resp.status_code}): {resp.text}")

        data = resp.json()
        task_id = data.get("task_id")
        if not task_id:
            raise RuntimeError(f"No task_id in Vidu response: {data}")

        return task_id, used_model

    def _submit_i2v(self, *, prompt: str, image_url: str, model: str = None,
                    duration: int = 5, resolution: str = "720p",
                    seed: int = 0, movement_amplitude: str = "auto", audio: bool = True,
                    ) -> Tuple[str, str]:
        """提交图生视频任务，返回 `(task_id, model_used)`。"""
        if not image_url:
            raise ValueError("image_url is required for i2v mode")

        used_model = model or DEFAULT_I2V_MODEL

        body: Dict[str, Any] = {
            "model": used_model,
            "images": [image_url],
            "prompt": prompt or "",
            "duration": duration,
            "resolution": resolution,
            "seed": seed,
            "movement_amplitude": movement_amplitude,
            "audio": audio,
        }

        provider_service = ModelProviderService()
        submit_path = provider_service.require_model_setting(
            used_model,
            "i2v_create_path",
            task_type="i2v",
        )
        submit_url = provider_service.build_provider_url(
            "VIDU",
            base_url=get_provider_base_url("VIDU"),
            path_suffix=str(submit_path),
        )
        logger.info("视频模型：提交图生视频任务 模型=%s 时长=%s秒", used_model, duration)

        resp = requests.post(submit_url, headers=self._headers(), json=body, timeout=30)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Vidu i2v submission failed (HTTP {resp.status_code}): {resp.text}")

        data = resp.json()
        task_id = data.get("task_id")
        if not task_id:
            raise RuntimeError(f"No task_id in Vidu response: {data}")

        return task_id, used_model
