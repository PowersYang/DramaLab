import os
import time
from typing import Dict, Any, List
from backend.src.schema.models import StoryboardFrame, Character, GenerationStatus
from ..utils import get_logger
from ..audio.tts import TTSProcessor

logger = get_logger(__name__)

class AudioGenerator:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.output_dir = self.config.get('output_dir', 'output/audio')
        
        # 初始化 TTS 处理器；失败时退回不可用模式
        try:
            self.tts = TTSProcessor()
            logger.info("TTS Processor initialized successfully")
        except Exception as e:
            logger.warning(f"Failed to initialize TTS Processor: {e}. Using mock mode.")
            self.tts = None

    def get_available_voices(self) -> List[Dict[str, str]]:
        """返回当前可用语音列表。"""
        if self.tts:
            voices_dict = TTSProcessor.list_voices()
            return [
                {"id": key, "name": f"{meta['name']} - CosyVoice", "gender": meta.get('gender', 'Unknown'), "model": meta.get('model', 'cosyvoice-v2')}
                for key, meta in voices_dict.items()
            ]
        else:
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

        logger.info(f"Generating dialogue for {character.name}: {text} (Speed: {speed}, Pitch: {pitch}, Volume: {volume})")

        if not self.tts:
            frame.status = GenerationStatus.FAILED
            frame.audio_error = "TTS service not available. Check DASHSCOPE_API_KEY configuration."
            logger.warning(f"TTS not initialized, cannot generate audio for frame {frame.id}")
            return frame

        if not character.voice_id:
            frame.status = GenerationStatus.FAILED
            frame.audio_error = f"No voice assigned to character '{character.name}'. Please assign a voice first."
            logger.warning(f"No voice_id for character {character.name}, cannot generate audio")
            return frame

        return self._real_generate_dialogue(frame, character, text, speed, pitch, volume)

    def _real_generate_dialogue(self, frame: StoryboardFrame, character: Character, text: str, speed: float, pitch: float, volume: int) -> StoryboardFrame:
        """调用真实 TTS 服务生成对白。"""
        try:
            output_path = os.path.join(self.output_dir, 'dialogue', f"{frame.id}.mp3")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            # 优先使用角色已经绑定的音色
            voice = character.voice_id
            
            # 把语速、音高、音量参数一并传给 TTS
            self.tts.synthesize(text, output_path, voice=voice, speech_rate=speed, pitch_rate=pitch, volume=volume)
            
            # 保存相对路径，方便前端访问
            rel_path = os.path.relpath(output_path, "output")
            frame.audio_url = rel_path
            frame.status = GenerationStatus.COMPLETED
            
        except Exception as e:
            logger.error(f"TTS generation failed for frame {frame.id}: {e}")
            frame.status = GenerationStatus.FAILED
            frame.audio_error = f"TTS generation failed: {str(e)}"
            
        return frame

    def _mock_generate_dialogue(self, frame: StoryboardFrame, character: Character, text: str, speed: float, pitch: float, volume: int) -> StoryboardFrame:
        """兜底假实现：直接标记失败，不生成假文件。"""
        frame.status = GenerationStatus.FAILED
        frame.audio_error = "TTS service unavailable (mock mode)"
        logger.warning(f"Mock generate_dialogue called for frame {frame.id} — marking as FAILED")
        return frame

    def generate_sfx(self, frame: StoryboardFrame) -> StoryboardFrame:
        """为当前分镜帧生成音效。"""
        frame.status = GenerationStatus.PROCESSING
        
        try:
            # 这里还没接真实音效模型，先保留一个可跑通的占位实现
            logger.info(f"Generating SFX for: {frame.action_description}")
            
            output_path = os.path.join(self.output_dir, 'sfx', f"{frame.id}.mp3")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            # 先写一个占位文件，保证流程可走通
            with open(output_path, 'wb') as f:
                f.write(b'dummy sfx content')
                
            # 保存相对路径，方便前端访问
            rel_path = os.path.relpath(output_path, "output")
            frame.sfx_url = rel_path
            frame.status = GenerationStatus.COMPLETED
            
        except Exception as e:
            logger.error(f"Failed to generate SFX for frame {frame.id}: {e}")
            frame.status = GenerationStatus.FAILED
            
        return frame

    def generate_sfx_from_video(self, frame: StoryboardFrame) -> StoryboardFrame:
        """基于视频内容生成音效。"""
        if not frame.video_url:
            return frame
            
        logger.info(f"Generating SFX from video for frame {frame.id}")
        # 这里暂时还是占位逻辑
        time.sleep(1)
        
        output_path = os.path.join(self.output_dir, 'sfx', f"{frame.id}_v2a.mp3")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'wb') as f:
            f.write(b'dummy v2a sfx content')
            
        frame.sfx_url = os.path.relpath(output_path, "output")
        return frame

    def generate_bgm(self, frame: StoryboardFrame) -> StoryboardFrame:
        """基于分镜上下文生成背景音乐。"""
        logger.info(f"Generating BGM for frame {frame.id}")
        # 这里暂时还是占位逻辑
        time.sleep(1)
        
        output_path = os.path.join(self.output_dir, 'bgm', f"{frame.id}.mp3")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'wb') as f:
            f.write(b'dummy bgm content')
            
        frame.bgm_url = os.path.relpath(output_path, "output")
        return frame
