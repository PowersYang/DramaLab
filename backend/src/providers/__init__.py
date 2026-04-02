"""
Provider 层封装外部能力接入。

当前保留有价值的 provider 入口；
其中 `video_model_provider.py` 负责多视频模型路由，
其余能力直接从子目录实现类引入。
"""

from .storage_provider import StorageProvider
from .audio.audio_generation_provider import AudioGenerator
from .image.asset_image_provider import AssetGenerator
from .image.storyboard_image_provider import StoryboardGenerator
from .payment import PaymentProvider, build_payment_provider
from .text.script_processor import ScriptProcessor
from .video_model_provider import VideoModelProvider

__all__ = [
    "AudioGenerator",
    "AssetGenerator",
    "PaymentProvider",
    "StoryboardGenerator",
    "ScriptProcessor",
    "StorageProvider",
    "VideoModelProvider",
    "build_payment_provider",
]
