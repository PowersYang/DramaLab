"""
系列角色迁移辅助服务。

这里只负责扫描候选重复角色分组，默认不做任何破坏性写入。
"""

from collections import defaultdict

from ...db.models import CharacterRecord
from ...db.session import session_scope
from ...repository import ProjectRepository, SeriesRepository


class SeriesCharacterMigrationService:
    """负责为历史系列项目生成角色归并候选组。"""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.project_repository = ProjectRepository()

    def build_candidate_groups(self, series_id: str) -> list[dict]:
        """扫描同一系列下多个项目中名称重复的 project 级角色。"""
        _, projects, project_characters_by_project = self._load_series_projects_with_project_characters(series_id)
        return self._build_candidate_groups_from_project_characters(series_id, projects, project_characters_by_project)

    def build_series_audit(self, series_id: str) -> dict:
        """汇总单个系列的迁移准备度，默认只读不改库。"""
        series, projects, project_characters_by_project = self._load_series_projects_with_project_characters(series_id)
        duplicate_candidates = self._build_candidate_groups_from_project_characters(
            series_id,
            projects,
            project_characters_by_project,
        )
        shadow_candidates = self._build_project_series_shadow_candidates(
            projects,
            project_characters_by_project,
            series.characters or [],
        )

        project_character_count = sum(len(project_characters_by_project.get(project.id, [])) for project in projects)
        series_character_count = len(series.characters or [])
        project_character_link_count = sum(len(project.series_character_links or []) for project in projects)
        frame_character_reference_count = sum(
            1
            for project in projects
            for frame in (project.frames or [])
            if frame.character_ids
        )

        return {
            "series_id": series.id,
            "series_title": series.title,
            "workspace_id": series.workspace_id,
            "project_count": len(projects),
            "series_character_count": series_character_count,
            "project_character_count": project_character_count,
            "project_character_link_count": project_character_link_count,
            "frame_character_reference_count": frame_character_reference_count,
            "duplicate_candidate_group_count": len(duplicate_candidates),
            "duplicate_candidates": duplicate_candidates,
            "project_series_shadow_candidate_count": len(shadow_candidates),
            "project_series_shadow_candidates": shadow_candidates,
            "projects": [
                {
                    "project_id": project.id,
                    "project_title": project.title,
                    "episode_number": project.episode_number,
                    "character_count": len(project_characters_by_project.get(project.id, [])),
                    "series_character_link_count": len(project.series_character_links or []),
                    "frame_count": len(project.frames or []),
                    "frame_character_reference_count": sum(
                        1 for frame in (project.frames or []) if frame.character_ids
                    ),
                }
                for project in projects
            ],
        }

    def list_series_audits(self, workspace_id: str | None = None) -> list[dict]:
        """批量输出系列迁移审计摘要，用于筛选优先处理的系列。"""
        audits = [
            self.build_series_audit(series.id)
            for series in self.series_repository.list(workspace_id=workspace_id)
        ]
        return sorted(
            audits,
            key=lambda item: (
                -int(item["project_count"]),
                -int(item["project_character_count"]),
                str(item["series_title"] or ""),
            ),
        )

    def _normalize_name(self, value: str | None) -> str:
        """统一角色名归并时的最小归一化策略。"""
        return str(value or "").strip().lower()

    def _load_series_projects_with_project_characters(self, series_id: str) -> tuple[object, list, dict[str, list[dict]]]:
        """加载系列、分集列表和“仅 project owner 角色”快照。"""
        series = self.series_repository.get(series_id)
        if not series:
            raise ValueError("Series not found")

        projects = self.project_repository.list_by_series(series_id, workspace_id=series.workspace_id)
        project_characters_by_project = self._list_project_characters_by_project(
            [project.id for project in projects]
        )
        return series, projects, project_characters_by_project

    def _list_project_characters_by_project(self, project_ids: list[str]) -> dict[str, list[dict]]:
        """按 project_id 读取本地角色，不包含系列主档回填角色。"""
        grouped: dict[str, list[dict]] = defaultdict(list)
        if not project_ids:
            return grouped

        with session_scope() as session:
            # 中文注释：迁移审计只关心 owner_type=project 的历史角色，
            # 不能复用 project 聚合视图里的“系列角色回填”，否则会把共享角色误判成重复候选。
            rows = (
                session.query(
                    CharacterRecord.owner_id,
                    CharacterRecord.id,
                    CharacterRecord.name,
                    CharacterRecord.description,
                )
                .filter(
                    CharacterRecord.owner_type == "project",
                    CharacterRecord.owner_id.in_(project_ids),
                    CharacterRecord.is_deleted.is_(False),
                )
                .order_by(CharacterRecord.owner_id.asc(), CharacterRecord.created_at.asc(), CharacterRecord.id.asc())
                .all()
            )

        for owner_id, character_id, name, description in rows:
            grouped[str(owner_id)].append(
                {
                    "character_id": str(character_id),
                    "name": str(name or ""),
                    "description": str(description or ""),
                }
            )
        return grouped

    def _build_candidate_groups_from_project_characters(
        self,
        series_id: str,
        projects: list,
        project_characters_by_project: dict[str, list[dict]],
    ) -> list[dict]:
        """基于本地 project 角色快照构建候选重复组。"""
        grouped: dict[str, list[dict]] = defaultdict(list)
        for project in projects:
            for character in project_characters_by_project.get(project.id, []):
                normalized_name = self._normalize_name(character.get("name"))
                if not normalized_name:
                    continue
                grouped[normalized_name].append(
                    {
                        "project_id": project.id,
                        "project_title": project.title,
                        "character_id": character.get("character_id"),
                        "name": character.get("name"),
                        "description": character.get("description"),
                    }
                )

        return [
            {
                "series_id": series_id,
                "normalized_name": normalized_name,
                "items": items,
            }
            for normalized_name, items in sorted(grouped.items())
            if len(items) > 1
        ]

    def _build_project_series_shadow_candidates(
        self,
        projects: list,
        project_characters_by_project: dict[str, list[dict]],
        series_characters: list,
    ) -> list[dict]:
        """识别“分集本地角色名与系列主档角色名冲突”的影子副本候选。"""
        series_character_by_name: dict[str, object] = {}
        for character in series_characters:
            normalized_name = self._normalize_name(getattr(character, "canonical_name", None) or getattr(character, "name", None))
            if normalized_name and normalized_name not in series_character_by_name:
                series_character_by_name[normalized_name] = character

        candidates: list[dict] = []
        for project in projects:
            for character in project_characters_by_project.get(project.id, []):
                normalized_name = self._normalize_name(character.get("name"))
                if not normalized_name:
                    continue
                matched_series_character = series_character_by_name.get(normalized_name)
                if not matched_series_character:
                    continue
                candidates.append(
                    {
                        "project_id": project.id,
                        "project_title": project.title,
                        "episode_number": project.episode_number,
                        "project_character_id": character.get("character_id"),
                        "name": character.get("name"),
                        "series_character_id": getattr(matched_series_character, "id", None),
                        "series_character_name": getattr(matched_series_character, "name", None),
                    }
                )
        return candidates
