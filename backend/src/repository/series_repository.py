from typing import Dict, Iterable, List

from .base import BaseRepository
from .mappers import _audit_time_kwargs, _soft_delete_series_graph, _insert_series_children, _tenant_kwargs, hydrate_series_map, replace_series_graph
from ..db.models import SeriesRecord
from ..schemas.models import Series


class SeriesRepository(BaseRepository[Series]):
    def list(self) -> List[Series]:
        return list(self.list_map().values())

    def get(self, series_id: str, include_deleted: bool = False) -> Series | None:
        with self._with_session() as session:
            return hydrate_series_map(session, {series_id}, include_deleted=include_deleted).get(series_id)

    def create(self, series: Series) -> Series:
        with self._with_session() as session:
            session.merge(
                SeriesRecord(
                    id=series.id,
                    title=series.title,
                    description=series.description,
                    art_direction=series.art_direction.model_dump(mode="json") if series.art_direction else None,
                    model_settings=series.model_settings.model_dump(mode="json"),
                    prompt_config=series.prompt_config.model_dump(mode="json"),
                    version=series.version,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **_tenant_kwargs(series),
                    **_audit_time_kwargs(series),
                )
            )
            _insert_series_children(session, series, _tenant_kwargs(series))
        return series

    def replace_graph(self, series: Series) -> Series:
        with self._with_session() as session:
            _soft_delete_series_graph(session, {series.id}, getattr(series, "updated_by", None))
            session.merge(
                SeriesRecord(
                    id=series.id,
                    title=series.title,
                    description=series.description,
                    art_direction=series.art_direction.model_dump(mode="json") if series.art_direction else None,
                    model_settings=series.model_settings.model_dump(mode="json"),
                    prompt_config=series.prompt_config.model_dump(mode="json"),
                    version=series.version,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **_tenant_kwargs(series),
                    **_audit_time_kwargs(series),
                )
            )
            _insert_series_children(session, series, _tenant_kwargs(series))
        return series

    def patch_metadata(self, series_id: str, patch: dict, expected_version: int | None = None) -> Series:
        with self._with_session() as session:
            record = self._get_active(session, SeriesRecord, series_id)
            if record is None:
                raise ValueError(f"Series {series_id} not found")
            if expected_version is not None and record.version != expected_version:
                raise ValueError(f"Series {series_id} version conflict")
            self._patch_record(record, patch)
            return hydrate_series_map(session, {series_id})[series_id]

    def soft_delete(self, series_id: str, deleted_by: str | None = None) -> None:
        with self._with_session() as session:
            _soft_delete_series_graph(session, {series_id}, deleted_by)

    def restore(self, series_id: str) -> Series:
        with self._with_session() as session:
            record = session.get(SeriesRecord, series_id)
            if record is None:
                raise ValueError(f"Series {series_id} not found")
            self._restore_record(record)
            return hydrate_series_map(session, {series_id}, include_deleted=True)[series_id]

    def list_map(self, include_deleted: bool = False) -> Dict[str, Series]:
        with self._with_session() as session:
            return hydrate_series_map(session, include_deleted=include_deleted)

    def sync(self, items: Iterable[Series]) -> None:
        with self._with_session() as session:
            replace_series_graph(session, list(items))

    def save(self, series: Series) -> Series:
        return self.replace_graph(series)

    def delete(self, series_id: str) -> None:
        self.soft_delete(series_id)
