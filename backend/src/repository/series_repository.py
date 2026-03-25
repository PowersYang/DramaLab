from typing import Dict, Iterable

from .base import BaseRepository
from .mappers import _audit_time_kwargs, _delete_series_graph, _insert_series_children, _tenant_kwargs, hydrate_series_map, replace_series_graph
from ..db.models import SeriesRecord
from ..schemas.models import Series


class SeriesRepository(BaseRepository[Series]):
    def list(self) -> list[Series]:
        return list(self.list_map().values())

    def get(self, series_id: str) -> Series | None:
        with self._with_session() as session:
            return hydrate_series_map(session, {series_id}).get(series_id)

    def save(self, series: Series) -> Series:
        with self._with_session() as session:
            _delete_series_graph(session, {series.id})
            session.add(
                SeriesRecord(
                    id=series.id,
                    title=series.title,
                    description=series.description,
                    art_direction=series.art_direction.model_dump(mode="json") if series.art_direction else None,
                    model_settings=series.model_settings.model_dump(mode="json"),
                    prompt_config=series.prompt_config.model_dump(mode="json"),
                    **_tenant_kwargs(series),
                    **_audit_time_kwargs(series),
                )
            )
            _insert_series_children(session, series, _tenant_kwargs(series))
        return series

    def delete(self, series_id: str) -> None:
        with self._with_session() as session:
            _delete_series_graph(session, {series_id})

    def list_map(self) -> Dict[str, Series]:
        with self._with_session() as session:
            return hydrate_series_map(session)

    def sync(self, items: Iterable[Series]) -> None:
        with self._with_session() as session:
            replace_series_graph(session, list(items))
