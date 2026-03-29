"""对白、音效、背景音乐的具体音频生成实现。"""

import os
import time
from typing import Any, Dict, List

from ...schemas.models import Character, GenerationStatus, StoryboardFrame

from ...audio.tts import TTSProcessor
from ...application.services.model_provider_service import ModelProviderService
from ...utils import get_logger
from ...utils.oss_utils import OSSImageUploader

logger = get_logger(__name__)


class AudioGenerator:
    """
    音频生成 provider。

    这里承接原 `src/service/audio.py` 的实现，作为第一批目录迁移结果。
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.output_dir = self.config.get("output_dir", "output/audio")
        self.provider_service = ModelProviderService()

        try:
            self.tts = TTSProcessor()
            logger.info("TTS Processor initialized successfully")
        except Exception as exc:
            logger.warning("Failed to initialize TTS Processor: %s. Using mock mode.", exc)
            self.tts = None

    def get_available_voices(self) -> List[Dict[str, str]]:
        """返回当前 TTS 厂商支持的语音列表。"""
        provider_key = self.get_active_tts_provider_key()
        if provider_key != "DASHSCOPE":
            logger.warning("TTS provider %s is not implemented yet; returning empty voice catalog", provider_key)
            return []

        voices_dict = TTSProcessor.list_voices()
        return [
            {
                "id": voice_id,
                "name": f"{meta['name']} - CosyVoice",
                "gender": meta.get("gender", "Unknown"),
                "model": meta.get("model", "cosyvoice-v2"),
                "provider_key": provider_key,
                "aliases": meta.get("aliases", []),
            }
            for voice_id, meta in voices_dict.items()
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

        if not TTSProcessor.is_supported_voice(character.voice_id):
            frame.status = GenerationStatus.FAILED
            frame.audio_error = f"Voice '{character.voice_id}' is not supported by current TTS provider."
            logger.warning("Unsupported voice_id=%s for character %s", character.voice_id, character.name)
            return frame

        return self._real_generate_dialogue(frame, character, text, speed, pitch, volume)

    def _real_generate_dialogue(self, frame: StoryboardFrame, character: Character, text: str, speed: float, pitch: float, volume: int) -> StoryboardFrame:
        """在通过前置校验后，真正执行一次 TTS 请求。"""
        try:
            output_path = os.path.join(self.output_dir, "dialogue", f"{frame.id}.mp3")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            self.tts.synthesize(text, output_path, voice=character.voice_id, speech_rate=speed, pitch_rate=pitch, volume=volume)
            frame.audio_url = self._persist_media(output_path, "audio/dialogue")
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
            frame.sfx_url = self._persist_media(output_path, "audio/sfx")
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
        # 这里暂时仍是占位实现，但 workflow 契约已经稳定，后续可以直接替换底层 provider。
        time.sleep(1)
        output_path = os.path.join(self.output_dir, "sfx", f"{frame.id}_v2a.mp3")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as file_obj:
            file_obj.write(b"dummy v2a sfx content")
        frame.sfx_url = self._persist_media(output_path, "audio/sfx")
        return frame

    def generate_bgm(self, frame: StoryboardFrame) -> StoryboardFrame:
        """基于分镜上下文生成背景音乐。"""
        logger.info("Generating BGM for frame %s", frame.id)
        # 这里暂时仍是占位实现，但输出路径约定保持真实，便于下游导出逻辑继续复用。
        time.sleep(1)
        output_path = os.path.join(self.output_dir, "bgm", f"{frame.id}.mp3")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as file_obj:
            file_obj.write(b"dummy bgm content")
        frame.bgm_url = self._persist_media(output_path, "audio/bgm")
        return frame

    def _persist_media(self, output_path: str, sub_path: str) -> str:
        """把新生成媒体持久化到 OSS。

        音频地址会被前端和后续导出流程复用，因此这里强制要求产物已经上传成功。
        """
        try:
            uploader = OSSImageUploader()
            if uploader.is_configured:
                object_key = uploader.upload_file(output_path, sub_path=sub_path)
                if object_key:
                    return object_key
        except Exception as exc:
            logger.error("Failed to upload media %s to OSS: %s", output_path, exc)
        raise RuntimeError(f"Failed to upload media {output_path} to OSS.")

    def get_active_tts_provider_key(self) -> str:
        """解析当前可用于配音的厂商。

        现阶段仅真正接入阿里云百炼，因此返回值用于约束音色列表与厂商能力保持一致。
        """
        try:
            provider = self.provider_service.get_provider_config("DASHSCOPE")
            if provider.enabled:
                return "DASHSCOPE"
        except Exception as exc:
            logger.warning("Failed to resolve active TTS provider from model provider config: %s", exc)
        return "DASHSCOPE"
