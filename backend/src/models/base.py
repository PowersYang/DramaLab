from abc import ABC, abstractmethod
from typing import Dict, Any, Tuple

class VideoGenModel(ABC):
    """视频生成模型的抽象基类。"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config

    @abstractmethod
    def generate(self, prompt: str, output_path: str, **kwargs) -> Tuple[str, float]:
        """根据提示词生成视频，并返回 `(输出路径, 接口耗时秒数)`。"""
        pass
