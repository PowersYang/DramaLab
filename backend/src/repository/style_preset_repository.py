from .base import BaseRepository
from ..db.models import StylePresetRecord
from ..schemas.models import StylePreset


class StylePresetRepository(BaseRepository[StylePreset]):
    """风格预设仓储。

    风格预设已经从 JSON 文件迁移到数据库，这里负责统一的查询和默认补种。
    """

    def list_map(self) -> dict[str, StylePreset]:
        with self._with_session() as session:
            records = (
                session.query(StylePresetRecord)
                .filter(StylePresetRecord.is_active.is_(True))
                .order_by(StylePresetRecord.sort_order.asc(), StylePresetRecord.created_at.asc())
                .all()
            )
            return {record.id: self._to_model(record) for record in records}

    def list_active(self) -> list[StylePreset]:
        """按显示顺序返回当前可用预设。"""
        return list(self.list_map().values())

    def ensure_defaults(self, presets: list[StylePreset]) -> None:
        """补种默认预设。

        这里只在数据库缺记录时补种，避免覆盖线上已人工维护的风格内容。
        对于已存在但被停用的内置预设，会重新激活，确保默认预设在新环境始终可用。
        """
        if not presets:
            return

        with self._with_session() as session:
            preset_ids = [preset.id for preset in presets]
            existing_records = session.query(StylePresetRecord).filter(StylePresetRecord.id.in_(preset_ids)).all()
            existing_map = {record.id: record for record in existing_records}

            for preset in presets:
                record = existing_map.get(preset.id)
                if record is None:
                    session.add(self._to_record(preset))
                    continue

                record.is_active = True
                record.is_builtin = True
                record.sort_order = preset.sort_order
                if not record.name:
                    record.name = preset.name
                if not record.description:
                    record.description = preset.description
                if not record.positive_prompt:
                    record.positive_prompt = preset.positive_prompt
                if preset.negative_prompt and not record.negative_prompt:
                    record.negative_prompt = preset.negative_prompt
                if preset.thumbnail_url and not record.thumbnail_url:
                    record.thumbnail_url = preset.thumbnail_url

    def save(self, preset: StylePreset) -> StylePreset:
        """新增或更新单条风格预设。"""
        with self._with_session() as session:
            record = session.query(StylePresetRecord).filter(StylePresetRecord.id == preset.id).one_or_none()
            if record is None:
                record = self._to_record(preset)
                session.add(record)
            else:
                # 统一通过仓储基座维护 updated_at，避免各调用点重复处理审计时间。
                self._patch_record(
                    record,
                    {
                        "name": preset.name,
                        "description": preset.description,
                        "positive_prompt": preset.positive_prompt,
                        "negative_prompt": preset.negative_prompt,
                        "thumbnail_url": preset.thumbnail_url,
                        "sort_order": preset.sort_order,
                        "is_builtin": preset.is_builtin,
                        "is_active": preset.is_active,
                    },
                )
            session.flush()
            return self._to_model(record)

    def _to_model(self, record: StylePresetRecord) -> StylePreset:
        return StylePreset(
            id=record.id,
            name=record.name,
            description=record.description,
            positive_prompt=record.positive_prompt,
            negative_prompt=record.negative_prompt,
            thumbnail_url=record.thumbnail_url,
            sort_order=record.sort_order,
            is_builtin=record.is_builtin,
            is_active=record.is_active,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    def _to_record(self, preset: StylePreset) -> StylePresetRecord:
        return StylePresetRecord(
            id=preset.id,
            name=preset.name,
            description=preset.description,
            positive_prompt=preset.positive_prompt,
            negative_prompt=preset.negative_prompt,
            thumbnail_url=preset.thumbnail_url,
            sort_order=preset.sort_order,
            is_builtin=preset.is_builtin,
            is_active=preset.is_active,
            created_at=preset.created_at,
            updated_at=preset.updated_at,
        )
