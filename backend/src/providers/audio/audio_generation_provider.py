"""Concrete audio generation implementation for dialogue, SFX, and BGM."""

import os
import time
from typing import Any, Dict, List

from backend.src.schemas.models import Character, GenerationStatus, StoryboardFrame

from ...audio.tts import TTSProcessor
from ...utils import get_logger

logger = get_logger(__name__)


class AudioGenerator:
    """
    音频生成 provider。

    这里承接原 `src/service/audio.py` 的实现，作为第一批目录迁移结果。
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.output_dir = self.config.get("output_dir", "output/audio")

        try:
            self.tts = TTSProcessor()
            logger.info("TTS Processor initialized successfully")
        except Exception as exc:
            logger.warning("Failed to initialize TTS Processor: %s. Using mock mode.", exc)
            self.tts = None

    def get_available_voices(self) -> List[Dict[str, str]]:
        """返回当前可用语音列表。"""
        if self.tts:
            voices_dict = TTSProcessor.list_voices()
            return [
                {
                    "id": key,
                    "name": f"{meta['name']} - CosyVoice",
                    "gender": meta.get("gender", "Unknown"),
                    "model": meta.get("model", "cosyvoice-v2"),
                }
                for key, meta in voices_dict.items()
            ]
        return [
            {"id": "longxiaochun", "name": "龙小淳 (知性女) - CosyVoice", "gender": "Female"},
            {"id": "longyue", "name": "龙悦 (温柔女) - CosyVoice", "gender": "Female"},
            {"id": "longcheng", "name": "龙诚 (睿智青年) - CosyVoice", "gender": "Male"},
            {"id": "longshu", "name": "龙书 (播报男) - CosyVoice", "gender": "Male"},
        ]

    def generate_dialogue(self, frame: StoryboardFrame, character: Character, speed: float = 1.0, pitch: float = 1.0, volume: int = 50) -> StoryboardFrame:
        """为对白生成 TTS 音频。"""
        if not frame.dialogue:
            return frame

        frame.status = GenerationStatus.PROCESSING
        text = frame.dialogue
        logger.info(
            "Generating dialogue for %s: %s (Speed: %s, Pitch: %s, Volume: %s)",
            character.name,
            text,
            speed,
            pitch,
            volume,
        )

        if not self.tts:
            frame.status = GenerationStatus.FAILED
            frame.audio_error = "TTS service not available. Check DASHSCOPE_API_KEY configuration."
            logger.warning("TTS not initialized, cannot generate audio for frame %s", frame.id)
            return frame

        if not character.voice_id:
            frame.status = GenerationStatus.FAILED
            frame.audio_error = f"No voice assigned to character '{character.name}'. Please assign a voice first."
            logger.warning("No voice_id for character %s, cannot generate audio", character.name)
            return frame

        return self._real_generate_dialogue(frame, character, text, speed, pitch, volume)

    def _real_generate_dialogue(self, frame: StoryboardFrame, character: Character, text: str, speed: float, pitch: float, volume: int) -> StoryboardFrame:
        """Run the actual TTS request once validation has passed."""
        try:
            output_path = os.path.join(self.output_dir, "dialogue", f"{frame.id}.mp3")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            self.tts.synthesize(text, output_path, voice=character.voice_id, speech_rate=speed, pitch_rate=pitch, volume=volume)
            frame.audio_url = os.path.relpath(output_path, "output")
            frame.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("TTS generation failed for frame %s: %s", frame.id, exc)
            frame.status = GenerationStatus.FAILED
            frame.audio_error = f"TTS generation failed: {str(exc)}"
        return frame

    def generate_sfx(self, frame: StoryboardFrame) -> StoryboardFrame:
        """为当前分镜帧生成音效。"""
        frame.status = GenerationStatus.PROCESSING
        try:
            logger.info("Generating SFX for: %s", frame.action_description)
            output_path = os.path.join(self.output_dir, "sfx", f"{frame.id}.mp3")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, "wb") as file_obj:
                file_obj.write(b"dummy sfx content")
            frame.sfx_url = os.path.relpath(output_path, "output")
            frame.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("Failed to generate SFX for frame %s: %s", frame.id, exc)
            frame.status = GenerationStatus.FAILED
        return frame

    def generate_sfx_from_video(self, frame: StoryboardFrame) -> StoryboardFrame:
        """基于视频内容生成音效。"""
        if not frame.video_url:
            return frame
        logger.info("Generating SFX from video for frame %s", frame.id)
        # This remains a stub implementation for now; the workflow contract is
        # already stable, so the backing provider can be replaced later.
        time.sleep(1)
        output_path = os.path.join(self.output_dir, "sfx", f"{frame.id}_v2a.mp3")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as file_obj:
            file_obj.write(b"dummy v2a sfx content")
        frame.sfx_url = os.path.relpath(output_path, "output")
        return frame

    def generate_bgm(self, frame: StoryboardFrame) -> StoryboardFrame:
        """基于分镜上下文生成背景音乐。"""
        logger.info("Generating BGM for frame %s", frame.id)
        # This remains a stub implementation for now; output path conventions
        # are kept real so downstream export logic can already rely on them.
        time.sleep(1)
        output_path = os.path.join(self.output_dir, "bgm", f"{frame.id}.mp3")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as file_obj:
            file_obj.write(b"dummy bgm content")
        frame.bgm_url = os.path.relpath(output_path, "output")
        return frame
