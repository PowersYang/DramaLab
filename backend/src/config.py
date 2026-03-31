import yaml
import os
import argparse
import re
from typing import Any

from .utils import get_logger
from src.settings.env_settings import get_env

logger = get_logger(__name__)

class Config:
    def __init__(self, config_path: str = None):
        self.config = {}
        if config_path:
            self.load(config_path)

    def load(self, path: str):
        """从 YAML 文件加载配置。"""
        if not os.path.exists(path):
            raise FileNotFoundError(f"Config file not found: {path}")
        
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # 支持在 YAML 里直接写 `${VAR_NAME}` 形式的环境变量占位
        pattern = re.compile(r'\$\{(\w+)\}')
        
        def replace_env(match):
            env_var = match.group(1)
            return get_env(env_var, match.group(0))  # 没命中配置项时保留原占位串
            
        content = pattern.sub(replace_env, content)
        
        self.config = yaml.safe_load(content)
        logger.info(f"Loaded config from {path}")

    def merge_args(self, args: argparse.Namespace):
        """把命令行参数覆盖进配置对象。"""
        # 输入项覆盖
        if args.prompt:
            self.config.setdefault('input', {})['prompt'] = args.prompt
        if args.negative_prompt:
            self.config.setdefault('input', {})['negative_prompt'] = args.negative_prompt
        if args.audio_url:
            self.config.setdefault('input', {})['audio_url'] = args.audio_url
            
        # 模型相关覆盖
        if args.model_name:
             self.config.setdefault('model', {}).setdefault('params', {})['model_name'] = args.model_name

    def get(self, key: str, default: Any = None) -> Any:
        """按点路径读取配置，例如 `model.name`。"""
        keys = key.split('.')
        value = self.config
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
            else:
                return default
        return value if value is not None else default

class ArgParser:
    def parse(self) -> argparse.Namespace:
        parser = argparse.ArgumentParser(description="Video Generation Demo")
        
        parser.add_argument('--config', type=str, default='config/default.yaml', help='Path to configuration file')
        parser.add_argument('--prompt', type=str, help='Input prompt for video generation')
        parser.add_argument('--negative_prompt', type=str, help='Negative prompt')
        parser.add_argument('--audio_url', type=str, help='Audio URL for generation')
        parser.add_argument('--model_name', type=str, help='Model name to use (e.g., wan2.5-t2v-preview)')
        parser.add_argument('--dry-run', action='store_true', help='Run without calling actual APIs')
        
        return parser.parse_args()
