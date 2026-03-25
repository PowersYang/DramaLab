from .wanx import WanxModel
from ..utils import get_logger

try:
    from .kling import KlingModel
except Exception:
    KlingModel = None

try:
    from .vidu import ViduModel
except Exception:
    ViduModel = None

logger = get_logger(__name__)

class ModelFactory:
    @staticmethod
    def create_model(config):
        model_name = config.get('model.name')
        if model_name == 'wanx':
            return WanxModel(config.get('model'))
        elif model_name in ('kling', 'kling-v3'):
            if KlingModel is None:
                raise RuntimeError("KlingModel is unavailable. Check Kling dependencies and configuration.")
            return KlingModel(config.get('model') or {})
        elif model_name in ('vidu', 'viduq3-pro', 'viduq3-turbo'):
            if ViduModel is None:
                raise RuntimeError("ViduModel is unavailable. Check Vidu dependencies and configuration.")
            return ViduModel(config.get('model') or {})
        else:
            raise ValueError(f"Unknown model: {model_name}")
