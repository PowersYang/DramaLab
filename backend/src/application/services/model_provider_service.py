"""平台级模型供应商与模型目录统一管理服务。"""

from __future__ import annotations

import uuid

from ...common.log import get_logger
from ...repository import ModelCatalogEntryRepository, ModelProviderConfigRepository
from ...schemas.models import AvailableModelCatalog, ModelCatalogEntry, ModelProviderConfig, ModelProviderConfigSummary
from ...utils.datetime import utc_now


logger = get_logger(__name__)


PROVIDER_DEFAULTS: dict[str, dict] = {
    "DASHSCOPE": {
        "display_name": "DashScope",
        "description": "阿里云百炼 / 通义系列模型供应商",
        "credential_fields": ["api_key"],
        "default_base_url": "https://dashscope.aliyuncs.com",
        "default_settings": {"default_text_model": "qwen3.5-plus"},
    },
    "OPENAI": {
        "display_name": "OpenAI Compatible",
        "description": "OpenAI 兼容文本供应商配置",
        "credential_fields": ["api_key"],
        "default_base_url": "https://api.openai.com/v1",
        "default_settings": {"default_text_model": "gpt-4o"},
    },
    "KLING": {
        "display_name": "Kling AI",
        "description": "可灵视频生成供应商",
        "credential_fields": ["access_key", "secret_key"],
        "default_base_url": "https://api-beijing.klingai.com/v1",
        "default_settings": {},
    },
    "VIDU": {
        "display_name": "Vidu",
        "description": "Vidu 视频生成供应商",
        "credential_fields": ["api_key"],
        "default_base_url": "https://api.vidu.cn/ent/v2",
        "default_settings": {},
    },
    "ARK": {
        "display_name": "Doubao Ark",
        "description": "火山引擎 Ark / 豆包视频供应商",
        "credential_fields": ["api_key"],
        "default_base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "default_settings": {"default_video_model": "doubao-seedance-1-0-pro-fast-251015"},
    },
}


