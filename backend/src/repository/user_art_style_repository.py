"""用户美术风格明细仓储。"""

from .base import BaseRepository
from ..db.models import UserArtStyleRecord
from ..schemas.models import UserArtStyle


class UserArtStyleRepository(BaseRepository[UserArtStyle]):
    """负责用户风格明细的读取、覆盖保存与删除。"""

    def list_map(self) -> dict[str, UserArtStyle]:
        with self._with_session() as session:
            records = session.query(UserArtStyleRecord).all()
            return {record.id: self._to_model(record) for record in records}

    def list_by_user_id(self, user_id: str) -> list[UserArtStyle]:
        """按排序顺序返回用户风格列表。"""
        with self._with_session() as session:
            records = (
                session.query(UserArtStyleRecord)
                .filter(UserArtStyleRecord.user_id == user_id)
                .order_by(UserArtStyleRecord.sort_order.asc(), UserArtStyleRecord.created_at.asc())
                .all()
            )
            return [self._to_model(record) for record in records]

    def replace_for_user(self, user_id: str, styles: list[UserArtStyle]) -> list[UserArtStyle]:
        """整体覆盖用户风格列表，但在库内仍以一条风格一行记录保存。"""
        with self._with_session() as session:
            existing_records = (
                session.query(UserArtStyleRecord)
                .filter(UserArtStyleRecord.user_id == user_id)
                .all()
            )
            existing_by_id = {record.id: record for record in existing_records}
            incoming_ids = {style.id for style in styles}

            for stale_record in existing_records:
                if stale_record.id not in incoming_ids:
                    session.delete(stale_record)

            for index, style in enumerate(styles):
                record = existing_by_id.get(style.id)
                if record is None:
                    session.add(
                        UserArtStyleRecord(
                            id=style.id,
                            user_id=user_id,
                            name=style.name,
                            description=style.description or "",
                            positive_prompt=style.positive_prompt,
                            negative_prompt=style.negative_prompt or "",
                            thumbnail_url=style.thumbnail_url,
                            is_custom=style.is_custom,
                            reason=style.reason,
                            sort_order=style.sort_order if style.sort_order is not None else index,
                        )
                    )
                    continue

                # 中文注释：前端仍以整包 styles[] 提交，但数据库层拆成逐行记录，仓储在这里负责把列表顺序落成 sort_order。
                self._patch_record(
                    record,
                    {
                        "name": style.name,
                        "description": style.description or "",
                        "positive_prompt": style.positive_prompt,
                        "negative_prompt": style.negative_prompt or "",
                        "thumbnail_url": style.thumbnail_url,
                        "is_custom": style.is_custom,
                        "reason": style.reason,
                        "sort_order": style.sort_order if style.sort_order is not None else index,
                    },
                )

            session.flush()
            refreshed = (
                session.query(UserArtStyleRecord)
                .filter(UserArtStyleRecord.user_id == user_id)
                .order_by(UserArtStyleRecord.sort_order.asc(), UserArtStyleRecord.created_at.asc())
                .all()
            )
            return [self._to_model(record) for record in refreshed]

    def delete_for_user(self, user_id: str) -> None:
        """删除用户全部风格。"""
        with self._with_session() as session:
            session.query(UserArtStyleRecord).filter(UserArtStyleRecord.user_id == user_id).delete()

    def _to_model(self, record: UserArtStyleRecord) -> UserArtStyle:
        return UserArtStyle(
            id=record.id,
            user_id=record.user_id,
            name=record.name,
            description=record.description or "",
            positive_prompt=record.positive_prompt,
            negative_prompt=record.negative_prompt or "",
            thumbnail_url=record.thumbnail_url,
            is_custom=record.is_custom,
            reason=record.reason,
            sort_order=record.sort_order,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
