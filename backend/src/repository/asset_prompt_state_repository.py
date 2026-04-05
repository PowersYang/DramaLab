"""资产提示词状态仓储。"""

from __future__ import annotations

import hashlib

from ..db.models import AssetPromptStateRecord
from ..schemas.models import AssetPromptState
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: AssetPromptStateRecord) -> AssetPromptState:
    return AssetPromptState(
        id=record.id,
        owner_scope=record.owner_scope,
        owner_id=record.owner_id,
        asset_type=record.asset_type,
        asset_id=record.asset_id,
        output_type=record.output_type,
        slot_type=record.slot_type,
        positive_prompt=record.positive_prompt or "",
        negative_prompt=record.negative_prompt or "",
        source=record.source or "user_input",
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _build_record_id(
    *,
    owner_scope: str,
    owner_id: str,
    asset_type: str,
    asset_id: str,
    output_type: str,
    slot_type: str,
) -> str:
    # 中文注释：提示词状态记录使用稳定哈希 ID，避免并发 upsert 场景下重复创建脏记录。
    raw = f"{owner_scope}:{owner_id}:{asset_type}:{asset_id}:{output_type}:{slot_type}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]
    return f"aps_{digest}"


class AssetPromptStateRepository(BaseRepository[AssetPromptState]):
    """维护素材弹窗提示词真源。"""

    def upsert_by_scope(
        self,
        *,
        owner_scope: str,
        owner_id: str,
        asset_type: str,
        asset_id: str,
        output_type: str,
        slot_type: str,
        positive_prompt: str,
        negative_prompt: str,
        source: str = "user_input",
        organization_id: str | None = None,
        workspace_id: str | None = None,
        actor_id: str | None = None,
    ) -> AssetPromptState:
        with self._with_session() as session:
            record = (
                session.query(AssetPromptStateRecord)
                .filter(
                    AssetPromptStateRecord.owner_scope == owner_scope,
                    AssetPromptStateRecord.owner_id == owner_id,
                    AssetPromptStateRecord.asset_type == asset_type,
                    AssetPromptStateRecord.asset_id == asset_id,
                    AssetPromptStateRecord.output_type == output_type,
                    AssetPromptStateRecord.slot_type == slot_type,
                )
                .one_or_none()
            )
            now = utc_now()
            if record is None:
                record = AssetPromptStateRecord(
                    id=_build_record_id(
                        owner_scope=owner_scope,
                        owner_id=owner_id,
                        asset_type=asset_type,
                        asset_id=asset_id,
                        output_type=output_type,
                        slot_type=slot_type,
                    ),
                    owner_scope=owner_scope,
                    owner_id=owner_id,
                    asset_type=asset_type,
                    asset_id=asset_id,
                    output_type=output_type,
                    slot_type=slot_type,
                    positive_prompt=positive_prompt,
                    negative_prompt=negative_prompt,
                    source=source,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                    created_by=actor_id,
                    updated_by=actor_id,
                    created_at=now,
                    updated_at=now,
                )
                session.add(record)
            else:
                record.positive_prompt = positive_prompt
                record.negative_prompt = negative_prompt
                record.source = source
                record.organization_id = organization_id
                record.workspace_id = workspace_id
                record.updated_by = actor_id
                record.updated_at = now
            session.flush()
            return _to_domain(record)

    def list_by_asset(
        self,
        *,
        owner_scope: str,
        owner_id: str,
        asset_type: str,
        asset_id: str,
        output_type: str | None = None,
    ) -> list[AssetPromptState]:
        with self._with_session() as session:
            query = session.query(AssetPromptStateRecord).filter(
                AssetPromptStateRecord.owner_scope == owner_scope,
                AssetPromptStateRecord.owner_id == owner_id,
                AssetPromptStateRecord.asset_type == asset_type,
                AssetPromptStateRecord.asset_id == asset_id,
            )
            if output_type:
                query = query.filter(AssetPromptStateRecord.output_type == output_type)
            records = (
                query.order_by(
                    AssetPromptStateRecord.output_type.asc(),
                    AssetPromptStateRecord.slot_type.asc(),
                    AssetPromptStateRecord.updated_at.desc(),
                ).all()
            )
            return [_to_domain(item) for item in records]

    def list_map(self):
        raise NotImplementedError("AssetPromptStateRepository does not support list_map")

    def sync(self, items):
        raise NotImplementedError("AssetPromptStateRepository does not support bulk sync")
