from ..application.services.model_provider_service import ModelProviderService, PROVIDER_DEFAULTS


def get_provider_base_url(provider: str, default: str = None) -> str:
    """
    读取某个提供方的基础地址。

    默认会优先读取 `{PROVIDER}_BASE_URL` 环境变量；
    没配时再回退到内置默认值。
    """
    fallback = default or PROVIDER_DEFAULTS.get(provider.upper(), {}).get("default_base_url", "")
    return ModelProviderService().get_provider_base_url(provider.upper(), fallback)
