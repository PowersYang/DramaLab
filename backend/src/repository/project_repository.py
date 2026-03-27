from typing import Dict, Iterable, List

from .base import BaseRepository
from .mappers import _audit_time_kwargs, _soft_delete_project_graph, _insert_project_children, _tenant_kwargs, hydrate_project_map, replace_project_graph
from ..db.models import ProjectRecord
from ..schemas.models import Script


class ProjectRepository(BaseRepository[Script]):
    def list(self) -> List[Script]:
        return list(self.list_map().values())

    def list_all(self, include_deleted: bool = False) -> List[Script]:
        return list(self.list_map(include_deleted=include_deleted).values())

    def get(self, project_id: str, include_deleted: bool = False) -> Script | None:
        with self._with_session() as session:
            return hydrate_project_map(session, {project_id}, include_deleted=include_deleted).get(project_id)

    def create(self, project: Script) -> Script:
        with self._with_session() as session:
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
                    model_settings=project.model_settings.model_dump(mode="json"),
                    prompt_config=project.prompt_config.model_dump(mode="json"),
                    version=project.version,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **_tenant_kwargs(project),
                    **_audit_time_kwargs(project),
                )
            )
            _insert_project_children(session, project, _tenant_kwargs(project))
        return project

    def replace_graph(self, project: Script) -> Script:
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
                    model_settings=project.model_settings.model_dump(mode="json"),
                    prompt_config=project.prompt_config.model_dump(mode="json"),
                    version=project.version,
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
            self._patch_record(record, patch)
            return hydrate_project_map(session, {project_id})[project_id]

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

    def list_map(self, include_deleted: bool = False) -> Dict[str, Script]:
        with self._with_session() as session:
            return hydrate_project_map(session, include_deleted=include_deleted)

    def sync(self, items: Iterable[Script]) -> None:
        with self._with_session() as session:
            replace_project_graph(session, list(items))

    def save(self, project: Script) -> Script:
        return self.replace_graph(project)

    def delete(self, project_id: str) -> None:
        self.soft_delete(project_id)
