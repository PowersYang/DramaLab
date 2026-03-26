from src.settings.env_settings import get_env

# 提供方默认端点表：{provider_key: default_base_url}
PROVIDER_DEFAULTS = {
    "DASHSCOPE": "https://dashscope.aliyuncs.com",
    "KLING": "https://api-beijing.klingai.com/v1",
    "VIDU": "https://api.vidu.cn/ent/v2",
}


def get_provider_base_url(provider: str, default: str = None) -> str:
    """
    读取某个提供方的基础地址。

    默认会优先读取 `{PROVIDER}_BASE_URL` 环境变量；
    没配时再回退到内置默认值。
    """
    env_key = f"{provider.upper()}_BASE_URL"
    fallback = default or PROVIDER_DEFAULTS.get(provider.upper(), "")
    return (get_env(env_key) or fallback).rstrip("/")
