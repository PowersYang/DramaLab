"""
系列资产收件箱服务。

这里负责管理“待人工确认”的资产候选，避免分集提取结果直接污染剧集主档。
"""

from typing import Any

from ...repository import SeriesRepository


class SeriesAssetInboxService:
    """负责系列资产收件箱读写与去重策略。"""

    def __init__(self):
        self.series_repository = SeriesRepository()

    def get_inbox(self, series_id: str) -> dict:
        """读取系列资产收件箱。"""
        inbox = self.series_repository.get_asset_inbox(series_id)
        return self._normalize_inbox(inbox)

    def upsert_inbox(
        self,
        series_id: str,
        characters: list[Any],
        scenes: list[Any],
        props: list[Any],
        mode: str = "replace",
        expected_version: int | None = None,
    ) -> dict:
        """写入或追加系列资产收件箱。"""
        normalized_mode = str(mode or "replace").strip().lower()
        if normalized_mode not in {"replace", "append"}:
            raise ValueError("Unsupported inbox update mode")

        incoming = self._normalize_inbox(
            {
                "characters": self._serialize_items(characters),
                "scenes": self._serialize_items(scenes),
                "props": self._serialize_items(props),
            }
        )
        if normalized_mode == "replace":
            return self.series_repository.save_asset_inbox(series_id, incoming, expected_version=expected_version)

        current = self.series_repository.get_asset_inbox(series_id)
        merged = {
            "characters": self._append_unique(current.get("characters") or [], incoming.get("characters") or []),
            "scenes": self._append_unique(current.get("scenes") or [], incoming.get("scenes") or []),
            "props": self._append_unique(current.get("props") or [], incoming.get("props") or []),
        }
        return self.series_repository.save_asset_inbox(series_id, merged, expected_version=expected_version)

    def remove_items(
        self,
        series_id: str,
        character_ids: list[str],
        scene_ids: list[str],
        prop_ids: list[str],
        expected_version: int | None = None,
    ) -> dict:
        """按 ID 从收件箱移除候选。"""
        current = self.series_repository.get_asset_inbox(series_id)
        removed_character_ids = set(character_ids or [])
        removed_scene_ids = set(scene_ids or [])
        removed_prop_ids = set(prop_ids or [])
        next_inbox = {
            "characters": [item for item in (current.get("characters") or []) if item.get("id") not in removed_character_ids],
            "scenes": [item for item in (current.get("scenes") or []) if item.get("id") not in removed_scene_ids],
            "props": [item for item in (current.get("props") or []) if item.get("id") not in removed_prop_ids],
        }
        return self.series_repository.save_asset_inbox(series_id, next_inbox, expected_version=expected_version)

    def append_project_extracted_entities(
        self,
        series_id: str,
        characters: list[Any],
        scenes: list[Any],
        props: list[Any],
    ) -> dict:
        """把分集重解析出的角色/场景/道具候选追加到系列收件箱。"""
        return self.upsert_inbox(
            series_id=series_id,
            characters=characters,
            scenes=scenes,
            props=props,
            mode="append",
            expected_version=None,
        )

    def _append_unique(self, existing: list[dict], incoming: list[dict]) -> list[dict]:
        """按名称归一化去重并保持顺序。"""
        merged = list(existing or [])
        seen = {self._normalize_name(item.get("name")) for item in merged}
        for item in incoming or []:
            normalized_name = self._normalize_name(item.get("name"))
            if not normalized_name or normalized_name in seen:
                continue
            seen.add(normalized_name)
            merged.append(item)
        return merged

    def _normalize_inbox(self, inbox: dict) -> dict:
        """把收件箱结构规整为前端可直接消费的稳定形态。"""
        return {
            "characters": self._append_unique([], list(inbox.get("characters") or [])),
            "scenes": self._append_unique([], list(inbox.get("scenes") or [])),
            "props": self._append_unique([], list(inbox.get("props") or [])),
            "series_version": inbox.get("series_version"),
        }

    def _serialize_items(self, items: list[Any]) -> list[dict]:
        """兼容 Pydantic 模型和原始字典输入。"""
        serialized: list[dict] = []
        for item in items or []:
            if hasattr(item, "model_dump"):
                serialized.append(item.model_dump(mode="json"))
            elif isinstance(item, dict):
                serialized.append(dict(item))
        return serialized

    def _normalize_name(self, value: str | None) -> str:
        return str(value or "").strip().lower()
