"""统一解析剧集主档与项目覆写的美术设定。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from ...common.log import get_logger
from ...repository import ProjectRepository, SeriesRepository
from ...schemas.models import ArtDirection, Script, Series
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class ArtDirectionResolutionService:
    """负责项目美术来源判断、覆写合并与统一返回结构。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()

    def get_resolved_project_payload(self, project_id: str) -> dict[str, Any]:
        """返回项目当前有效的美术来源与解析结果。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Project not found")
        return self.build_project_payload(project)

    def build_project_payload(self, project: Script) -> dict[str, Any]:
        """把项目与系列主档解析为前后端共享的统一结构。"""
        series = self.series_repository.get(project.series_id) if project.series_id else None
        resolved = self.resolve_project_art_direction(project, series)
        source = self._normalized_source(project, series)
        series_payload = series.art_direction.model_dump(mode="json") if series and series.art_direction else None
        override_payload = deepcopy(project.art_direction_override or {})
        return {
            "project_id": project.id,
            "source": source,
            "inherits_series": bool(series and source == "series_default"),
            "is_overridden": bool(series and source == "project_override"),
            "is_dirty_from_series": bool(series and source == "project_override"),
            "series_art_direction": series_payload,
            "project_override": override_payload,
            "resolved_art_direction": resolved.model_dump(mode="json") if resolved else None,
        }

    def apply_resolved_art_direction(self, project: Script) -> Script:
        """把解析后的结果投影回项目对象，降低前端双心智负担。"""
        payload = self.build_project_payload(project)
        resolved = payload["resolved_art_direction"]
        project.art_direction_source = payload["source"]
        project.art_direction_override = payload["project_override"] or {}
        project.art_direction_resolved = ArtDirection(**resolved) if resolved else None
        if project.series_id:
            # 中文注释：系列项目的对外读取统一映射成“当前生效的 art_direction”，
            # 避免前端一边读 art_direction 一边再自己拼 override，继续制造双真源。
            project.art_direction = project.art_direction_resolved
        return project

    def resolve_project_art_direction(self, project: Script, series: Series | None = None) -> ArtDirection | None:
        """解析项目最终生效的美术设定。"""
        series = series if series is not None else (self.series_repository.get(project.series_id) if project.series_id else None)
        source = self._normalized_source(project, series)
        if source == "standalone":
            return project.art_direction
        if source == "series_default":
            return series.art_direction if series else project.art_direction
        base = series.art_direction if series else None
        return self._merge_art_direction(base, project.art_direction_override or {})

    def save_series_art_direction(
        self,
        series_id: str,
        selected_style_id: str,
        style_config: dict[str, Any],
        ai_recommendations: list[dict[str, Any]] | None = None,
        updated_by: str | None = None,
    ) -> Series:
        """更新剧集主档美术设定。"""
        series = self.series_repository.get(series_id)
        if not series:
            raise ValueError("Series not found")
        preserved_ai = (
            series.art_direction.ai_recommendations
            if series.art_direction and ai_recommendations is None
            else (ai_recommendations or [])
        )
        series.art_direction = ArtDirection(
            selected_style_id=selected_style_id,
            style_config=style_config,
            custom_styles=[],
            ai_recommendations=preserved_ai,
        )
        return self.series_repository.patch_metadata(
            series_id,
            {
                "art_direction": series.art_direction.model_dump(mode="json"),
                "art_direction_updated_at": utc_now(),
                "art_direction_updated_by": updated_by,
                "updated_at": utc_now(),
                "updated_by": updated_by,
            },
            expected_version=series.version,
        )

    def save_project_override(
        self,
        project_id: str,
        selected_style_id: str,
        style_config: dict[str, Any],
        updated_by: str | None = None,
    ) -> Script:
        """保存项目相对剧集主档的差异美术设定。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Project not found")
        if not project.series_id:
            return self.project_repository.patch_metadata(
                project_id,
                {
                    "art_direction": ArtDirection(
                        selected_style_id=selected_style_id,
                        style_config=style_config,
                        custom_styles=[],
                        ai_recommendations=[],
                    ).model_dump(mode="json"),
                    "art_direction_source": "standalone",
                    "art_direction_override": None,
                    "art_direction_resolved": None,
                    "art_direction_overridden_at": None,
                    "art_direction_overridden_by": None,
                    "updated_at": utc_now(),
                    "updated_by": updated_by,
                },
                expected_version=project.version,
            )

        override_patch = {
            "selected_style_id": selected_style_id,
            "style_config": {
                "name": style_config.get("name", ""),
                "description": style_config.get("description", ""),
                "positive_prompt": style_config.get("positive_prompt", ""),
                "negative_prompt": style_config.get("negative_prompt", ""),
                "thumbnail_url": style_config.get("thumbnail_url"),
                "is_custom": bool(style_config.get("is_custom", False)),
            },
        }
        resolved = self.resolve_project_art_direction(
            project.model_copy(update={"art_direction_source": "project_override", "art_direction_override": override_patch})
        )
        updated = self.project_repository.patch_metadata(
            project_id,
            {
                "art_direction_source": "project_override",
                "art_direction_override": override_patch,
                "art_direction_resolved": resolved.model_dump(mode="json") if resolved else None,
                "art_direction_overridden_at": utc_now(),
                "art_direction_overridden_by": updated_by,
                "updated_at": utc_now(),
                "updated_by": updated_by,
            },
            expected_version=project.version,
        )
        return self.apply_resolved_art_direction(updated)

    def clear_project_override(self, project_id: str, updated_by: str | None = None) -> Script:
        """清空项目级覆写，恢复为剧集默认。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Project not found")
        next_source = "series_default" if project.series_id else "standalone"
        updated = self.project_repository.patch_metadata(
            project_id,
            {
                "art_direction_source": next_source,
                "art_direction_override": None,
                "art_direction_resolved": None,
                "art_direction_overridden_at": None,
                "art_direction_overridden_by": None,
                "updated_at": utc_now(),
                "updated_by": updated_by,
            },
            expected_version=project.version,
        )
        return self.apply_resolved_art_direction(updated)

    def build_task_art_direction_context(
        self,
        *,
        project_id: str | None = None,
        series_id: str | None = None,
        apply_style: bool = True,
    ) -> dict[str, Any]:
        """为任务 payload 生成可审计的美术上下文。"""
        if not apply_style:
            return {
                "art_direction_source": "disabled",
                "resolved_art_direction": None,
                "style_resolution_scope": "disabled",
            }
        if project_id:
            payload = self.get_resolved_project_payload(project_id)
            return {
                "art_direction_source": payload["source"],
                "resolved_art_direction": payload["resolved_art_direction"],
                "style_resolution_scope": "project",
            }
        if series_id:
            series = self.series_repository.get(series_id)
            if not series:
                raise ValueError("Series not found")
            return {
                "art_direction_source": "series_default",
                "resolved_art_direction": series.art_direction.model_dump(mode="json") if series.art_direction else None,
                "style_resolution_scope": "series",
            }
        return {
            "art_direction_source": "standalone",
            "resolved_art_direction": None,
            "style_resolution_scope": "none",
        }

    def _normalized_source(self, project: Script, series: Series | None) -> str:
        """规范化项目当前美术来源。"""
        if not series and not project.series_id:
            return "standalone"
        source = project.art_direction_source or ""
        if source in {"series_default", "project_override", "standalone"}:
            if source == "standalone" and series:
                return "series_default"
            return source
        return "series_default" if series else "standalone"

    def _merge_art_direction(self, base: ArtDirection | None, override_patch: dict[str, Any]) -> ArtDirection | None:
        """按允许字段把项目 patch 合并到剧集主档。"""
        if not base and not override_patch:
            return None
        merged = deepcopy(base.model_dump(mode="json") if base else {
            "selected_style_id": override_patch.get("selected_style_id", ""),
            "style_config": {},
            "custom_styles": [],
            "ai_recommendations": [],
        })
        if override_patch.get("selected_style_id"):
            merged["selected_style_id"] = override_patch["selected_style_id"]
        merged_style = dict(merged.get("style_config") or {})
        for key in ("name", "description", "positive_prompt", "negative_prompt", "thumbnail_url", "is_custom"):
            if key in (override_patch.get("style_config") or {}):
                merged_style[key] = override_patch["style_config"][key]
        merged["style_config"] = merged_style
        merged["custom_styles"] = []
        merged["ai_recommendations"] = []
        return ArtDirection(**merged)
