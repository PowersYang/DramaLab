"""
系统服务。

这一层承接 system.py 中原本依赖 pipeline 的零散能力：
- 导入预览的临时文本缓存
- 系列导入确认
- Art Direction 保存
- 提示词三级回退读取
- 风格分析
"""

import uuid
from typing import Any

from ...providers import ScriptProcessor
from ...repository import ProjectRepository, SeriesRepository, StylePresetRepository, UserArtStyleRepository, UserRepository
from ...schemas.models import ArtDirection, StylePreset, UserArtStyle
from ...schemas.requests import UserArtStyleWriteRequest
from ...providers.text.default_prompts import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
)
from ...utils.datetime import utc_now
from .art_direction_resolution_service import ArtDirectionResolutionService
from .default_style_presets import DEFAULT_STYLE_PRESETS
from .series_service import SeriesService


class SystemService:
    # 导入确认前的原文缓存仍然保留在进程内，但不再挂在 pipeline 上。
    _import_cache: dict[str, str] = {}

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.style_preset_repository = StylePresetRepository()
        self.user_repository = UserRepository()
        self.user_art_style_repository = UserArtStyleRepository()
        self.text_provider = ScriptProcessor()
        self.art_direction_resolution_service = ArtDirectionResolutionService()

    def preview_import(self, text: str, suggested_episodes: int):
        """把导入文本切成候选分集片段供预览。"""
        episodes = self.text_provider.split_into_episodes(text, suggested_episodes)
        import_id = str(uuid.uuid4())
        self._import_cache[import_id] = text
        return {
            "suggested_episodes": suggested_episodes,
            "episodes": episodes,
            "import_id": import_id,
        }

    def pop_import_text(self, import_id: str):
        """取出并消费一份已缓存的导入原文。"""
        return self._import_cache.pop(import_id, None)

    def create_series_from_import(
        self,
        title: str,
        text: str,
        episodes_data: list[dict[str, Any]],
        description: str = "",
    ):
        """根据导入文本创建系列和草稿分集项目。"""
        series = SeriesService().create_series(title, description)
        episode_texts = self._split_text_by_markers(text, episodes_data)

        created_episodes = []
        for index, episode_data in enumerate(episodes_data):
            episode_text = episode_texts[index] if index < len(episode_texts) else ""
            episode_title = episode_data.get("title", f"第{index + 1}集")
            episode_number = episode_data.get("episode_number", index + 1)

            script = self.text_provider.create_draft_script(episode_title, episode_text)
            script.series_id = series.id
            script.episode_number = episode_number
            script.updated_at = utc_now()
            self.project_repository.create(script)

            if script.id not in series.episode_ids:
                series.episode_ids.append(script.id)
            created_episodes.append(
                {
                    "id": script.id,
                    "title": episode_title,
                    "episode_number": episode_number,
                    "text_length": len(episode_text),
                }
            )

        self.series_repository.patch_metadata(series.id, {"updated_at": utc_now()}, expected_version=series.version)
        return {
            "series": self.series_repository.get(series.id).model_dump(),
            "episodes": created_episodes,
        }

    def analyze_script_for_styles(self, script_id: str, script_text: str):
        """为已存储剧本返回风格推荐。"""
        script = self.project_repository.get(script_id)
        if not script:
            raise ValueError("Script not found")
        return self.text_provider.analyze_script_for_styles(script_text)

    def persist_art_direction_recommendations(self, script_id: str, recommendations: list[dict[str, Any]] | None) -> None:
        script = self.project_repository.get(script_id)
        if not script:
            raise ValueError("Script not found")
        recommendations = recommendations or []

        if script.series_id:
            for _ in range(2):
                series = self.series_repository.get(script.series_id)
                if not series:
                    return

                existing = series.art_direction
                if not existing:
                    if not recommendations:
                        return
                    first = recommendations[0]
                    selected_style_id = str(first.get("id") or "").strip()
                    if not selected_style_id:
                        return
                    next_art_direction = ArtDirection(
                        selected_style_id=selected_style_id,
                        style_config=first,
                        custom_styles=[],
                        ai_recommendations=recommendations,
                    )
                else:
                    next_art_direction = ArtDirection(
                        selected_style_id=existing.selected_style_id,
                        style_config=existing.style_config,
                        custom_styles=existing.custom_styles,
                        ai_recommendations=recommendations,
                    )

                try:
                    self.series_repository.patch_metadata(
                        series.id,
                        {
                            "art_direction": next_art_direction.model_dump(mode="json"),
                            "updated_at": utc_now(),
                        },
                        expected_version=series.version,
                    )
                    return
                except ValueError as exc:
                    if "version conflict" in str(exc):
                        continue
                    raise
            return

        for _ in range(2):
            script = self.project_repository.get(script_id)
            if not script:
                raise ValueError("Script not found")
            existing = script.art_direction
            if not existing:
                if not recommendations:
                    return
                first = recommendations[0]
                selected_style_id = str(first.get("id") or "").strip()
                if not selected_style_id:
                    return
                next_art_direction = ArtDirection(
                    selected_style_id=selected_style_id,
                    style_config=first,
                    custom_styles=[],
                    ai_recommendations=recommendations,
                )
            else:
                next_art_direction = ArtDirection(
                    selected_style_id=existing.selected_style_id,
                    style_config=existing.style_config,
                    custom_styles=existing.custom_styles,
                    ai_recommendations=recommendations,
                )

            try:
                self.project_repository.patch_metadata(
                    script_id,
                    {
                        "art_direction": next_art_direction.model_dump(mode="json"),
                        "updated_at": utc_now(),
                    },
                    expected_version=script.version,
                )
                return
            except ValueError as exc:
                if "version conflict" in str(exc):
                    continue
                raise

    def ensure_default_style_presets(self) -> None:
        """确保默认风格预设已经落到数据库中。

        启动时补种一次，后续所有风格预设读取都只查数据库，
        从而避免多实例部署下不同机器读取本地 JSON 导致配置漂移。
        """
        self.style_preset_repository.ensure_defaults(DEFAULT_STYLE_PRESETS)

    def list_style_presets(self) -> list[StylePreset]:
        """返回当前可用的风格预设列表。"""
        return self.style_preset_repository.list_active()

    def save_art_direction(
        self,
        script_id: str,
        selected_style_id: str,
        style_config: dict[str, Any],
        custom_styles: list[dict[str, Any]] | None = None,
        ai_recommendations: list[dict[str, Any]] | None = None,
    ):
        """把美术风格选择持久化到目标剧本。"""
        script = self.project_repository.get(script_id)
        if not script:
            raise ValueError("Script not found")

        if script.series_id:
            return self.art_direction_resolution_service.save_project_override(
                script_id,
                selected_style_id=selected_style_id,
                style_config=style_config,
                updated_by=script.updated_by,
            )

        script.art_direction = ArtDirection(
            selected_style_id=selected_style_id,
            style_config=style_config,
            custom_styles=custom_styles or [],
            ai_recommendations=ai_recommendations or [],
        )
        updated = self.project_repository.patch_metadata(
            script_id,
            {
                "art_direction": script.art_direction.model_dump(mode="json"),
                "art_direction_source": "standalone",
                "art_direction_override": None,
                "art_direction_resolved": None,
                "art_direction_overridden_at": None,
                "art_direction_overridden_by": None,
                "updated_at": utc_now(),
            },
            expected_version=script.version,
        )
        return self.art_direction_resolution_service.apply_resolved_art_direction(updated)

    def list_user_art_styles(self, user_id: str) -> list[dict[str, Any]]:
        return [
            style.model_dump(mode="json", exclude={"user_id"})
            for style in self.user_art_style_repository.list_by_user_id(user_id)
        ]

    def save_user_art_styles(self, user_id: str, styles: list[UserArtStyleWriteRequest] | None = None) -> list[dict[str, Any]]:
        style_models = [
            UserArtStyle(
                id=style.id,
                user_id=user_id,
                name=style.name,
                description=style.description,
                positive_prompt=style.positive_prompt,
                negative_prompt=style.negative_prompt,
                thumbnail_url=style.thumbnail_url,
                is_custom=style.is_custom,
                reason=style.reason,
                sort_order=index if style.sort_order is None else style.sort_order,
            )
            for index, style in enumerate(styles or [])
        ]
        updated = self.user_art_style_repository.replace_for_user(user_id, style_models)
        return [style.model_dump(mode="json", exclude={"user_id"}) for style in updated]

    def get_effective_prompt(self, script_id: str, field: str) -> str:
        """按剧本、系列、默认值三级回退解析提示词字段。"""
        if not script_id:
            return ""

        script = self.project_repository.get(script_id)
        if not script:
            return ""

        series = self.series_repository.get(script.series_id) if script.series_id else None
        effective = self._resolve_effective_prompt(field, script, series)
        defaults = {
            "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
            "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
            "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
        }
        if effective == defaults.get(field, ""):
            return ""
        return effective

    def _resolve_effective_prompt(self, field: str, script, series=None) -> str:
        """实现提示词三级回退规则。"""
        if field not in ("storyboard_polish", "video_polish", "r2v_polish"):
            raise ValueError(f"Unsupported prompt field: {field}")

        script_value = getattr(script.prompt_config, field, "").strip()
        if script_value:
            return script_value

        if series:
            series_value = getattr(series.prompt_config, field, "").strip()
            if series_value:
                return series_value

        defaults = {
            "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
            "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
            "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
        }
        return defaults[field]

    def _split_text_by_markers(self, text: str, episodes_data: list[dict[str, Any]]):
        """按 LLM 给出的标记切分导入文本，并提供安全兜底。"""
        chunks = []
        search_from = 0

        for episode in episodes_data:
            start_marker = episode.get("start_marker", "")
            end_marker = episode.get("end_marker", "")

            start_idx = search_from
            end_idx = len(text)

            if start_marker:
                found = text.find(start_marker, search_from)
                if found >= 0:
                    start_idx = found

            if end_marker:
                found = text.find(end_marker, start_idx)
                if found >= 0:
                    end_idx = found + len(end_marker)

            chunks.append(text[start_idx:end_idx])
            search_from = end_idx

        if not chunks or all(len(chunk.strip()) == 0 for chunk in chunks):
            # 基于标记的切分是尽力而为；如果标记不可用，则退回到平均切分，保证导入仍能完成。
            chunk_size = max(1, len(text) // max(len(episodes_data), 1))
            chunks = []
            for index in range(len(episodes_data)):
                start = index * chunk_size
                end = start + chunk_size if index < len(episodes_data) - 1 else len(text)
                chunks.append(text[start:end])

        return chunks
