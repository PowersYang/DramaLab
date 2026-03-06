"""Vidu video generation model adapter.

API: https://api.vidu.cn/ent/v2
Auth: Token header using VIDU_API_KEY
Models: viduq2 (T2V), viduq2-pro (I2V default), viduq2-pro-fast
"""

import logging
import os
import time
from typing import Dict, Any, Tuple

import requests

from .base import VideoGenModel

logger = logging.getLogger(__name__)

BASE_URL = "https://api.vidu.cn/ent/v2"
DEFAULT_T2V_MODEL = "viduq2"
DEFAULT_I2V_MODEL = "viduq2-pro"


class ViduModel(VideoGenModel):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get("api_key") or os.getenv("VIDU_API_KEY", "")
        self.model_name = config.get("params", {}).get("model_name", DEFAULT_I2V_MODEL)

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _map_status(raw_state: str) -> str:
        """Map Vidu API states to normalized statuses."""
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
        """Generate video using Vidu API (T2V or I2V)."""
        duration = kwargs.get("duration", 5)
        resolution = (kwargs.get("resolution") or "720p").lower()
        aspect_ratio = kwargs.get("aspect_ratio", "16:9")

        start_time = time.time()

        is_i2v = bool(img_url or img_path)

        if is_i2v:
            task_id, used_model = self._submit_i2v(
                prompt=prompt,
                image_url=img_url or img_path,
                model=kwargs.get("model"),
                duration=duration,
                resolution=resolution,
                **kwargs,
            )
        else:
            task_id, used_model = self._submit_t2v(
                prompt=prompt,
                model=kwargs.get("model"),
                duration=duration,
                resolution=resolution,
                aspect_ratio=aspect_ratio,
                **kwargs,
            )

        logger.info(f"[Vidu] Task submitted: {task_id} (model={used_model})")

        # Poll for completion
        poll_url = f"{BASE_URL}/tasks/{task_id}/creations"
        max_wait = 600
        poll_interval = 10
        elapsed = 0

        while elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval

            resp = requests.get(poll_url, headers=self._headers(), timeout=30)
            if resp.status_code not in (200, 201):
                logger.warning(f"[Vidu] Poll returned HTTP {resp.status_code}")
                continue

            data = resp.json()
            state = data.get("state", "unknown")
            normalized = self._map_status(state)
            logger.info(f"[Vidu] Task status: {state} -> {normalized} ({elapsed}s)")

            if normalized == "succeeded":
                video_url = data["creations"][0]["url"]
                # Download video
                video_content = requests.get(video_url, timeout=120).content
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, "wb") as f:
                    f.write(video_content)

                generation_time = time.time() - start_time
                logger.info(f"[Vidu] Done in {generation_time:.1f}s -> {output_path}")
                return output_path, generation_time

            elif normalized == "failed":
                raise RuntimeError(f"Vidu task failed: {data}")

        raise RuntimeError(f"Vidu task timed out after {max_wait}s")

    def _submit_t2v(self, *, prompt: str, model: str = None, duration: int = 5,
                    resolution: str = "720p", aspect_ratio: str = "16:9",
                    **kwargs) -> Tuple[str, str]:
        """Submit a text-to-video task. Returns (task_id, model_used)."""
        used_model = model or DEFAULT_T2V_MODEL

        body: Dict[str, Any] = {
            "model": used_model,
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
            "seed": kwargs.get("seed", 0),
            "style": kwargs.get("style", "general"),
            "bgm": kwargs.get("bgm", True),
        }

        submit_url = f"{BASE_URL}/text2video"
        logger.info(f"[Vidu] Submitting t2v task (model={used_model}, duration={duration}s)")

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
                    **kwargs) -> Tuple[str, str]:
        """Submit an image-to-video task. Returns (task_id, model_used)."""
        if not image_url:
            raise ValueError("image_url is required for i2v mode")

        used_model = model or DEFAULT_I2V_MODEL

        body: Dict[str, Any] = {
            "model": used_model,
            "images": [image_url],
            "prompt": prompt or "",
            "duration": duration,
            "resolution": resolution,
            "seed": kwargs.get("seed", 0),
            "movement_amplitude": kwargs.get("movement_amplitude", "auto"),
            "audio": kwargs.get("audio", True),
        }

        submit_url = f"{BASE_URL}/img2video"
        logger.info(f"[Vidu] Submitting i2v task (model={used_model}, duration={duration}s)")

        resp = requests.post(submit_url, headers=self._headers(), json=body, timeout=30)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Vidu i2v submission failed (HTTP {resp.status_code}): {resp.text}")

        data = resp.json()
        task_id = data.get("task_id")
        if not task_id:
            raise RuntimeError(f"No task_id in Vidu response: {data}")

        return task_id, used_model
