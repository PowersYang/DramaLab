"""
系列角色迁移辅助服务。

这里只负责扫描候选重复角色分组，默认不做任何破坏性写入。
"""

from collections import defaultdict

from ...repository import ProjectRepository, SeriesRepository


class SeriesCharacterMigrationService:
    """负责为历史系列项目生成角色归并候选组。"""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.project_repository = ProjectRepository()

    def build_candidate_groups(self, series_id: str) -> list[dict]:
        """扫描同一系列下多个项目中名称重复的 project 级角色。"""
        series = self.series_repository.get(series_id)
        if not series:
            raise ValueError("Series not found")

        grouped: dict[str, list[dict]] = defaultdict(list)
        for project in self.project_repository.list_by_series(series_id, workspace_id=series.workspace_id):
            for character in project.characters or []:
                normalized_name = self._normalize_name(character.name)
                if not normalized_name:
                    continue
                grouped[normalized_name].append(
                    {
                        "project_id": project.id,
                        "project_title": project.title,
                        "character_id": character.id,
                        "name": character.name,
                        "description": character.description,
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

    def build_series_audit(self, series_id: str) -> dict:
        """汇总单个系列的迁移准备度，默认只读不改库。"""
        series = self.series_repository.get(series_id)
        if not series:
            raise ValueError("Series not found")

        projects = self.project_repository.list_by_series(series_id, workspace_id=series.workspace_id)
        duplicate_candidates = self.build_candidate_groups(series_id)

        project_character_count = sum(len(project.characters or []) for project in projects)
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
            "projects": [
                {
                    "project_id": project.id,
                    "project_title": project.title,
                    "episode_number": project.episode_number,
                    "character_count": len(project.characters or []),
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
