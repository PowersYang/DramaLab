from typing import List

from .base import BaseRepository
from ..db.models import ProjectCharacterLinkRecord
from ..schemas.models import ProjectCharacterLink


class ProjectCharacterLinkRepository(BaseRepository[ProjectCharacterLink]):
    """负责系列项目角色引用关系的读写。"""

    def list_by_project(self, project_id: str, include_deleted: bool = False) -> List[ProjectCharacterLink]:
        """按项目读取角色引用关系。"""
        with self._with_session() as session:
            query = session.query(ProjectCharacterLinkRecord).filter(ProjectCharacterLinkRecord.project_id == project_id)
            if not include_deleted:
                query = query.filter(ProjectCharacterLinkRecord.is_deleted.is_(False))
            rows = query.order_by(ProjectCharacterLinkRecord.created_at.asc(), ProjectCharacterLinkRecord.id.asc()).all()
            return [self._to_model(row) for row in rows]

    def sync_for_project(
        self,
        project_id: str,
        series_id: str,
        links: list[ProjectCharacterLink],
        session=None,
    ) -> list[ProjectCharacterLink]:
        """以项目为粒度同步角色引用关系。"""
        desired_ids = {item.id for item in links}
        with self._with_session(session) as active_session:
            existing_rows = (
                active_session.query(ProjectCharacterLinkRecord)
                .filter(
                    ProjectCharacterLinkRecord.project_id == project_id,
                    ProjectCharacterLinkRecord.is_deleted.is_(False),
                )
                .all()
            )
            existing_by_id = {row.id: row for row in existing_rows}

            for link in links:
                active_session.merge(
                    ProjectCharacterLinkRecord(
                        id=link.id,
                        project_id=project_id,
                        series_id=series_id,
                        character_id=link.character_id,
                        source_name=link.source_name,
                        source_alias=link.source_alias,
                        episode_notes=link.episode_notes,
                        override_json=link.override_json,
                        match_confidence=link.match_confidence,
                        match_status=link.match_status,
                        organization_id=link.organization_id,
                        workspace_id=link.workspace_id,
                        created_by=link.created_by,
                        updated_by=link.updated_by,
                        created_at=link.created_at,
                        updated_at=link.updated_at,
                        is_deleted=False,
                        deleted_at=None,
                        deleted_by=None,
                    )
                )

            for row_id, row in existing_by_id.items():
                if row_id in desired_ids:
                    continue
                self._soft_delete_record(row)

        return self.list_by_project(project_id)

    def _to_model(self, record: ProjectCharacterLinkRecord) -> ProjectCharacterLink:
        """把数据库记录映射成领域模型。"""
        return ProjectCharacterLink(
            id=record.id,
            project_id=record.project_id,
            series_id=record.series_id,
            character_id=record.character_id,
            source_name=record.source_name,
            source_alias=record.source_alias,
            episode_notes=record.episode_notes,
            override_json=record.override_json or {},
            match_confidence=record.match_confidence,
            match_status=record.match_status,
            character=None,
            organization_id=record.organization_id,
            workspace_id=record.workspace_id,
            created_by=record.created_by,
            updated_by=record.updated_by,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
