"""
基于 DashScope CosyVoice 的文本转语音模块。
用于把对白文本转换成可用于口型驱动或配音的音频。

兼容 `cosyvoice-v2` 与 `cosyvoice-v3-flash/v3-plus` 系列模型。
"""
import logging
import os
import time
from typing import Optional, Tuple

from ..application.services.model_provider_service import ModelProviderService

try:
    import dashscope
    from dashscope.audio.tts_v2 import SpeechSynthesizer
except ImportError:
    dashscope = None
    SpeechSynthesizer = None
logger = logging.getLogger(__name__)


# 阿里云百炼官方要求 `voice` 参数直接传厂商支持的音色值，并与 `model` 严格匹配。
# 这里把前端展示、历史兼容别名和厂商真实参数统一维护在一个注册表里。
DASHSCOPE_VOICES = {
    # === cosyvoice-v2 音色 ===
    "longxiaochun_v2": {"name": "龙小淳 (知性女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longxiaochun"]},
    "longxiaoxia_v2": {"name": "龙小夏 (沉稳女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longxiaoxia"]},
    "longyue_v2": {"name": "龙悦 (温柔女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longyue"]},
    "longmiao_v2": {"name": "龙淼 (有声书女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longmiao"]},
    "longyuan_v2": {"name": "龙媛 (治愈女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longyuan"]},
    "longhua_v2": {"name": "龙华 (活力甜美女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longhua"]},
    "longwan_v2": {"name": "龙婉 (知性女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longwan"]},
    "longxing_v2": {"name": "龙星 (邻家女孩)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longxing"]},
    "longfeifei_v2": {"name": "龙菲菲 (甜美女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longfeifei"]},
    "longyan_v2": {"name": "龙言 (温柔女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longyan"]},
    "longqiang_v2": {"name": "龙蔷 (浪漫女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longqiang"]},
    "longxiu_v2": {"name": "龙修 (博学男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longxiu"]},
    "longnan_v2": {"name": "龙楠 (睿智少年)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longnan"]},
    "longcheng_v2": {"name": "龙诚 (睿智青年)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longcheng"]},
    "longze_v2": {"name": "龙泽 (阳光男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longze"]},
    "longzhe_v2": {"name": "龙哲 (暖心男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longzhe"]},
    "longtian_v2": {"name": "龙天 (磁性男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longtian"]},
    "longhan_v2": {"name": "龙翰 (深情男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longhan"]},
    "longhao_v2": {"name": "龙浩 (忧郁男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longhao"]},
    "longshu_v2": {"name": "龙书 (播报男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longshu"]},
    "longshuo_v2": {"name": "龙朔 (博学男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longshuo"]},
    "longfei_v2": {"name": "龙飞 (磁性朗诵男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longfei"]},
    "longxiaocheng_v2": {"name": "龙小诚 (低音男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longxiaocheng"]},
    "longshao_v2": {"name": "龙少 (阳光男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longshao"]},
    "longjielidou_v2": {"name": "龙杰力豆 (童声男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": ["longjielidou"]},
    "longhuhu": {"name": "龙虎虎 (童声女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": []},
    "longyumi_v2": {"name": "YUMI (正经青年女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["longyumi"]},
    "longyingxiao": {"name": "龙应笑 (清甜推销女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": []},
    "longjiqi": {"name": "龙机器 (呆萌机器人)", "gender": "Unknown", "model": "cosyvoice-v2", "aliases": []},
    "longhouge": {"name": "龙猴哥 (经典猴哥)", "gender": "Male", "model": "cosyvoice-v2", "aliases": []},
    "longjixin": {"name": "龙机心 (毒舌心机女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": []},
    "longanyue": {"name": "龙安粤 (欢脱粤语男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": []},
    "longshange": {"name": "龙陕哥 (原味陕北男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": []},
    "longanran": {"name": "龙安燃 (活泼质感女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": []},
    "longanxuan": {"name": "龙安宣 (经典直播女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": []},
    "longsanshu": {"name": "龙三叔 (沉稳质感男)", "gender": "Male", "model": "cosyvoice-v2", "aliases": []},
    "longanrou": {"name": "龙安柔 (温柔闺蜜女)", "gender": "Female", "model": "cosyvoice-v2", "aliases": []},
    "loongstella_v2": {"name": "Stella (English Female)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["loongstella"]},
    "loongbella_v2": {"name": "Bella (English Female)", "gender": "Female", "model": "cosyvoice-v2", "aliases": ["loongbella"]},
    # === cosyvoice-v3 音色（需搭配 cosyvoice-v3-flash 或 cosyvoice-v3-plus）===
    "longanyang": {"name": "龙安阳 (阳光少年)", "gender": "Male", "model": "cosyvoice-v3-flash", "aliases": []},
    "longanhuan": {"name": "龙安欢 (活力女)", "gender": "Female", "model": "cosyvoice-v3-flash", "aliases": []},
}

VOICE_ALIAS_TO_CANONICAL = {
    alias: canonical_id
    for canonical_id, meta in DASHSCOPE_VOICES.items()
    for alias in meta.get("aliases", [])
}


class TTSProcessor:
    """基于 CosyVoice 的 TTS 处理器。"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "cosyvoice-v3-flash",
        voice: str = "longanyang"
    ):
        """
        初始化 TTS 处理器。

        未显式传 `api_key` 时，会自动从 `.env` 读取 `DASHSCOPE_API_KEY`。
        """
        if dashscope is None:
            raise RuntimeError("dashscope package not installed. Run: pip install dashscope")

        self.api_key = api_key or ModelProviderService().get_provider_credential("DASHSCOPE", "api_key")
        if self.api_key:
            dashscope.api_key = self.api_key

        self.model = model
        self.voice = voice

        logger.info(f"TTS Processor initialized with model={model}, voice={voice}")

    def synthesize(
        self,
        text: str,
        output_path: str,
        voice: Optional[str] = None,
        speech_rate: float = 1.0,
        pitch_rate: float = 1.0,
        volume: int = 50,
    ) -> Tuple[str, float, str]:
        """
        把文本合成为语音。

        返回值为 `(输出路径, 首包延迟毫秒, request_id)`。
        """
        if SpeechSynthesizer is None:
            raise RuntimeError("dashscope package not installed. Run: pip install dashscope")

        start_time = time.time()
        voice = self.resolve_voice_id(voice or self.voice)

        # 如果这个音色在注册表里，就自动切换到它对应的正确模型
        model = self._resolve_model_for_voice(voice)

        logger.info(f"Synthesizing with model={model}, voice='{voice}' (rate={speech_rate}, pitch={pitch_rate}, vol={volume})...")
        logger.info(f"Text: {text[:100]}{'...' if len(text) > 100 else ''}")

        # 按官方限制把参数夹到合法范围内
        speech_rate = max(0.5, min(2.0, speech_rate))
        pitch_rate = max(0.5, min(2.0, pitch_rate))
        volume = max(0, min(100, volume))

        synthesizer = SpeechSynthesizer(
            model=model,
            voice=voice,
            speech_rate=speech_rate,
            pitch_rate=pitch_rate,
            volume=volume,
        )

        # 发起阻塞式合成调用，直接拿到音频字节
        audio_data = synthesizer.call(text)

        # 读取请求指标
        request_id = synthesizer.get_last_request_id()
        first_package_delay = synthesizer.get_first_package_delay()

        # 确保输出目录存在，再把音频写入磁盘
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'wb') as f:
            f.write(audio_data)

        duration = time.time() - start_time
        logger.info(f"Audio synthesized: request_id={request_id}, delay={first_package_delay}ms, total={duration:.2f}s -> {output_path}")

        return output_path, first_package_delay, request_id

    def _resolve_model_for_voice(self, voice_id: str) -> str:
        """
        根据音色 ID 反查它应该使用的模型。

        注册表里找不到时，回退到当前实例默认模型。
        """
        voice_id = self.resolve_voice_id(voice_id)
        meta = DASHSCOPE_VOICES.get(voice_id)
        if meta:
            return meta.get("model", self.model)
        return self.model

    @staticmethod
    def list_voices():
        """返回所有可用音色及其元数据。"""
        return DASHSCOPE_VOICES

    @staticmethod
    def resolve_voice_id(voice_id: str) -> str:
        """把历史旧值映射为厂商真实支持的 voice 参数。"""
        normalized = (voice_id or "").strip()
        if not normalized:
            return normalized
        return VOICE_ALIAS_TO_CANONICAL.get(normalized, normalized)

    @staticmethod
    def is_supported_voice(voice_id: str) -> bool:
        """判断当前音色是否在阿里云官方支持列表里。"""
        canonical_id = TTSProcessor.resolve_voice_id(voice_id)
        return canonical_id in DASHSCOPE_VOICES
