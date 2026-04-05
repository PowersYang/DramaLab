"""平台级模型供应商与模型目录统一管理服务。"""

from __future__ import annotations

import uuid

from ...common.log import get_logger
from ...repository import ModelCatalogEntryRepository, ModelProviderConfigRepository
from ...schemas.models import AvailableModelCatalog, ModelCatalogEntry, ModelProviderConfig, ModelProviderConfigSummary
from ...utils.datetime import utc_now


logger = get_logger(__name__)


MODEL_ID_ALIASES = {
    "wan2.6-r2v": "wan2.6-i2v",
}

MODEL_TASK_TYPES = ("t2i", "i2i", "i2v", "llm")
TEXT_PROVIDER_KEYS = {"OPENAI", "DASHSCOPE"}
TEXT_PROVIDER_DEFAULT_FLAGS = ("is_default_text_provider", "default_for_text")
TEXT_PROVIDER_FALLBACK_MODELS = {
    "DASHSCOPE": "qwen3.5-plus",
    "OPENAI": "gpt-4.1",
}
MODEL_REQUIRED_SETTINGS: dict[tuple[str, str], tuple[str, ...]] = {
    ("wan2.6-t2i", "t2i"): ("request_path",),
    ("wan2.6-image", "i2i"): ("create_path", "poll_path_template"),
    ("wan2.6-i2v", "i2v"): ("submit_path", "poll_path_template"),
    ("vidu-q1", "i2v"): ("submit_path", "poll_path_template"),
    ("vidu-2.0", "i2v"): ("submit_path", "poll_path_template"),
    ("kling-v1", "i2v"): ("submit_path", "poll_path_template"),
    ("kling-v1-6", "i2v"): ("submit_path", "poll_path_template"),
    ("kling-v2-1", "i2v"): ("submit_path", "poll_path_template"),
    ("kling-v2-1-master", "i2v"): ("submit_path", "poll_path_template"),
    ("kling-v3", "i2v"): ("submit_path", "poll_path_template"),
}
SAFE_MODEL_FALLBACKS: dict[str, tuple[str, ...]] = {
    "t2i": ("wan2.5-t2i-preview", "wan2.2-t2i-plus", "wan2.2-t2i-flash"),
    "i2i": ("wan2.5-i2i-preview",),
    "i2v": ("wan2.5-i2v-preview",),
}


