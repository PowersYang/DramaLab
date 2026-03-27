from datetime import datetime
from typing import Dict, Generic, Iterable, TypeVar

from pydantic import BaseModel
from sqlalchemy.orm import Query
from sqlalchemy.orm import Session

from ..db.session import session_scope
from ..utils.datetime import utc_now


ModelT = TypeVar("ModelT", bound=BaseModel)


class BaseRepository(Generic[ModelT]):
    def _with_session(self, session: Session | None = None):
        if session is not None:
            return _SessionAdapter(session)
        return session_scope()

    def list_map(self) -> Dict[str, ModelT]:
        raise NotImplementedError

    def sync(self, items: Iterable[ModelT]) -> None:
        raise NotImplementedError

    def _active_filter(self, query: Query):
        # 默认过滤软删除记录，避免上层每个查询点都重复拼接 is_deleted 条件。
        model = query.column_descriptions[0].get("entity")
        if model is not None and hasattr(model, "is_deleted"):
            return query.filter(model.is_deleted.is_(False))
        return query

    def _get_active(self, session: Session, model, record_id: str):
        query = session.query(model).filter(model.id == record_id)
        if hasattr(model, "is_deleted"):
            query = query.filter(model.is_deleted.is_(False))
        return query.one_or_none()

    def _patch_record(self, record, patch: dict):
        if getattr(record, "is_deleted", False):
            raise ValueError(f"{record.__class__.__name__} is deleted")
        # 对象级 patch 统一在仓储基座里补 updated_at/version，避免各仓储各写一套。
        now = utc_now()
        for key, value in patch.items():
            if value is not None and hasattr(record, key):
                setattr(record, key, value)
        if hasattr(record, "updated_at") and "updated_at" not in patch:
            record.updated_at = now
        if hasattr(record, "version"):
            record.version += 1
        return record

    def _soft_delete_record(self, record, deleted_by: str | None = None):
        if record is None:
            return None
        # 删除一律走软删除，保留审计信息并推动 updated_at/version 前进。
        record.is_deleted = True
        record.deleted_at = utc_now()
        if hasattr(record, "updated_at"):
            record.updated_at = record.deleted_at
        if hasattr(record, "deleted_by"):
            record.deleted_by = deleted_by
        if hasattr(record, "version"):
            record.version += 1
        return record

    def _restore_record(self, record):
        if record is None:
            return None
        # 恢复时要把软删除元数据清空，否则上层 list/get 仍会把它视为无效对象。
        record.is_deleted = False
        record.deleted_at = None
        if hasattr(record, "deleted_by"):
            record.deleted_by = None
        if hasattr(record, "updated_at"):
            record.updated_at = utc_now()
        if hasattr(record, "version"):
            record.version += 1
        return record


class _SessionAdapter:
    def __init__(self, session: Session):
        self._session = session

    def __enter__(self) -> Session:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False