MODEL_CATALOG_DEFAULTS: list[dict] = [
    {"model_id": "wan2.6-t2i", "task_type": "t2i", "provider_key": "DASHSCOPE", "display_name": "Wan 2.6 T2I", "description": "Latest T2I model", "sort_order": 10},
    {"model_id": "wan2.5-t2i-preview", "task_type": "t2i", "provider_key": "DASHSCOPE", "display_name": "Wan 2.5 T2I Preview", "description": "Default T2I", "sort_order": 20},
    {"model_id": "wan2.2-t2i-plus", "task_type": "t2i", "provider_key": "DASHSCOPE", "display_name": "Wan 2.2 T2I Plus", "description": "Higher quality", "sort_order": 30},
    {"model_id": "wan2.2-t2i-flash", "task_type": "t2i", "provider_key": "DASHSCOPE", "display_name": "Wan 2.2 T2I Flash", "description": "Faster generation", "sort_order": 40},
    {"model_id": "wan2.6-image", "task_type": "i2i", "provider_key": "DASHSCOPE", "display_name": "Wan 2.6 Image", "description": "Latest I2I model (HTTP)", "sort_order": 10},
    {"model_id": "wan2.5-i2i-preview", "task_type": "i2i", "provider_key": "DASHSCOPE", "display_name": "Wan 2.5 I2I Preview", "description": "Default I2I", "sort_order": 20},
    {
        "model_id": "wan2.6-i2v",
        "task_type": "i2v",
        "provider_key": "DASHSCOPE",
        "display_name": "Wan 2.6 I2V / R2V",
        "description": "Latest model, supports R2V",
        "sort_order": 10,
        "capabilities_json": {
            "duration": {"type": "slider", "min": 2, "max": 15, "step": 1, "default": 5},
            "params": {"resolution": {"options": ["480p", "720p", "1080p"], "default": "720p"}, "seed": True, "negativePrompt": True, "promptExtend": True, "shotType": True, "audio": True},
        },
    },
    {
        "model_id": "wan2.6-i2v-flash",
        "task_type": "i2v",
        "provider_key": "DASHSCOPE",
        "display_name": "Wan 2.6 I2V Flash",
        "description": "Fast generation",
        "sort_order": 20,
        "capabilities_json": {
            "duration": {"type": "slider", "min": 2, "max": 15, "step": 1, "default": 5},
            "params": {"resolution": {"options": ["480p", "720p", "1080p"], "default": "720p"}, "seed": True, "negativePrompt": True, "promptExtend": True, "shotType": True, "audio": True},
        },
    },
    {
        "model_id": "wan2.5-i2v-preview",
        "task_type": "i2v",
        "provider_key": "DASHSCOPE",
        "display_name": "Wan 2.5 I2V Preview",
        "description": "Default I2V",
        "sort_order": 30,
        "capabilities_json": {
            "duration": {"type": "buttons", "options": [5, 10], "default": 5},
            "params": {"resolution": {"options": ["480p", "720p", "1080p"], "default": "720p"}, "seed": True, "negativePrompt": True, "audio": True},
        },
    },
    {
        "model_id": "wan2.2-i2v-plus",
        "task_type": "i2v",
        "provider_key": "DASHSCOPE",
        "display_name": "Wan 2.2 I2V Plus",
        "description": "Higher quality",
        "sort_order": 40,
        "capabilities_json": {
            "duration": {"type": "fixed", "value": 5},
            "params": {"resolution": {"options": ["480p", "720p", "1080p"], "default": "720p"}, "seed": True, "negativePrompt": True},
        },
    },
    {
        "model_id": "wan2.2-i2v-flash",
        "task_type": "i2v",
        "provider_key": "DASHSCOPE",
        "display_name": "Wan 2.2 I2V Flash",
        "description": "Faster generation",
        "sort_order": 50,
        "capabilities_json": {
            "duration": {"type": "fixed", "value": 5},
            "params": {"resolution": {"options": ["480p", "720p", "1080p"], "default": "720p"}, "seed": True, "negativePrompt": True},
        },
    },
    {
        "model_id": "kling-v3",
        "task_type": "i2v",
        "provider_key": "KLING",
        "display_name": "Kling v3",
        "description": "Kling AI latest model",
        "sort_order": 60,
        "capabilities_json": {
            "duration": {"type": "slider", "min": 3, "max": 15, "step": 1, "default": 5},
            "params": {"negativePrompt": True, "mode": {"options": ["std", "pro"], "default": "std"}, "sound": True, "cfgScale": {"min": 0, "max": 1, "step": 0.1, "default": 0.5}},
        },
    },
    {
        "model_id": "viduq3-pro",
        "task_type": "i2v",
        "provider_key": "VIDU",
        "display_name": "Vidu Q3 Pro",
        "description": "Vidu latest model",
        "sort_order": 70,
        "capabilities_json": {
            "duration": {"type": "slider", "min": 1, "max": 16, "step": 1, "default": 5},
            "params": {"resolution": {"options": ["540p", "720p", "1080p"], "default": "720p"}, "seed": True, "viduAudio": True, "movementAmplitude": {"options": ["auto", "small", "medium", "large"], "default": "auto"}},
        },
    },
    {
        "model_id": "viduq3-turbo",
        "task_type": "i2v",
        "provider_key": "VIDU",
        "display_name": "Vidu Q3 Turbo",
        "description": "Vidu fast generation",
        "sort_order": 80,
        "capabilities_json": {
            "duration": {"type": "slider", "min": 1, "max": 16, "step": 1, "default": 5},
            "params": {"resolution": {"options": ["540p", "720p", "1080p"], "default": "720p"}, "seed": True, "viduAudio": True, "movementAmplitude": {"options": ["auto", "small", "medium", "large"], "default": "auto"}},
        },
    },
]


MODEL_ID_ALIASES = {
    "wan2.6-r2v": "wan2.6-i2v",
}

TEXT_PROVIDER_KEYS = {"OPENAI", "DASHSCOPE"}
TEXT_PROVIDER_DEFAULT_FLAGS = ("is_default_text_provider", "default_for_text")


