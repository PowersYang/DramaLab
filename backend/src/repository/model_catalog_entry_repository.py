"""平台级模型目录仓储。"""

from ..db.models import ModelCatalogEntryRecord
from ..schemas.models import ModelCatalogEntry
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: ModelCatalogEntryRecord) -> ModelCatalogEntry:
    return ModelCatalogEntry(
        model_id=record.model_id,
        task_type=record.task_type,
        provider_key=record.provider_key,
        display_name=record.display_name,
        description=record.description,
        enabled=record.enabled,
        sort_order=record.sort_order,
        is_public=record.is_public,
        capabilities_json=record.capabilities_json or {},
        default_settings_json=record.default_settings_json or {},
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class ModelCatalogEntryRepository(BaseRepository[ModelCatalogEntry]):
    """模型目录项的增删改查。"""

    def list(self, task_type: str | None = None) -> list[ModelCatalogEntry]:
        with self._with_session() as session:
            query = session.query(ModelCatalogEntryRecord)
            if task_type:
                query = query.filter(ModelCatalogEntryRecord.task_type == task_type)
            records = query.order_by(ModelCatalogEntryRecord.task_type.asc(), ModelCatalogEntryRecord.sort_order.asc(), ModelCatalogEntryRecord.created_at.asc()).all()
            return [_to_domain(record) for record in records]

    def get(self, model_id: str) -> ModelCatalogEntry | None:
        with self._with_session() as session:
            record = session.get(ModelCatalogEntryRecord, model_id)
            return _to_domain(record) if record else None

    def create(self, item: ModelCatalogEntry) -> ModelCatalogEntry:
        with self._with_session() as session:
            existing = session.get(ModelCatalogEntryRecord, item.model_id)
            if existing is not None:
                raise ValueError(f"Model already exists: {item.model_id}")
            record = ModelCatalogEntryRecord(
                model_id=item.model_id,
                task_type=item.task_type,
                provider_key=item.provider_key,
                display_name=item.display_name,
                description=item.description,
                enabled=item.enabled,
                sort_order=item.sort_order,
                is_public=item.is_public,
                capabilities_json=item.capabilities_json,
                default_settings_json=item.default_settings_json,
                created_by=item.created_by,
                updated_by=item.updated_by,
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
            session.add(record)
            return _to_domain(record)

    def update(self, model_id: str, patch: dict) -> ModelCatalogEntry:
        with self._with_session() as session:
            record = session.get(ModelCatalogEntryRecord, model_id)
            if record is None:
                raise ValueError("Model catalog entry not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_domain(record)

    def upsert(self, item: ModelCatalogEntry) -> ModelCatalogEntry:
        with self._with_session() as session:
            record = session.get(ModelCatalogEntryRecord, item.model_id)
            if record is None:
                record = ModelCatalogEntryRecord(
                    model_id=item.model_id,
                    task_type=item.task_type,
                    provider_key=item.provider_key,
                    display_name=item.display_name,
                    description=item.description,
                    enabled=item.enabled,
                    sort_order=item.sort_order,
                    is_public=item.is_public,
                    capabilities_json=item.capabilities_json,
                    default_settings_json=item.default_settings_json,
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
                session.add(record)
            else:
                record.task_type = item.task_type
                record.provider_key = item.provider_key
                record.display_name = item.display_name
                record.description = item.description
                record.enabled = item.enabled
                record.sort_order = item.sort_order
                record.is_public = item.is_public
                record.capabilities_json = item.capabilities_json
                record.default_settings_json = item.default_settings_json
                record.updated_by = item.updated_by
                record.updated_at = utc_now()
            return _to_domain(record)

    def list_map(self):
        return {item.model_id: item for item in self.list()}

    def sync(self, items):
        raise NotImplementedError("ModelCatalogEntryRepository does not support bulk sync")
