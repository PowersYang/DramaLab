"""
系列角色解析服务。

这里负责把一次分集提取到的角色候选，尽量对齐到系列主档角色。
"""

from dataclasses import dataclass

from ...repository import SeriesRepository
from ...schemas.models import Character


@dataclass
class ResolvedSeriesCharacter:
    """一次角色解析后的标准结果。"""

    source_character: Character
    series_character: Character
    match_status: str
    match_confidence: float
    is_new_character: bool


class SeriesEntityResolutionService:
    """负责把分集角色候选解析到系列角色主档。"""

    def __init__(self):
        self.series_repository = SeriesRepository()

    def resolve_characters(self, series_id: str, incoming_characters: list[Character]) -> list[ResolvedSeriesCharacter]:
        """按系列主档对齐角色候选。"""
        series = self.series_repository.get(series_id)
        if not series:
            raise ValueError("Series not found")

        canonical_map: dict[str, Character] = {}
        alias_map: dict[str, Character] = {}
        name_map: dict[str, Character] = {}

        for character in series.characters:
            canonical_name = self._normalize_name(character.canonical_name or character.name)
            if canonical_name:
                canonical_map[canonical_name] = character
            normalized_name = self._normalize_name(character.name)
            if normalized_name:
                name_map[normalized_name] = character
            for alias in character.aliases:
                normalized_alias = self._normalize_name(alias)
                if normalized_alias:
                    alias_map[normalized_alias] = character

        resolved: list[ResolvedSeriesCharacter] = []
        for incoming in incoming_characters:
            normalized_name = self._normalize_name(incoming.name)
            matched = canonical_map.get(normalized_name) or alias_map.get(normalized_name) or name_map.get(normalized_name)
            if matched:
                resolved.append(
                    ResolvedSeriesCharacter(
                        source_character=incoming,
                        series_character=matched,
                        match_status="auto_matched",
                        match_confidence=1.0,
                        is_new_character=False,
                    )
                )
                continue

            if not incoming.canonical_name:
                incoming.canonical_name = incoming.name
            if not incoming.aliases:
                incoming.aliases = [incoming.name]
            incoming.merge_status = "active"
            resolved.append(
                ResolvedSeriesCharacter(
                    source_character=incoming,
                    series_character=incoming,
                    match_status="confirmed_new",
                    match_confidence=0.0,
                    is_new_character=True,
                )
            )

        return resolved

    def _normalize_name(self, value: str | None) -> str:
        """统一角色名匹配的最小归一化规则。"""
        return str(value or "").strip().lower()
