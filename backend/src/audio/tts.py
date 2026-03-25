"""
基于 DashScope CosyVoice 的文本转语音模块。
用于把对白文本转换成可用于口型驱动或配音的音频。

兼容 `cosyvoice-v2` 与 `cosyvoice-v3-flash/v3-plus` 系列模型。
"""
import logging
import os
import time
from typing import Optional, Tuple

try:
    import dashscope
    from dashscope.audio.tts_v2 import SpeechSynthesizer
except ImportError:
    dashscope = None
    SpeechSynthesizer = None

logger = logging.getLogger(__name__)


# 语音注册表：key -> {model_id, name, gender, model}
# `model_id` 必须和实际模型版本对应：v2 音色走 cosyvoice-v2，v3 音色走 cosyvoice-v3-*
VOICES = {
    # === cosyvoice-v2 音色 ===
    'longxiaochun': {'model_id': 'longxiaochun_v2', 'name': '龙小淳 (知性女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longxiaoxia': {'model_id': 'longxiaoxia_v2', 'name': '龙小夏 (沉稳女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longyue': {'model_id': 'longyue_v2', 'name': '龙悦 (温柔女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longmiao': {'model_id': 'longmiao_v2', 'name': '龙淼 (有声书女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longyuan': {'model_id': 'longyuan_v2', 'name': '龙媛 (治愈女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longhua': {'model_id': 'longhua_v2', 'name': '龙华 (活力甜美女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longwan': {'model_id': 'longwan_v2', 'name': '龙婉 (知性女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longxing': {'model_id': 'longxing_v2', 'name': '龙星 (邻家女孩)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longfeifei': {'model_id': 'longfeifei_v2', 'name': '龙菲菲 (甜美女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longyan': {'model_id': 'longyan_v2', 'name': '龙言 (温柔女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longqiang': {'model_id': 'longqiang_v2', 'name': '龙蔷 (浪漫女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'longxiu': {'model_id': 'longxiu_v2', 'name': '龙修 (博学男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longnan': {'model_id': 'longnan_v2', 'name': '龙楠 (睿智少年)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longcheng': {'model_id': 'longcheng_v2', 'name': '龙诚 (睿智青年)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longze': {'model_id': 'longze_v2', 'name': '龙泽 (阳光男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longzhe': {'model_id': 'longzhe_v2', 'name': '龙哲 (暖心男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longtian': {'model_id': 'longtian_v2', 'name': '龙天 (磁性男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longhan': {'model_id': 'longhan_v2', 'name': '龙翰 (深情男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longhao': {'model_id': 'longhao_v2', 'name': '龙浩 (忧郁男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longshu': {'model_id': 'longshu_v2', 'name': '龙书 (播报男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longshuo': {'model_id': 'longshuo_v2', 'name': '龙朔 (博学男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longfei': {'model_id': 'longfei_v2', 'name': '龙飞 (磁性朗诵男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longxiaocheng': {'model_id': 'longxiaocheng_v2', 'name': '龙小诚 (低音男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longshao': {'model_id': 'longshao_v2', 'name': '龙少 (阳光男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longjielidou': {'model_id': 'longjielidou_v2', 'name': '龙杰力豆 (童声男)', 'gender': 'Male', 'model': 'cosyvoice-v2'},
    'longhuhu': {'model_id': 'longhuhu', 'name': '龙虎虎 (童声女)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'loongstella': {'model_id': 'loongstella_v2', 'name': 'Stella (English Female)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    'loongbella': {'model_id': 'loongbella_v2', 'name': 'Bella (English Female)', 'gender': 'Female', 'model': 'cosyvoice-v2'},
    # === cosyvoice-v3 音色（需搭配 cosyvoice-v3-flash 或 cosyvoice-v3-plus）===
    'longanyang': {'model_id': 'longanyang', 'name': '龙安阳 (阳光少年)', 'gender': 'Male', 'model': 'cosyvoice-v3-flash'},
    'longanhuan': {'model_id': 'longanhuan', 'name': '龙安欢 (活力女)', 'gender': 'Female', 'model': 'cosyvoice-v3-flash'},
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

        未显式传 `api_key` 时，会自动读取 `DASHSCOPE_API_KEY`。
        """
        if dashscope is None:
            raise RuntimeError("dashscope package not installed. Run: pip install dashscope")

        self.api_key = api_key or os.getenv('DASHSCOPE_API_KEY')
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
        voice = voice or self.voice

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
        for meta in VOICES.values():
            if meta['model_id'] == voice_id:
                return meta.get('model', self.model)
        return self.model

    @staticmethod
    def list_voices():
        """返回所有可用音色及其元数据。"""
        return VOICES
