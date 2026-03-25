from typing import Dict, Iterable

from .base import BaseRepository
from .mappers import _delete_project_graph, _insert_project_children, _tenant_kwargs, _audit_time_kwargs, hydrate_project_map, replace_project_graph
from ..db.models import ProjectRecord
from ..schemas.models import Script


class ProjectRepository(BaseRepository[Script]):
    def list(self) -> list[Script]:
        return list(self.list_map().values())

    def get(self, project_id: str) -> Script | None:
        with self._with_session() as session:
            return hydrate_project_map(session, {project_id}).get(project_id)

    def save(self, project: Script) -> Script:
        with self._with_session() as session:
            _delete_project_graph(session, {project.id})
            session.add(
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
                    **_tenant_kwargs(project),
                    **_audit_time_kwargs(project),
                )
            )
            _insert_project_children(session, project, _tenant_kwargs(project))
        return project

    def delete(self, project_id: str) -> None:
        with self._with_session() as session:
            _delete_project_graph(session, {project_id})

    def list_map(self) -> Dict[str, Script]:
        with self._with_session() as session:
            return hydrate_project_map(session)

    def sync(self, items: Iterable[Script]) -> None:
        with self._with_session() as session:
            replace_project_graph(session, list(items))