class ModelProviderService:
    """统一管理模型供应商配置、模型目录和运行时读取。"""

    def __init__(self):
        self.provider_repository = ModelProviderConfigRepository()
        self.catalog_repository = ModelCatalogEntryRepository()

    def ensure_defaults(self) -> None:
        """补种默认供应商和模型目录。"""
        for provider_key, meta in PROVIDER_DEFAULTS.items():
            existing = self.provider_repository.get(provider_key)
            if existing is not None:
                continue
            now = utc_now()
            self.provider_repository.upsert(
                ModelProviderConfig(
                    provider_key=provider_key,
                    display_name=meta["display_name"],
                    description=meta.get("description"),
                    enabled=False,
                    base_url=None,
                    credentials_json={},
                    settings_json=dict(meta.get("default_settings", {})),
                    created_at=now,
                    updated_at=now,
                )
            )

        for item in MODEL_CATALOG_DEFAULTS:
            existing = self.catalog_repository.get(item["model_id"])
            if existing is not None:
                continue
            now = utc_now()
            self.catalog_repository.create(
                ModelCatalogEntry(
                    model_id=item["model_id"],
                    task_type=item["task_type"],
                    provider_key=item["provider_key"],
                    display_name=item["display_name"],
                    description=item.get("description"),
                    enabled=True,
                    sort_order=item.get("sort_order", 100),
                    is_public=item.get("is_public", True),
                    capabilities_json=item.get("capabilities_json", {}),
                    default_settings_json=item.get("default_settings_json", {}),
                    created_at=now,
                    updated_at=now,
                )
            )

    def list_provider_summaries(self) -> list[ModelProviderConfigSummary]:
        """返回脱敏后的供应商摘要列表。"""
        providers = self.provider_repository.list()
        summaries = []
        for item in providers:
            meta = PROVIDER_DEFAULTS.get(item.provider_key, {})
            credential_fields = list(meta.get("credential_fields", []))
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
            if value is not None:
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
        meta = PROVIDER_DEFAULTS.get(item.provider_key, {})
        dynamic_fields = list((item.settings_json or {}).get("_credential_fields", []))
        credential_fields = list(meta.get("credential_fields", [])) or dynamic_fields
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
        grouped = {"t2i": [], "i2i": [], "i2v": []}
        for item in self.catalog_repository.list():
            provider = providers.get(item.provider_key)
            if provider is None or not provider.enabled or not item.enabled or not item.is_public:
                continue
            grouped.setdefault(item.task_type, []).append(item)
        return AvailableModelCatalog(
            t2i=grouped.get("t2i", []),
            i2i=grouped.get("i2i", []),
            i2v=grouped.get("i2v", []),
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
        config = self.provider_repository.get(provider_key)
        if config is None:
            fallback = default or PROVIDER_DEFAULTS.get(provider_key, {}).get("default_base_url", "")
            return fallback.rstrip("/")
        base_url = (config.base_url or "").strip()
        if base_url:
            return base_url.rstrip("/")
        fallback = default or PROVIDER_DEFAULTS.get(provider_key, {}).get("default_base_url", "")
        return fallback.rstrip("/")

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
            default_model = str(
                settings.get("default_text_model")
                or PROVIDER_DEFAULTS.get(provider_key, {}).get("default_settings", {}).get("default_text_model")
                or ""
            ).strip()
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
            if catalog_entry is not None:
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
            if not default_binding["default_model"]:
                raise ValueError(
                    f"Default text provider {default_binding['provider_key']} is missing default_text_model configuration"
                )
            return {
                "provider_key": str(default_binding["provider_key"]),
                "provider_name": str(default_binding["provider_name"]),
                "model_id": str(default_binding["default_model"]),
            }
        if len(default_bindings) > 1:
            providers = ", ".join(sorted(str(binding["provider_key"]) for binding in default_bindings))
            raise ValueError(f"Multiple default text providers are configured: {providers}")

        if len(bindings) == 1:
            binding = bindings[0]
            if not binding["default_model"]:
                raise ValueError(f"Text provider {binding['provider_key']} is missing default_text_model configuration")
            return {
                "provider_key": str(binding["provider_key"]),
                "provider_name": str(binding["provider_name"]),
                "model_id": str(binding["default_model"]),
            }

        if not bindings:
            raise ValueError("No enabled text provider with API credentials is configured")

        providers = ", ".join(sorted(str(binding["provider_key"]) for binding in bindings))
        raise ValueError(
            "Multiple text providers are enabled but no explicit default is configured: "
            f"{providers}. Set settings_json.is_default_text_provider=true on exactly one provider "
            "or pass a model_id explicitly."
        )

    def ensure_model_settings_allowed(self, settings_updates: dict[str, str]) -> None:
        mapping = {"t2i_model": "t2i", "i2i_model": "i2i", "i2v_model": "i2v"}
        for field_name, task_type in mapping.items():
            model_id = settings_updates.get(field_name)
            if model_id:
                self.require_model_enabled(model_id, task_type)