class ModelProviderService:
    """统一管理模型供应商配置、模型目录和运行时读取。"""

    def __init__(self):
        self.provider_repository = ModelProviderConfigRepository()
        self.catalog_repository = ModelCatalogEntryRepository()

    def list_provider_summaries(self) -> list[ModelProviderConfigSummary]:
        """返回脱敏后的供应商摘要列表。"""
        providers = self.provider_repository.list()
        summaries = []
        for item in providers:
            credential_fields = list((item.settings_json or {}).get("_credential_fields", []))
            configured_fields = [field for field in credential_fields if (item.credentials_json or {}).get(field)]
            summaries.append(
                ModelProviderConfigSummary(
                    provider_key=item.provider_key,
                    display_name=item.display_name,
                    description=item.description,
                    enabled=item.enabled,
                    base_url=item.base_url,
                    credential_fields=credential_fields,
                    configured_fields=configured_fields,
                    has_credentials=bool(configured_fields),
                    settings_json=item.settings_json or {},
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
            )
        return summaries

    def create_provider(self, payload: dict, actor_id: str | None = None) -> ModelProviderConfigSummary:
        """创建新的平台级模型供应商配置。"""
        provider_key = str(payload["provider_key"]).strip().upper()
        if not provider_key:
            raise ValueError("Provider key is required")
        if self.provider_repository.get(provider_key) is not None:
            raise ValueError(f"Model provider already exists: {provider_key}")

        declared_fields = [str(field).strip() for field in payload.get("credential_fields", []) if str(field).strip()]
        credentials = {}
        for key, value in (payload.get("credentials_patch") or {}).items():
            if isinstance(value, str) and value.strip():
                credentials[str(key).strip()] = value.strip()
                if str(key).strip() not in declared_fields:
                    declared_fields.append(str(key).strip())

        now = utc_now()
        created = self.provider_repository.create(
            ModelProviderConfig(
                provider_key=provider_key,
                display_name=str(payload["display_name"]).strip(),
                description=(payload.get("description") or None),
                enabled=bool(payload.get("enabled", False)),
                base_url=(str(payload.get("base_url") or "").strip() or None),
                credentials_json=credentials,
                settings_json={
                    **dict(payload.get("settings_json") or {}),
                    "_credential_fields": declared_fields,
                },
                created_by=actor_id,
                updated_by=actor_id,
                created_at=now,
                updated_at=now,
            )
        )
        return self._to_summary(created)

    def update_provider(
        self,
        provider_key: str,
        *,
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool | None = None,
        base_url: str | None = None,
        credentials_patch: dict[str, str | None] | None = None,
        settings_patch: dict[str, object] | None = None,
        actor_id: str | None = None,
    ) -> ModelProviderConfigSummary:
        current = self.provider_repository.get(provider_key)
        if current is None:
            raise ValueError("Model provider not found")
        next_enabled = current.enabled if enabled is None else enabled
        credentials = dict(current.credentials_json or {})
        for key, value in (credentials_patch or {}).items():
            if value is None:
                continue
            if isinstance(value, str) and value.strip() == "__CLEAR__":
                credentials.pop(key, None)
            elif isinstance(value, str) and value.strip():
                credentials[key] = value.strip()
        settings = dict(current.settings_json or {})
        for key, value in (settings_patch or {}).items():
            if value is None:
                settings.pop(key, None)
            else:
                settings[key] = value
        updated = self.provider_repository.update(
            provider_key,
            {
                "display_name": display_name or current.display_name,
                "description": description if description is not None else current.description,
                "enabled": next_enabled,
                "base_url": (base_url.strip() if isinstance(base_url, str) and base_url.strip() else None) if base_url is not None else current.base_url,
                "credentials_json": credentials,
                "settings_json": settings,
                "updated_by": actor_id,
            },
        )
        # 中文注释：供应商被停用时，同步把其下所有模型设为停用，避免前台继续看到已失效模型。
        if not next_enabled:
            self.catalog_repository.set_enabled_by_provider(provider_key, False, updated_by=actor_id)
        return self._to_summary(updated)

    def delete_provider(self, provider_key: str) -> dict[str, str]:
        """删除模型供应商，删除前要求没有模型目录项仍引用它。"""
        current = self.provider_repository.get(provider_key)
        if current is None:
            raise ValueError("Model provider not found")
        if any(item.provider_key == provider_key for item in self.catalog_repository.list()):
            raise ValueError("Model provider still has dependent catalog entries")
        self.provider_repository.delete(provider_key)
        return {"status": "deleted", "provider_key": provider_key}

    def _to_summary(self, item: ModelProviderConfig) -> ModelProviderConfigSummary:
        """把完整配置对象转换成脱敏摘要。"""
        credential_fields = list((item.settings_json or {}).get("_credential_fields", []))
        configured_fields = [field for field in credential_fields if (item.credentials_json or {}).get(field)]
        return ModelProviderConfigSummary(
            provider_key=item.provider_key,
            display_name=item.display_name,
            description=item.description,
            enabled=item.enabled,
            base_url=item.base_url,
            credential_fields=credential_fields,
            configured_fields=configured_fields,
            has_credentials=bool(configured_fields),
            settings_json=item.settings_json or {},
            created_by=item.created_by,
            updated_by=item.updated_by,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    def list_model_catalog(self, task_type: str | None = None) -> list[ModelCatalogEntry]:
        """列出平台模型目录。"""
        return self.catalog_repository.list(task_type=task_type)

    def create_model_catalog_entry(self, payload: dict, actor_id: str | None = None) -> ModelCatalogEntry:
        """创建新的模型目录项。"""
        provider = self.provider_repository.get(payload["provider_key"])
        if provider is None:
            raise ValueError("Model provider not found")
        if payload.get("enabled", True) and not provider.enabled:
            raise ValueError(f"Cannot enable model under disabled provider: {payload['provider_key']}")
        now = utc_now()
        return self.catalog_repository.create(
            ModelCatalogEntry(
                model_id=payload["model_id"],
                task_type=payload["task_type"],
                provider_key=payload["provider_key"],
                display_name=payload["display_name"],
                description=payload.get("description"),
                enabled=payload.get("enabled", True),
                sort_order=payload.get("sort_order", 100),
                is_public=payload.get("is_public", True),
                capabilities_json=payload.get("capabilities_json", {}),
                default_settings_json=payload.get("default_settings_json", {}),
                created_by=actor_id,
                updated_by=actor_id,
                created_at=now,
                updated_at=now,
            )
        )

    def update_model_catalog_entry(self, model_id: str, payload: dict, actor_id: str | None = None) -> ModelCatalogEntry:
        """更新模型目录项。"""
        current = self.catalog_repository.get(model_id)
        if current is None:
            raise ValueError("Model catalog entry not found")
        provider_key = payload.get("provider_key", current.provider_key)
        provider = self.provider_repository.get(provider_key)
        if provider is None:
            raise ValueError("Model provider not found")
        next_enabled = payload.get("enabled", current.enabled)
        if next_enabled and not provider.enabled:
            raise ValueError(f"Cannot enable model under disabled provider: {provider_key}")
        payload = {**payload, "updated_by": actor_id}
        return self.catalog_repository.update(model_id, payload)

    def delete_model_catalog_entry(self, model_id: str) -> dict[str, str]:
        """删除模型目录项。"""
        current = self.catalog_repository.get(model_id)
        if current is None:
            raise ValueError("Model catalog entry not found")
        self.catalog_repository.delete(model_id)
        return {"status": "deleted", "model_id": model_id}

    def list_available_models(self) -> AvailableModelCatalog:
        """返回业务前台可见的模型目录。"""
        providers = self.provider_repository.list_map()
        grouped = {task_type: [] for task_type in MODEL_TASK_TYPES}
        for item in self.catalog_repository.list():
            provider = providers.get(item.provider_key)
            if provider is None or not provider.enabled or not item.enabled or not item.is_public:
                continue
            if not self.model_is_runtime_ready(item.model_id, item.task_type):
                logger.warning(
                    "模型目录：跳过未完成运行时配置的模型 model_id=%s task_type=%s",
                    item.model_id,
                    item.task_type,
                )
                continue
            grouped.setdefault(item.task_type, []).append(item)
        return AvailableModelCatalog(
            t2i=grouped.get("t2i", []),
            i2i=grouped.get("i2i", []),
            i2v=grouped.get("i2v", []),
            llm=grouped.get("llm", []),
        )

    def require_model_enabled(self, model_id: str, task_type: str | None = None) -> ModelCatalogEntry:
        normalized = MODEL_ID_ALIASES.get(model_id, model_id)
        item = self.catalog_repository.get(normalized)
        if item is None:
            raise ValueError(f"Model is not registered: {normalized}")
        if task_type and item.task_type != task_type:
            raise ValueError(f"Model {normalized} does not support task type {task_type}")
        provider = self.provider_repository.get(item.provider_key)
        if provider is None or not provider.enabled:
            raise ValueError(f"Model provider is unavailable: {item.provider_key}")
        if not item.enabled:
            raise ValueError(f"Model has been disabled by administrator: {normalized}")
        return item

    def get_required_model_settings(self, model_id: str, task_type: str | None = None) -> tuple[str, ...]:
        """返回模型执行前必须具备的运行时设置键。"""
        normalized = MODEL_ID_ALIASES.get(model_id, model_id)
        return MODEL_REQUIRED_SETTINGS.get((normalized, task_type or ""), ())

    def model_is_runtime_ready(self, model_id: str, task_type: str | None = None) -> bool:
        """判断模型是否已经具备运行所需的关键设置。"""
        for setting_key in self.get_required_model_settings(model_id, task_type):
            value = self.get_model_setting(model_id, setting_key, task_type=task_type, default=None)
            if value is None or (isinstance(value, str) and not value.strip()):
                return False
        return True

    def ensure_model_runtime_ready(self, model_id: str, task_type: str | None = None) -> None:
        """在保存模型设置或执行任务前，显式校验模型运行时必填项。"""
        for setting_key in self.get_required_model_settings(model_id, task_type):
            self.require_model_setting(model_id, setting_key, task_type=task_type)

    def resolve_model_execution_plan(self, preferred_model_id: str | None, task_type: str) -> dict[str, str | None]:
        """返回模型执行计划，便于任务结果向前端解释是否发生过回退。"""
        requested_model = MODEL_ID_ALIASES.get(preferred_model_id, preferred_model_id) if preferred_model_id else None
        resolved_model = self.resolve_model_for_execution(preferred_model_id, task_type)
        fallback_reason = None
        if requested_model and requested_model != resolved_model:
            fallback_reason = f"模型 {requested_model} 当前不可用，系统已回退到可运行模型 {resolved_model}"
        return {
            "requested_model": requested_model or resolved_model,
            "resolved_model": resolved_model,
            "fallback_reason": fallback_reason,
        }

    def resolve_model_for_execution(self, preferred_model_id: str | None, task_type: str) -> str:
        """返回当前任务真正可执行的模型；首选用户配置，缺配置时回退到同类型安全模型。"""
        if preferred_model_id:
            try:
                self.require_model_enabled(preferred_model_id, task_type)
                self.ensure_model_runtime_ready(preferred_model_id, task_type)
                return MODEL_ID_ALIASES.get(preferred_model_id, preferred_model_id)
            except ValueError as exc:
                logger.warning(
                    "模型路由：首选模型不可执行，将尝试回退 preferred_model=%s task_type=%s reason=%s",
                    preferred_model_id,
                    task_type,
                    exc,
                )

        for candidate in SAFE_MODEL_FALLBACKS.get(task_type, ()):
            try:
                self.require_model_enabled(candidate, task_type)
                self.ensure_model_runtime_ready(candidate, task_type)
                logger.info(
                    "模型路由：已回退到安全模型 fallback_model=%s task_type=%s preferred_model=%s",
                    candidate,
                    task_type,
                    preferred_model_id,
                )
                return candidate
            except ValueError:
                continue

        for item in self.list_available_models().model_dump().get(task_type, []):
            candidate = item.get("model_id")
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()

        normalized = MODEL_ID_ALIASES.get(preferred_model_id, preferred_model_id) if preferred_model_id else None
        if normalized:
            raise ValueError(f"Model {normalized} does not have a runnable configuration for task type {task_type}")
        raise ValueError(f"No runnable model is available for task type {task_type}")

    def get_provider_config(self, provider_key: str) -> ModelProviderConfig:
        config = self.provider_repository.get(provider_key)
        if config is None:
            raise ValueError(f"Model provider is not configured: {provider_key}")
        return config

    def get_provider_credential(self, provider_key: str, field_name: str) -> str | None:
        config = self.get_provider_config(provider_key)
        if not config.enabled:
            raise RuntimeError(f"Model provider is disabled: {provider_key}")
        value = (config.credentials_json or {}).get(field_name)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def get_provider_base_url(self, provider_key: str, default: str | None = None) -> str:
        provider_key = provider_key.upper()
        config = self.provider_repository.get(provider_key)
        if config is None:
            if default:
                return default.rstrip("/")
            raise ValueError(f"Model provider is not configured: {provider_key}")
        base_url = (config.base_url or "").strip()
        if base_url:
            return base_url.rstrip("/")
        if default:
            return default.rstrip("/")
        raise ValueError(f"Model provider {provider_key} is missing base_url configuration")

    def get_provider_setting(self, provider_key: str, setting_key: str, default: object | None = None) -> object | None:
        """统一读取供应商级运行时设置，缺失时仅回退到调用方显式传入的默认值。"""
        provider_key = provider_key.upper()
        config = self.provider_repository.get(provider_key)
        settings = config.settings_json if config is not None else {}
        if setting_key in settings:
            return settings.get(setting_key)
        return default

    def build_provider_url(
        self,
        provider_key: str,
        *,
        base_url: str | None = None,
        path_suffix: str | None = None,
        default_base_url: str | None = None,
        default_path_suffix: str | None = None,
    ) -> str:
        """拼接供应商基础地址与相对路径，避免各模型层重复处理斜杠。"""
        provider_key = provider_key.upper()
        resolved_base_url = (base_url or self.get_provider_base_url(provider_key, default_base_url)).rstrip("/")
        resolved_path_suffix = str(path_suffix if path_suffix is not None else default_path_suffix or "").strip()
        if not resolved_path_suffix:
            return resolved_base_url
        normalized_path = "/" + resolved_path_suffix.strip("/")
        return f"{resolved_base_url}{normalized_path}"

    def get_model_catalog_entry(self, model_id: str) -> ModelCatalogEntry | None:
        """按模型 ID 读取目录项，兼容历史别名。"""
        return self.catalog_repository.get(MODEL_ID_ALIASES.get(model_id, model_id))

    def get_model_setting(
        self,
        model_id: str,
        setting_key: str,
        *,
        task_type: str | None = None,
        default: object | None = None,
    ) -> object | None:
        """读取模型目录项里的运行时参数，便于管理员覆盖请求路径等细节。"""
        entry = self.get_model_catalog_entry(model_id)
        if entry is None:
            return default
        if task_type and entry.task_type != task_type:
            return default
        settings = entry.default_settings_json or {}
        return settings.get(setting_key, default)

    def require_model_setting(self, model_id: str, setting_key: str, *, task_type: str | None = None) -> object:
        """读取模型级运行时设置；缺失时抛出明确错误，避免继续走代码硬编码。"""
        value = self.get_model_setting(model_id, setting_key, task_type=task_type, default=None)
        if value is None or (isinstance(value, str) and not value.strip()):
            task_type_label = f" ({task_type})" if task_type else ""
            raise ValueError(
                f"Model {model_id}{task_type_label} is missing required setting: default_settings_json.{setting_key}"
            )
        return value


    def _list_text_provider_bindings(self) -> list[dict[str, object]]:
        """收集当前可用于文本能力路由的 provider 绑定信息。"""
        bindings: list[dict[str, object]] = []
        for provider_key in sorted(TEXT_PROVIDER_KEYS):
            provider = self.provider_repository.get(provider_key)
            if provider is None or not provider.enabled:
                continue

            credentials = provider.credentials_json or {}
            api_key = credentials.get("api_key")
            if not isinstance(api_key, str) or not api_key.strip():
                continue

            settings = provider.settings_json or {}
            default_model = str(settings.get("default_text_model") or "").strip()
            supported_models_raw = settings.get("supported_text_models")
            supported_models = []
            if isinstance(supported_models_raw, list):
                supported_models = [
                    str(item).strip()
                    for item in supported_models_raw
                    if isinstance(item, str) and str(item).strip()
                ]
            if default_model and default_model not in supported_models:
                supported_models.insert(0, default_model)

            bindings.append(
                {
                    "provider_key": provider_key,
                    "provider_name": provider_key.lower(),
                    "default_model": default_model,
                    "supported_models": supported_models,
                    "is_default": any(bool(settings.get(flag)) for flag in TEXT_PROVIDER_DEFAULT_FLAGS),
                }
            )
        return bindings

    def resolve_text_binding(self, model_id: str | None = None) -> dict[str, str]:
        """根据显式模型或平台默认配置解析文本模型与 provider 的绑定关系。"""
        requested_model_id = str(model_id or "").strip()
        bindings = self._list_text_provider_bindings()

        if requested_model_id:
            normalized_model_id = MODEL_ID_ALIASES.get(requested_model_id, requested_model_id)
            catalog_entry = self.catalog_repository.get(normalized_model_id)
            if catalog_entry is not None and catalog_entry.task_type == "llm":
                provider = self.provider_repository.get(catalog_entry.provider_key)
                if provider is None or not provider.enabled:
                    raise ValueError(f"Model provider is unavailable: {catalog_entry.provider_key}")
                api_key = (provider.credentials_json or {}).get("api_key")
                if not isinstance(api_key, str) or not api_key.strip():
                    raise ValueError(f"Model provider is missing API credentials: {catalog_entry.provider_key}")
                return {
                    "provider_key": catalog_entry.provider_key,
                    "provider_name": catalog_entry.provider_key.lower(),
                    "model_id": catalog_entry.model_id,
                }
            if catalog_entry is not None and catalog_entry.task_type != "llm":
                raise ValueError(f"Model {normalized_model_id} is registered as {catalog_entry.task_type}, not llm")

            matches = [
                binding
                for binding in bindings
                if requested_model_id == binding["default_model"] or requested_model_id in binding["supported_models"]
            ]
            if len(matches) == 1:
                match = matches[0]
                return {
                    "provider_key": str(match["provider_key"]),
                    "provider_name": str(match["provider_name"]),
                    "model_id": requested_model_id,
                }
            if len(matches) > 1:
                providers = ", ".join(sorted(str(match["provider_key"]) for match in matches))
                raise ValueError(f"Text model {requested_model_id} is ambiguous across providers: {providers}")
            raise ValueError(f"Text model is not registered or configured: {requested_model_id}")

        default_bindings = [binding for binding in bindings if binding["is_default"]]
        if len(default_bindings) == 1:
            default_binding = default_bindings[0]
            resolved_default_model = self._resolve_binding_default_model(default_binding)
            if not resolved_default_model:
                raise ValueError(
                    f"Default text provider {default_binding['provider_key']} is missing default_text_model configuration"
                )
            return {
                "provider_key": str(default_binding["provider_key"]),
                "provider_name": str(default_binding["provider_name"]),
                "model_id": resolved_default_model,
            }
        if len(default_bindings) > 1:
            providers = ", ".join(sorted(str(binding["provider_key"]) for binding in default_bindings))
            raise ValueError(f"Multiple default text providers are configured: {providers}")

        if len(bindings) == 1:
            binding = bindings[0]
            resolved_default_model = self._resolve_binding_default_model(binding)
            if not resolved_default_model:
                raise ValueError(f"Text provider {binding['provider_key']} is missing default_text_model configuration")
            return {
                "provider_key": str(binding["provider_key"]),
                "provider_name": str(binding["provider_name"]),
                "model_id": resolved_default_model,
            }

        if not bindings:
            raise ValueError("No enabled text provider with API credentials is configured")

        providers = ", ".join(sorted(str(binding["provider_key"]) for binding in bindings))
        raise ValueError(
            "Multiple text providers are enabled but no explicit default is configured: "
            f"{providers}. Set settings_json.is_default_text_provider=true on exactly one provider "
            "or pass a model_id explicitly."
        )

    @staticmethod
    def _resolve_binding_default_model(binding: dict[str, object]) -> str | None:
        """为单 provider 或默认 provider 兜底一个稳定的文本模型，避免缺少显式默认值时无法读取公共设置。"""
        default_model = str(binding.get("default_model") or "").strip()
        if default_model:
            return default_model

        supported_models = binding.get("supported_models") or []
        if supported_models:
            first_supported = str(supported_models[0]).strip()
            if first_supported:
                return first_supported

        provider_key = str(binding.get("provider_key") or "").strip().upper()
        fallback = TEXT_PROVIDER_FALLBACK_MODELS.get(provider_key)
        if isinstance(fallback, str) and fallback.strip():
            return fallback.strip()
        return None

    def ensure_model_settings_allowed(self, settings_updates: dict[str, str]) -> None:
        mapping = {"t2i_model": "t2i", "i2i_model": "i2i", "i2v_model": "i2v"}
        for field_name, task_type in mapping.items():
            model_id = settings_updates.get(field_name)
            if model_id:
                self.require_model_enabled(model_id, task_type)
                self.ensure_model_runtime_ready(model_id, task_type)
