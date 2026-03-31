from typing import Dict, Iterable, List

from sqlalchemy import func

from .base import BaseRepository
from .mappers import _audit_time_kwargs, _soft_delete_series_graph, _insert_series_children, _tenant_kwargs, hydrate_series_map, replace_series_graph
from ..db.models import CharacterRecord, ProjectRecord, SceneRecord, SeriesRecord
from ..schemas.models import Series
from ..utils.datetime import utc_now


class SeriesRepository(BaseRepository[Series]):
    def list_summaries(self, workspace_id: str | None = None) -> List[dict]:
        """返回项目中心系列卡片所需的轻量汇总数据。"""
        with self._with_session() as session:
            query = self._active_filter(session.query(SeriesRecord))
            if workspace_id is not None:
                query = query.filter(SeriesRecord.workspace_id == workspace_id)
            rows = query.order_by(SeriesRecord.updated_at.desc(), SeriesRecord.id.asc()).all()
            if not rows:
                return []

            series_ids = [row.id for row in rows]
            episode_counts = dict(
                session.query(ProjectRecord.series_id, func.count(ProjectRecord.id))
                .filter(
                    ProjectRecord.is_deleted.is_(False),
                    ProjectRecord.series_id.in_(series_ids),
                )
                .group_by(ProjectRecord.series_id)
                .all()
            )
            character_counts = dict(
                session.query(CharacterRecord.owner_id, func.count(CharacterRecord.id))
                .filter(
                    CharacterRecord.is_deleted.is_(False),
                    CharacterRecord.owner_type == "series",
                    CharacterRecord.owner_id.in_(series_ids),
                )
                .group_by(CharacterRecord.owner_id)
                .all()
            )
            scene_counts = dict(
                session.query(SceneRecord.owner_id, func.count(SceneRecord.id))
                .filter(
                    SceneRecord.is_deleted.is_(False),
                    SceneRecord.owner_type == "series",
                    SceneRecord.owner_id.in_(series_ids),
                )
                .group_by(SceneRecord.owner_id)
                .all()
            )
            return [
                {
                    "id": row.id,
                    "title": row.title,
                    "description": row.description,
                    "episode_count": int(episode_counts.get(row.id, 0)),
                    "character_count": int(character_counts.get(row.id, 0)),
                    "scene_count": int(scene_counts.get(row.id, 0)),
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
                for row in rows
            ]

    def list_briefs(self, workspace_id: str | None = None) -> List[dict]:
        """返回任务中心等场景需要的轻量系列列表。"""
        with self._with_session() as session:
            query = self._active_filter(session.query(SeriesRecord))
            if workspace_id is not None:
                query = query.filter(SeriesRecord.workspace_id == workspace_id)
            rows = query.order_by(SeriesRecord.updated_at.desc(), SeriesRecord.id.asc()).all()
            return [
                {
                    "id": row.id,
                    "title": row.title,
                    "updated_at": row.updated_at,
                    "created_at": row.created_at,
                }
                for row in rows
            ]

    def list(self, workspace_id: str | None = None) -> List[Series]:
        return list(self.list_map(workspace_id=workspace_id).values())

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
        """仅供离线导入/测试使用；运行时业务写路径禁止再调用整图替换。"""
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
            patch = dict(patch)
            patch.setdefault("updated_at", utc_now())
            self._patch_record(record, patch)
            return hydrate_series_map(session, {series_id})[series_id]

    def touch(self, series_id: str, expected_version: int, session=None) -> int:
        """推进系列根对象版本与更新时间，作为最小更新事务的乐观锁门闩。"""
        with self._with_session(session) as active_session:
            rows = active_session.query(SeriesRecord).filter(
                SeriesRecord.id == series_id,
                SeriesRecord.is_deleted.is_(False),
                SeriesRecord.version == expected_version,
            ).update(
                {
                    "version": SeriesRecord.version + 1,
                    "updated_at": func.now(),
                },
                synchronize_session=False,
            )
            if rows != 1:
                raise ValueError(f"Series {series_id} version conflict")
            next_version = active_session.query(SeriesRecord.version).filter(SeriesRecord.id == series_id).scalar()
            if next_version is None:
                raise ValueError(f"Series {series_id} not found")
            return int(next_version)

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

    def list_map(self, include_deleted: bool = False, workspace_id: str | None = None) -> Dict[str, Series]:
        with self._with_session() as session:
            hydrated = hydrate_series_map(session, include_deleted=include_deleted)
            if workspace_id is None:
                return hydrated
            return {series_id: series for series_id, series in hydrated.items() if series.workspace_id == workspace_id}

    def sync(self, items: Iterable[Series]) -> None:
        """仅供离线初始化/测试使用；运行时业务写路径禁止再调用整图替换。"""
        with self._with_session() as session:
            replace_series_graph(session, list(items))

    def save(self, series: Series) -> Series:
        """仅供离线初始化/测试使用；运行时业务写路径禁止再调用整图替换。"""
        return self.replace_graph(series)

    def delete(self, series_id: str) -> None:
        self.soft_delete(series_id)
