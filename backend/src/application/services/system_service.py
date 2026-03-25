"""
系统服务。

这一层承接 system.py 中原本依赖 pipeline 的零散能力：
- 导入预览的临时文本缓存
- 系列导入确认
- Art Direction 保存
- 提示词三级回退读取
- 风格分析
"""

import time
import uuid
from typing import Any

from ...providers import ScriptProcessor
from ...repository import ProjectRepository, SeriesRepository
from ...schemas.models import ArtDirection
from ...providers.text.default_prompts import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
)
from .series_service import SeriesService


class SystemService:
    # 导入确认前的原文缓存仍然保留在进程内，但不再挂在 pipeline 上。
    _import_cache: dict[str, str] = {}

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.text_provider = ScriptProcessor()

    def preview_import(self, text: str, suggested_episodes: int):
        """Split imported text into tentative episode slices for preview."""
        episodes = self.text_provider.split_into_episodes(text, suggested_episodes)
        import_id = str(uuid.uuid4())
        self._import_cache[import_id] = text
        return {
            "suggested_episodes": suggested_episodes,
            "episodes": episodes,
            "import_id": import_id,
        }

    def pop_import_text(self, import_id: str):
        """Consume a previously cached import payload."""
        return self._import_cache.pop(import_id, None)

    def create_series_from_import(
        self,
        title: str,
        text: str,
        episodes_data: list[dict[str, Any]],
        description: str = "",
    ):
        """Create a series and draft episode projects from imported text."""
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
            script.updated_at = time.time()
            self.project_repository.save(script)

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

        series.updated_at = time.time()
        self.series_repository.save(series)
        return {
            "series": series.model_dump(),
            "episodes": created_episodes,
        }

    def analyze_script_for_styles(self, script_id: str, script_text: str):
        """Return style recommendations for a stored script."""
        script = self.project_repository.get(script_id)
        if not script:
            raise ValueError("Script not found")
        return self.text_provider.analyze_script_for_styles(script_text)

    def save_art_direction(
        self,
        script_id: str,
        selected_style_id: str,
        style_config: dict[str, Any],
        custom_styles: list[dict[str, Any]] | None = None,
        ai_recommendations: list[dict[str, Any]] | None = None,
    ):
        """Persist art direction choices on the target script."""
        script = self.project_repository.get(script_id)
        if not script:
            raise ValueError("Script not found")

        script.art_direction = ArtDirection(
            selected_style_id=selected_style_id,
            style_config=style_config,
            custom_styles=custom_styles or [],
            ai_recommendations=ai_recommendations or [],
        )
        script.updated_at = time.time()
        self.project_repository.save(script)
        return self.project_repository.get(script_id)

    def get_effective_prompt(self, script_id: str, field: str) -> str:
        """Resolve a prompt field using script, series, then default fallback."""
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
        """Implement the three-level prompt fallback contract."""
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
        """Cut imported text by LLM-provided markers with a safe fallback split."""
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
            # Marker-based slicing is best effort. If markers are missing or
            # unusable, fall back to even chunks so the import still succeeds.
            chunk_size = max(1, len(text) // max(len(episodes_data), 1))
            chunks = []
            for index in range(len(episodes_data)):
                start = index * chunk_size
                end = start + chunk_size if index < len(episodes_data) - 1 else len(text)
                chunks.append(text[start:end])

        return chunks
