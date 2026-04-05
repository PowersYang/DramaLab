"""
系列项目角色同步服务。

这里把“分集提取结果 -> 系列角色主档 + 分集角色引用”收口到一个服务里，
避免 ProjectService 直接拼仓储细节。
"""

from dataclasses import dataclass
import uuid

from ...repository import CharacterRepository, ProjectCharacterLinkRepository, ProjectRepository
from ...schemas.models import Character, ProjectCharacterLink
from ...utils.datetime import utc_now
from .series_entity_resolution_service import SeriesEntityResolutionService


@dataclass
class ProjectCharacterCastingResult:
    """一次分集角色同步的返回结果。"""

    project_id: str
    series_id: str
    links: list[ProjectCharacterLink]
    series_characters: list[Character]


class ProjectSeriesCastingService:
    """负责同步系列项目中的角色主档和分集引用。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.character_repository = CharacterRepository()
        self.project_character_link_repository = ProjectCharacterLinkRepository()
        self.series_entity_resolution_service = SeriesEntityResolutionService()

    def sync_project_characters(
        self,
        project_id: str,
        series_id: str,
        incoming_characters: list[Character],
    ) -> ProjectCharacterCastingResult:
        """把分集角色候选同步到系列主档和 link 表。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Project not found")
        if project.series_id != series_id:
            raise ValueError("Project series mismatch")

        resolved = self.series_entity_resolution_service.resolve_characters(series_id, incoming_characters)
        now = utc_now()
        links: list[ProjectCharacterLink] = []

        for item in resolved:
            series_character = item.series_character
            if item.is_new_character:
                self.character_repository.save("series", series_id, series_character)
            links.append(
                ProjectCharacterLink(
                    id=f"pcl_{uuid.uuid4().hex[:12]}",
                    project_id=project_id,
                    series_id=series_id,
                    character_id=series_character.id,
                    source_name=item.source_character.name,
                    source_alias=(item.source_character.name if item.source_character.name != series_character.name else None),
                    match_status=item.match_status,
                    match_confidence=item.match_confidence,
                    organization_id=project.organization_id,
                    workspace_id=project.workspace_id,
                    created_by=project.updated_by,
                    updated_by=project.updated_by,
                    created_at=now,
                    updated_at=now,
                )
            )

        stored_links = self.project_character_link_repository.sync_for_project(project_id, series_id, links)
        return ProjectCharacterCastingResult(
            project_id=project_id,
            series_id=series_id,
            links=stored_links,
            series_characters=self.character_repository.list_by_owner("series", series_id),
        )
