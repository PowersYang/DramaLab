from ..application.services.model_provider_service import ModelProviderService


def get_provider_base_url(provider: str, default: str = None) -> str:
    """
    读取某个提供方的基础地址。

    优先读取平台管理员在模型供应商配置里设置的 `base_url`；
    没配时再回退到内置默认值。
    """
    return ModelProviderService().get_provider_base_url(provider.upper(), default)


def get_provider_client_base_url(provider: str, default: str = None, default_path: str = "") -> str:
    """
    读取 OpenAI 兼容客户端使用的完整基础地址。

    管理员可以在供应商配置里同时调整基础域名和客户端路径后缀；
    这里统一拼接，避免 LLM/Qwen-VL 各自写死 `/compatible-mode/v1`。
    """
    provider_key = provider.upper()
    service = ModelProviderService()
    configured_path = service.get_provider_setting(provider_key, "client_base_path", default_path)
    return service.build_provider_url(
        provider_key,
        default_base_url=default,
        path_suffix=str(configured_path or ""),
    )
