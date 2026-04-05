from typing import Dict, Iterable, List

from sqlalchemy import func

from .base import BaseRepository
from .mappers import _audit_time_kwargs, _soft_delete_project_graph, _insert_project_children, _tenant_kwargs, hydrate_project_map, replace_project_graph
from ..db.models import CharacterRecord, ProjectRecord, PropRecord, SceneRecord, StoryboardFrameRecord
from ..schemas.models import Script
from ..utils.datetime import utc_now


class ProjectRepository(BaseRepository[Script]):
    def list_summaries(self, workspace_id: str | None = None) -> List[dict]:
        """返回项目中心卡片所需的轻量汇总数据。"""
        with self._with_session() as session:
            records = (
                self._active_filter(session.query(ProjectRecord))
                .filter(ProjectRecord.workspace_id == workspace_id) if workspace_id else self._active_filter(session.query(ProjectRecord))
            )
            records = (
                records
                .order_by(ProjectRecord.updated_at.desc(), ProjectRecord.id.asc())
                .all()
            )
            if not records:
                return []

            project_ids = [row.id for row in records]
            character_counts = dict(
                session.query(CharacterRecord.owner_id, func.count(CharacterRecord.id))
                .filter(
                    CharacterRecord.is_deleted.is_(False),
                    CharacterRecord.owner_type == "project",
                    CharacterRecord.owner_id.in_(project_ids),
                )
                .group_by(CharacterRecord.owner_id)
                .all()
            )
            scene_counts = dict(
                session.query(SceneRecord.owner_id, func.count(SceneRecord.id))
                .filter(
                    SceneRecord.is_deleted.is_(False),
                    SceneRecord.owner_type == "project",
                    SceneRecord.owner_id.in_(project_ids),
                )
                .group_by(SceneRecord.owner_id)
                .all()
            )
            prop_counts = dict(
                session.query(PropRecord.owner_id, func.count(PropRecord.id))
                .filter(
                    PropRecord.is_deleted.is_(False),
                    PropRecord.owner_type == "project",
                    PropRecord.owner_id.in_(project_ids),
                )
                .group_by(PropRecord.owner_id)
                .all()
            )
            frame_counts = dict(
                session.query(StoryboardFrameRecord.project_id, func.count(StoryboardFrameRecord.id))
                .filter(
                    StoryboardFrameRecord.is_deleted.is_(False),
                    StoryboardFrameRecord.project_id.in_(project_ids),
                )
                .group_by(StoryboardFrameRecord.project_id)
                .all()
            )

            return [
                {
                    "id": row.id,
                    "title": row.title,
                    "series_id": row.series_id,
                    "episode_number": row.episode_number,
                    "status": row.status,
                    "character_count": int(character_counts.get(row.id, 0)),
                    "scene_count": int(scene_counts.get(row.id, 0)),
                    "prop_count": int(prop_counts.get(row.id, 0)),
                    "frame_count": int(frame_counts.get(row.id, 0)),
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
                for row in records
            ]

    def list_briefs(self, workspace_id: str | None = None) -> List[dict]:
        """返回任务中心等场景需要的轻量项目列表。"""
        with self._with_session() as session:
            query = self._active_filter(session.query(ProjectRecord))
            if workspace_id is not None:
                query = query.filter(ProjectRecord.workspace_id == workspace_id)
            rows = query.order_by(ProjectRecord.updated_at.desc(), ProjectRecord.id.asc()).all()
            return [
                {
                    "id": row.id,
                    "title": row.title,
                    "series_id": row.series_id,
                    "episode_number": row.episode_number,
                    "updated_at": row.updated_at,
                    "created_at": row.created_at,
                }
                for row in rows
            ]

    def list_episode_briefs(self, series_id: str, workspace_id: str | None = None) -> List[dict]:
        """返回某个系列下的分集轻量卡片数据。"""
        with self._with_session() as session:
            rows = (
                self._active_filter(session.query(ProjectRecord))
                .filter(ProjectRecord.series_id == series_id)
                .filter(ProjectRecord.workspace_id == workspace_id) if workspace_id else self._active_filter(session.query(ProjectRecord)).filter(ProjectRecord.series_id == series_id)
            )
            rows = (
                rows
                .order_by(ProjectRecord.episode_number.asc().nullslast(), ProjectRecord.created_at.asc(), ProjectRecord.id.asc())
                .all()
            )
            if not rows:
                return []

            project_ids = [row.id for row in rows]
            frame_counts = dict(
                session.query(StoryboardFrameRecord.project_id, func.count(StoryboardFrameRecord.id))
                .filter(
                    StoryboardFrameRecord.is_deleted.is_(False),
                    StoryboardFrameRecord.project_id.in_(project_ids),
                )
                .group_by(StoryboardFrameRecord.project_id)
                .all()
            )
            return [
                {
                    "id": row.id,
                    "title": row.title,
                    "series_id": row.series_id,
                    "episode_number": row.episode_number,
                    "frame_count": int(frame_counts.get(row.id, 0)),
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
                for row in rows
            ]

    def list(self, workspace_id: str | None = None) -> List[Script]:
        return list(self.list_map(workspace_id=workspace_id).values())

    def list_by_series(self, series_id: str, workspace_id: str | None = None) -> List[Script]:
        """返回某个系列下的完整项目对象列表，避免全表扫描。"""
        from .mappers import hydrate_project_map  # 延迟导入以避免循环
        with self._with_session() as session:
            query = self._active_filter(session.query(ProjectRecord)).filter(ProjectRecord.series_id == series_id)
            if workspace_id is not None:
                query = query.filter(ProjectRecord.workspace_id == workspace_id)
            rows = (
                query
                .order_by(ProjectRecord.episode_number.asc().nullslast(), ProjectRecord.created_at.asc(), ProjectRecord.id.asc())
                .all()
            )
            if not rows:
                return []
            project_ids = {row.id for row in rows}
            hydrated = hydrate_project_map(session, project_ids)
            # 保持顺序与上面的排序一致
            return [hydrated[row.id] for row in rows if row.id in hydrated]

    def list_all(self, include_deleted: bool = False) -> List[Script]:
        return list(self.list_map(include_deleted=include_deleted).values())

    def get(self, project_id: str, include_deleted: bool = False) -> Script | None:
        with self._with_session() as session:
            return hydrate_project_map(session, {project_id}, include_deleted=include_deleted).get(project_id)

    def create(self, project: Script, session=None) -> Script:
        with self._with_session(session) as active_session:
            active_session.merge(
                ProjectRecord(
                    id=project.id,
                    title=project.title,
                    original_text=project.original_text,
                    style_preset=project.style_preset,
                    style_prompt=project.style_prompt,
                    merged_video_url=project.merged_video_url,
                    series_id=project.series_id,
                    episode_number=project.episode_number,
                    art_direction=project.art_direction.model_dump(mode="json") if project.art_direction else None,
                    art_direction_source=project.art_direction_source,
                    art_direction_override=project.art_direction_override or None,
                    art_direction_resolved=project.art_direction_resolved.model_dump(mode="json") if project.art_direction_resolved else None,
                    art_direction_overridden_at=project.art_direction_overridden_at,
                    art_direction_overridden_by=project.art_direction_overridden_by,
                    model_settings=project.model_settings.model_dump(mode="json"),
                    prompt_config=project.prompt_config.model_dump(mode="json"),
                    timeline_json=project.timeline.model_dump(mode="json") if project.timeline else None,
                    version=project.version,
                    status=project.status,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **_tenant_kwargs(project),
                    **_audit_time_kwargs(project),
                )
            )
            _insert_project_children(active_session, project, _tenant_kwargs(project))
        return project

    def replace_graph(self, project: Script) -> Script:
        """仅供离线导入/测试使用；运行时业务写路径禁止再调用整图替换。"""
        with self._with_session() as session:
            _soft_delete_project_graph(session, {project.id}, getattr(project, "updated_by", None))
            session.merge(
                ProjectRecord(
                    id=project.id,
                    title=project.title,
                    original_text=project.original_text,
                    style_preset=project.style_preset,
                    style_prompt=project.style_prompt,
                    merged_video_url=project.merged_video_url,
                    series_id=project.series_id,
                    episode_number=project.episode_number,
                    art_direction=project.art_direction.model_dump(mode="json") if project.art_direction else None,
                    art_direction_source=project.art_direction_source,
                    art_direction_override=project.art_direction_override or None,
                    art_direction_resolved=project.art_direction_resolved.model_dump(mode="json") if project.art_direction_resolved else None,
                    art_direction_overridden_at=project.art_direction_overridden_at,
                    art_direction_overridden_by=project.art_direction_overridden_by,
                    model_settings=project.model_settings.model_dump(mode="json"),
                    prompt_config=project.prompt_config.model_dump(mode="json"),
                    timeline_json=project.timeline.model_dump(mode="json") if project.timeline else None,
                    version=project.version,
                    status=project.status,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **_tenant_kwargs(project),
                    **_audit_time_kwargs(project),
                )
            )
            _insert_project_children(session, project, _tenant_kwargs(project))
        return project

    def patch_metadata(self, project_id: str, patch: dict, expected_version: int | None = None) -> Script:
        with self._with_session() as session:
            record = self._get_active(session, ProjectRecord, project_id)
            if record is None:
                raise ValueError(f"Project {project_id} not found")
            if expected_version is not None and record.version != expected_version:
                raise ValueError(f"Project {project_id} version conflict")
            patch = dict(patch)
            patch.setdefault("updated_at", utc_now())
            self._patch_record(record, patch)
            return hydrate_project_map(session, {project_id})[project_id]

    def save_timeline(self, project_id: str, timeline_json: dict, expected_version: int | None = None) -> Script:
        """保存项目时间轴，并使旧的成片缓存失效。"""
        with self._with_session() as session:
            record = self._get_active(session, ProjectRecord, project_id)
            if record is None:
                raise ValueError(f"Project {project_id} not found")
            if expected_version is not None and record.version != expected_version:
                raise ValueError(f"Project {project_id} version conflict")

            record.timeline_json = timeline_json
            record.merged_video_url = None
            record.updated_at = utc_now()
            record.version += 1
            return hydrate_project_map(session, {project_id})[project_id]

    def cache_timeline_snapshot(self, project_id: str, timeline_json: dict) -> Script:
        """写回时间轴派生缓存，不推进版本，也不使导出缓存失效。"""
        with self._with_session() as session:
            record = self._get_active(session, ProjectRecord, project_id)
            if record is None:
                raise ValueError(f"Project {project_id} not found")

            record.timeline_json = timeline_json
            return hydrate_project_map(session, {project_id})[project_id]

    def touch(self, project_id: str, expected_version: int, session=None) -> int:
        """推进项目根对象版本与更新时间，作为最小更新事务的乐观锁门闩。"""
        with self._with_session(session) as active_session:
            rows = active_session.query(ProjectRecord).filter(
                ProjectRecord.id == project_id,
                ProjectRecord.is_deleted.is_(False),
                ProjectRecord.version == expected_version,
            ).update(
                {
                    "version": ProjectRecord.version + 1,
                    "updated_at": func.now(),
                },
                synchronize_session=False,
            )
            if rows != 1:
                raise ValueError(f"Project {project_id} version conflict")
            next_version = active_session.query(ProjectRecord.version).filter(ProjectRecord.id == project_id).scalar()
            if next_version is None:
                raise ValueError(f"Project {project_id} not found")
            return int(next_version)

    def soft_delete(self, project_id: str, deleted_by: str | None = None) -> None:
        with self._with_session() as session:
            _soft_delete_project_graph(session, {project_id}, deleted_by)

    def restore(self, project_id: str) -> Script:
        with self._with_session() as session:
            record = session.get(ProjectRecord, project_id)
            if record is None:
                raise ValueError(f"Project {project_id} not found")
            self._restore_record(record)
            return hydrate_project_map(session, {project_id}, include_deleted=True)[project_id]

    def list_map(self, include_deleted: bool = False, workspace_id: str | None = None) -> Dict[str, Script]:
        with self._with_session() as session:
            hydrated = hydrate_project_map(session, include_deleted=include_deleted)
            if workspace_id is None:
                return hydrated
            return {project_id: project for project_id, project in hydrated.items() if project.workspace_id == workspace_id}

    def sync(self, items: Iterable[Script]) -> None:
        """仅供离线初始化/测试使用；运行时业务写路径禁止再调用整图替换。"""
        with self._with_session() as session:
            replace_project_graph(session, list(items))

    def save(self, project: Script) -> Script:
        """仅供离线初始化/测试使用；运行时业务写路径禁止再调用整图替换。"""
        return self.replace_graph(project)

    def delete(self, project_id: str) -> None:
        self.soft_delete(project_id)
