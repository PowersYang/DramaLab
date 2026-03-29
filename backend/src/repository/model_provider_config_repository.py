"""平台级模型供应商配置仓储。"""

from ..db.models import ModelProviderConfigRecord
from ..schemas.models import ModelProviderConfig
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: ModelProviderConfigRecord) -> ModelProviderConfig:
    return ModelProviderConfig(
        provider_key=record.provider_key,
        display_name=record.display_name,
        description=record.description,
        enabled=record.enabled,
        base_url=record.base_url,
        credentials_json=record.credentials_json or {},
        settings_json=record.settings_json or {},
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class ModelProviderConfigRepository(BaseRepository[ModelProviderConfig]):
    """供应商配置的增删改查。"""

    def list(self) -> list[ModelProviderConfig]:
        with self._with_session() as session:
            records = session.query(ModelProviderConfigRecord).order_by(ModelProviderConfigRecord.provider_key.asc()).all()
            return [_to_domain(record) for record in records]

    def get(self, provider_key: str) -> ModelProviderConfig | None:
        with self._with_session() as session:
            record = session.get(ModelProviderConfigRecord, provider_key)
            return _to_domain(record) if record else None

    def upsert(self, config: ModelProviderConfig) -> ModelProviderConfig:
        with self._with_session() as session:
            record = session.get(ModelProviderConfigRecord, config.provider_key)
            if record is None:
                record = ModelProviderConfigRecord(
                    provider_key=config.provider_key,
                    display_name=config.display_name,
                    description=config.description,
                    enabled=config.enabled,
                    base_url=config.base_url,
                    credentials_json=config.credentials_json,
                    settings_json=config.settings_json,
                    created_by=config.created_by,
                    updated_by=config.updated_by,
                    created_at=config.created_at,
                    updated_at=config.updated_at,
                )
                session.add(record)
            else:
                record.display_name = config.display_name
                record.description = config.description
                record.enabled = config.enabled
                record.base_url = config.base_url
                record.credentials_json = config.credentials_json
                record.settings_json = config.settings_json
                record.updated_by = config.updated_by
                record.updated_at = utc_now()
            return _to_domain(record)

    def update(self, provider_key: str, patch: dict) -> ModelProviderConfig:
        with self._with_session() as session:
            record = session.get(ModelProviderConfigRecord, provider_key)
            if record is None:
                raise ValueError("Model provider not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_domain(record)

    def list_map(self):
        return {item.provider_key: item for item in self.list()}

    def sync(self, items):
        raise NotImplementedError("ModelProviderConfigRepository does not support bulk sync")
