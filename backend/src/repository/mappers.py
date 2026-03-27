from collections import defaultdict
from datetime import datetime
from typing import Iterable
import uuid

from sqlalchemy.orm import Session

from ..db.models import (
    CharacterAssetUnitRecord,
    CharacterRecord,
    ImageVariantRecord,
    ProjectRecord,
    PropRecord,
    SceneRecord,
    SeriesRecord,
    StoryboardFrameRecord,
    VideoTaskRecord,
    VideoVariantRecord,
)
from ..schemas.models import (
    ArtDirection,
    AssetUnit,
    Character,
    ImageAsset,
    ImageVariant,
    ModelSettings,
    PromptConfig,
    Prop,
    Scene,
    Script,
    Series,
    StoryboardFrame,
    VideoTask,
    VideoVariant,
)
from ..utils.datetime import utc_now


CHARACTER_UNIT_TYPES = ("full_body", "three_views", "head_shot")


def _now() -> datetime:
    return utc_now()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _tenant_kwargs(domain_obj) -> dict:
    return {
        "organization_id": getattr(domain_obj, "organization_id", None),
        "workspace_id": getattr(domain_obj, "workspace_id", None),
        "created_by": getattr(domain_obj, "created_by", None),
        "updated_by": getattr(domain_obj, "updated_by", None),
    }


def _audit_time_kwargs(domain_obj) -> dict:
    return {
        "created_at": getattr(domain_obj, "created_at", _now()),
        "updated_at": getattr(domain_obj, "updated_at", _now()),
    }


def _soft_delete_query(query, deleted_by: str | None = None) -> None:
    # 聚合级 replace 现在不再物理删除旧图，而是先整体软删，再 merge 新图。
    payload = {
        "is_deleted": True,
        "deleted_at": _now(),
        "updated_at": _now(),
    }
    if hasattr(query.column_descriptions[0].get("entity"), "deleted_by"):
        payload["deleted_by"] = deleted_by
    query.update(payload, synchronize_session=False)


def _active(query):
    # hydrate 默认只拼装未删除对象，避免把历史数据重新暴露给当前业务读模型。
    entity = query.column_descriptions[0].get("entity")
    if entity is not None and hasattr(entity, "is_deleted"):
        return query.filter(entity.is_deleted.is_(False))
    return query


def _image_variant_record(owner_type: str, owner_id: str, variant_group: str, variant: ImageVariant, tenant: dict) -> ImageVariantRecord:
    return ImageVariantRecord(
        id=variant.id,
        owner_type=owner_type,
        owner_id=owner_id,
        variant_group=variant_group,
        url=variant.url,
        prompt_used=variant.prompt_used,
        is_favorited=variant.is_favorited,
        is_uploaded_source=variant.is_uploaded_source,
        upload_type=variant.upload_type,
        created_at=variant.created_at,
        updated_at=variant.created_at,
        **tenant,
    )


def _video_variant_record(owner_type: str, owner_id: str, variant_group: str, variant: VideoVariant, tenant: dict) -> VideoVariantRecord:
    return VideoVariantRecord(
        id=variant.id,
        owner_type=owner_type,
        owner_id=owner_id,
        variant_group=variant_group,
        url=variant.url,
        prompt_used=variant.prompt_used,
        audio_url=variant.audio_url,
        source_image_id=variant.source_image_id,
        is_favorited=variant.is_favorited,
        created_at=variant.created_at,
        updated_at=variant.created_at,
        **tenant,
    )


def _build_image_asset(selected_id: str | None, variants: list[ImageVariant]) -> ImageAsset:
    return ImageAsset(selected_id=selected_id, variants=sorted(variants, key=lambda item: item.created_at))


def _group_image_variants(records: Iterable[ImageVariantRecord]):
    grouped = defaultdict(list)
    for record in records:
        grouped[(record.owner_type, record.owner_id, record.variant_group)].append(
            ImageVariant(
                id=record.id,
                url=record.url,
                created_at=record.created_at,
                prompt_used=record.prompt_used,
                is_favorited=record.is_favorited,
                is_uploaded_source=record.is_uploaded_source,
                upload_type=record.upload_type,
            )
        )
    return grouped


def _group_video_variants(records: Iterable[VideoVariantRecord]):
    grouped = defaultdict(list)
    for record in records:
        grouped[(record.owner_type, record.owner_id, record.variant_group)].append(
            VideoVariant(
                id=record.id,
                url=record.url,
                created_at=record.created_at,
                prompt_used=record.prompt_used,
                audio_url=record.audio_url,
                source_image_id=record.source_image_id,
                is_favorited=record.is_favorited,
            )
        )
    return grouped


def _video_task_from_record(record: VideoTaskRecord) -> VideoTask:
    return VideoTask(
        id=record.id,
        project_id=record.project_id,
        frame_id=record.frame_id,
        asset_id=record.asset_id,
        image_url=record.image_url,
        prompt=record.prompt,
        status=record.status,
        video_url=record.video_url,
        duration=record.duration,
        seed=record.seed,
        resolution=record.resolution,
        generate_audio=record.generate_audio,
        audio_url=record.audio_url,
        prompt_extend=record.prompt_extend,
        negative_prompt=record.negative_prompt,
        model=record.model,
        shot_type=record.shot_type,
        generation_mode=record.generation_mode,
        reference_video_urls=record.reference_video_urls or [],
        mode=record.mode,
        sound=record.sound,
        cfg_scale=record.cfg_scale,
        vidu_audio=record.vidu_audio,
        movement_amplitude=record.movement_amplitude,
        created_at=record.created_at,
        is_deleted=record.is_deleted,
    )


def _video_task_record(task: VideoTask, tenant: dict) -> VideoTaskRecord:
    return VideoTaskRecord(
        id=task.id,
        project_id=task.project_id,
        frame_id=task.frame_id,
        asset_id=task.asset_id,
        image_url=task.image_url,
        prompt=task.prompt,
        status=task.status,
        video_url=task.video_url,
        duration=task.duration,
        seed=task.seed,
        resolution=task.resolution,
        generate_audio=task.generate_audio,
        audio_url=task.audio_url,
        prompt_extend=task.prompt_extend,
        negative_prompt=task.negative_prompt,
        model=task.model,
        shot_type=task.shot_type,
        generation_mode=task.generation_mode,
        reference_video_urls=task.reference_video_urls,
        mode=task.mode,
        sound=task.sound,
        cfg_scale=task.cfg_scale,
        vidu_audio=task.vidu_audio,
        movement_amplitude=task.movement_amplitude,
        created_at=task.created_at,
        updated_at=task.created_at,
        is_deleted=task.is_deleted,
        **tenant,
    )


def hydrate_project_map(session: Session, project_ids: set[str] | None = None, include_deleted: bool = False) -> dict[str, Script]:
    query = session.query(ProjectRecord)
    if not include_deleted:
        query = _active(query)
    if project_ids is not None:
        if not project_ids:
            return {}
        query = query.filter(ProjectRecord.id.in_(project_ids))
    project_records = query.all()
    if not project_records:
        return {}

    project_ids = [record.id for record in project_records]
    # 子资源默认全部走活跃态过滤，这样项目聚合读出来就是“当前视图”，不是历史快照全集。
    characters = _active(session.query(CharacterRecord)).filter(CharacterRecord.owner_type == "project", CharacterRecord.owner_id.in_(project_ids)).all()
    scenes = _active(session.query(SceneRecord)).filter(SceneRecord.owner_type == "project", SceneRecord.owner_id.in_(project_ids)).all()
    props = _active(session.query(PropRecord)).filter(PropRecord.owner_type == "project", PropRecord.owner_id.in_(project_ids)).all()
    frames = _active(session.query(StoryboardFrameRecord)).filter(StoryboardFrameRecord.project_id.in_(project_ids)).order_by(StoryboardFrameRecord.project_id, StoryboardFrameRecord.frame_order).all()
    tasks = _active(session.query(VideoTaskRecord)).filter(VideoTaskRecord.project_id.in_(project_ids)).all()

    character_ids = [record.id for record in characters]
    scene_ids = [record.id for record in scenes]
    prop_ids = [record.id for record in props]
    frame_ids = [record.id for record in frames]
    unit_records = _active(session.query(CharacterAssetUnitRecord)).filter(CharacterAssetUnitRecord.character_id.in_(character_ids)).all() if character_ids else []
    unit_ids = [record.id for record in unit_records]

    image_variant_records = _active(session.query(ImageVariantRecord)).filter(
        ((ImageVariantRecord.owner_type == "character") & (ImageVariantRecord.owner_id.in_(character_ids))) |
        ((ImageVariantRecord.owner_type == "character_asset_unit") & (ImageVariantRecord.owner_id.in_(unit_ids))) |
        ((ImageVariantRecord.owner_type == "scene") & (ImageVariantRecord.owner_id.in_(scene_ids))) |
        ((ImageVariantRecord.owner_type == "prop") & (ImageVariantRecord.owner_id.in_(prop_ids))) |
        ((ImageVariantRecord.owner_type == "storyboard_frame") & (ImageVariantRecord.owner_id.in_(frame_ids)))
    ).all() if (character_ids or unit_ids or scene_ids or prop_ids or frame_ids) else []

    video_variant_records = _active(session.query(VideoVariantRecord)).filter(
        (VideoVariantRecord.owner_type == "character_asset_unit") & (VideoVariantRecord.owner_id.in_(unit_ids))
    ).all() if unit_ids else []

    image_groups = _group_image_variants(image_variant_records)
    video_groups = _group_video_variants(video_variant_records)

    tasks_by_project = defaultdict(list)
    tasks_by_asset = defaultdict(list)
    for record in tasks:
        task = _video_task_from_record(record)
        tasks_by_project[task.project_id].append(task)
        if task.asset_id:
            tasks_by_asset[(task.project_id, task.asset_id)].append(task)

    units_by_character = defaultdict(dict)
    for record in unit_records:
        units_by_character[record.character_id][record.unit_type] = AssetUnit(
            selected_image_id=record.selected_image_id,
            image_variants=[],
            selected_video_id=record.selected_video_id,
            video_variants=video_groups.get(("character_asset_unit", record.id, "video_variants"), []),
            image_prompt=record.image_prompt,
            video_prompt=record.video_prompt,
            image_updated_at=record.image_updated_at,
            video_updated_at=record.video_updated_at,
        )
        units_by_character[record.character_id][record.unit_type].image_variants = image_groups.get(
            ("character_asset_unit", record.id, "image_variants"),
            [],
        )

    chars_by_project = defaultdict(list)
    for record in characters:
        full_body_asset = _build_image_asset(
            record.full_body_asset.selected_id if hasattr(record, "full_body_asset") else None,
            [],
        )
        character = Character(
            id=record.id,
            name=record.name,
            description=record.description,
            age=record.age,
            gender=record.gender,
            clothing=record.clothing,
            visual_weight=record.visual_weight,
            full_body=units_by_character.get(record.id, {}).get("full_body", AssetUnit()),
            three_views=units_by_character.get(record.id, {}).get("three_views", AssetUnit()),
            head_shot=units_by_character.get(record.id, {}).get("head_shot", AssetUnit()),
            full_body_image_url=record.full_body_image_url,
            full_body_prompt=record.full_body_prompt,
            full_body_asset=_build_image_asset(record.full_body_asset_selected_id, image_groups.get(("character", record.id, "full_body_asset"), [])),
            three_view_image_url=record.three_view_image_url,
            three_view_prompt=record.three_view_prompt,
            three_view_asset=_build_image_asset(record.three_view_asset_selected_id, image_groups.get(("character", record.id, "three_view_asset"), [])),
            headshot_image_url=record.headshot_image_url,
            headshot_prompt=record.headshot_prompt,
            headshot_asset=_build_image_asset(record.headshot_asset_selected_id, image_groups.get(("character", record.id, "headshot_asset"), [])),
            video_assets=tasks_by_asset.get((record.owner_id, record.id), []),
            video_prompt=record.video_prompt,
            image_url=record.image_url,
            avatar_url=record.avatar_url,
            is_consistent=record.is_consistent,
            full_body_updated_at=record.full_body_updated_at,
            three_view_updated_at=record.three_view_updated_at,
            headshot_updated_at=record.headshot_updated_at,
            base_character_id=record.base_character_id,
            voice_id=record.voice_id,
            voice_name=record.voice_name,
            voice_speed=record.voice_speed,
            voice_pitch=record.voice_pitch,
            voice_volume=record.voice_volume,
            locked=record.locked,
            status=record.status,
        )
        chars_by_project[record.owner_id].append(character)

    scenes_by_project = defaultdict(list)
    for record in scenes:
        scene = Scene(
            id=record.id,
            name=record.name,
            description=record.description,
            visual_weight=record.visual_weight,
            time_of_day=record.time_of_day,
            lighting_mood=record.lighting_mood,
            image_url=record.image_url,
            image_asset=_build_image_asset(record.image_selected_id, image_groups.get(("scene", record.id, "image_asset"), [])),
            video_assets=tasks_by_asset.get((record.owner_id, record.id), []),
            video_prompt=record.video_prompt,
            locked=record.locked,
            status=record.status,
        )
        scenes_by_project[record.owner_id].append(scene)

    props_by_project = defaultdict(list)
    for record in props:
        prop = Prop(
            id=record.id,
            name=record.name,
            description=record.description,
            video_url=record.video_url,
            audio_url=record.audio_url,
            sfx_url=record.sfx_url,
            bgm_url=record.bgm_url,
            image_url=record.image_url,
            image_asset=_build_image_asset(record.image_selected_id, image_groups.get(("prop", record.id, "image_asset"), [])),
            video_assets=tasks_by_asset.get((record.owner_id, record.id), []),
            video_prompt=record.video_prompt,
            locked=record.locked,
            status=record.status,
        )
        props_by_project[record.owner_id].append(prop)

    frames_by_project = defaultdict(list)
    for record in frames:
        frame = StoryboardFrame(
            id=record.id,
            scene_id=record.scene_id,
            character_ids=record.character_ids or [],
            prop_ids=record.prop_ids or [],
            action_description=record.action_description,
            facial_expression=record.facial_expression,
            dialogue=record.dialogue,
            speaker=record.speaker,
            visual_atmosphere=record.visual_atmosphere,
            character_acting=record.character_acting,
            key_action_physics=record.key_action_physics,
            shot_size=record.shot_size,
            camera_angle=record.camera_angle,
            camera_movement=record.camera_movement,
            composition=record.composition,
            atmosphere=record.atmosphere,
            composition_data=record.composition_data,
            image_prompt=record.image_prompt,
            image_prompt_cn=record.image_prompt_cn,
            image_prompt_en=record.image_prompt_en,
            image_url=record.image_url,
            image_asset=_build_image_asset(record.image_selected_id, image_groups.get(("storyboard_frame", record.id, "image_asset"), [])),
            rendered_image_url=record.rendered_image_url,
            rendered_image_asset=_build_image_asset(record.rendered_image_selected_id, image_groups.get(("storyboard_frame", record.id, "rendered_image_asset"), [])),
            video_prompt=record.video_prompt,
            video_url=record.video_url,
            audio_url=record.audio_url,
            audio_error=record.audio_error,
            sfx_url=record.sfx_url,
            selected_video_id=record.selected_video_id,
            locked=record.locked,
            status=record.status,
            updated_at=record.updated_at,
        )
        frames_by_project[record.project_id].append(frame)

    result = {}
    for record in project_records:
        result[record.id] = Script(
            id=record.id,
            title=record.title,
            original_text=record.original_text,
            characters=chars_by_project.get(record.id, []),
            scenes=scenes_by_project.get(record.id, []),
            props=props_by_project.get(record.id, []),
            frames=frames_by_project.get(record.id, []),
            video_tasks=tasks_by_project.get(record.id, []),
            style_preset=record.style_preset,
            style_prompt=record.style_prompt,
            art_direction=ArtDirection(**record.art_direction) if record.art_direction else None,
            model_settings=ModelSettings(**(record.model_settings or {})),
            prompt_config=PromptConfig(**(record.prompt_config or {})),
            merged_video_url=record.merged_video_url,
            series_id=record.series_id,
            episode_number=record.episode_number,
            organization_id=record.organization_id,
            workspace_id=record.workspace_id,
            created_by=record.created_by,
            updated_by=record.updated_by,
            version=record.version,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
    return result


def hydrate_series_map(session: Session, series_ids: set[str] | None = None, include_deleted: bool = False) -> dict[str, Series]:
    query = session.query(SeriesRecord)
    if not include_deleted:
        query = _active(query)
    if series_ids is not None:
        if not series_ids:
            return {}
        query = query.filter(SeriesRecord.id.in_(series_ids))
    series_records = query.all()
    if not series_records:
        return {}

    series_ids = [record.id for record in series_records]
    characters = _active(session.query(CharacterRecord)).filter(CharacterRecord.owner_type == "series", CharacterRecord.owner_id.in_(series_ids)).all()
    scenes = _active(session.query(SceneRecord)).filter(SceneRecord.owner_type == "series", SceneRecord.owner_id.in_(series_ids)).all()
    props = _active(session.query(PropRecord)).filter(PropRecord.owner_type == "series", PropRecord.owner_id.in_(series_ids)).all()
    unit_records = _active(session.query(CharacterAssetUnitRecord)).filter(CharacterAssetUnitRecord.character_id.in_([record.id for record in characters])).all() if characters else []
    unit_ids = [record.id for record in unit_records]
    image_variant_records = _active(session.query(ImageVariantRecord)).filter(
        ((ImageVariantRecord.owner_type == "character") & (ImageVariantRecord.owner_id.in_([record.id for record in characters]))) |
        ((ImageVariantRecord.owner_type == "character_asset_unit") & (ImageVariantRecord.owner_id.in_(unit_ids))) |
        ((ImageVariantRecord.owner_type == "scene") & (ImageVariantRecord.owner_id.in_([record.id for record in scenes]))) |
        ((ImageVariantRecord.owner_type == "prop") & (ImageVariantRecord.owner_id.in_([record.id for record in props])))
    ).all() if (characters or scenes or props or unit_ids) else []
    video_variant_records = _active(session.query(VideoVariantRecord)).filter(
        (VideoVariantRecord.owner_type == "character_asset_unit") & (VideoVariantRecord.owner_id.in_(unit_ids))
    ).all() if unit_ids else []

    image_groups = _group_image_variants(image_variant_records)
    video_groups = _group_video_variants(video_variant_records)
    units_by_character = defaultdict(dict)
    for record in unit_records:
        unit = AssetUnit(
            selected_image_id=record.selected_image_id,
            image_variants=image_groups.get(("character_asset_unit", record.id, "image_variants"), []),
            selected_video_id=record.selected_video_id,
            video_variants=video_groups.get(("character_asset_unit", record.id, "video_variants"), []),
            image_prompt=record.image_prompt,
            video_prompt=record.video_prompt,
            image_updated_at=record.image_updated_at,
            video_updated_at=record.video_updated_at,
        )
        units_by_character[record.character_id][record.unit_type] = unit

    chars_by_series = defaultdict(list)
    for record in characters:
        chars_by_series[record.owner_id].append(
            Character(
                id=record.id,
                name=record.name,
                description=record.description,
                age=record.age,
                gender=record.gender,
                clothing=record.clothing,
                visual_weight=record.visual_weight,
                full_body=units_by_character.get(record.id, {}).get("full_body", AssetUnit()),
                three_views=units_by_character.get(record.id, {}).get("three_views", AssetUnit()),
                head_shot=units_by_character.get(record.id, {}).get("head_shot", AssetUnit()),
                full_body_image_url=record.full_body_image_url,
                full_body_prompt=record.full_body_prompt,
                full_body_asset=_build_image_asset(record.full_body_asset_selected_id, image_groups.get(("character", record.id, "full_body_asset"), [])),
                three_view_image_url=record.three_view_image_url,
                three_view_prompt=record.three_view_prompt,
                three_view_asset=_build_image_asset(record.three_view_asset_selected_id, image_groups.get(("character", record.id, "three_view_asset"), [])),
                headshot_image_url=record.headshot_image_url,
                headshot_prompt=record.headshot_prompt,
                headshot_asset=_build_image_asset(record.headshot_asset_selected_id, image_groups.get(("character", record.id, "headshot_asset"), [])),
                video_assets=[],
                video_prompt=record.video_prompt,
                image_url=record.image_url,
                avatar_url=record.avatar_url,
                is_consistent=record.is_consistent,
                full_body_updated_at=record.full_body_updated_at,
                three_view_updated_at=record.three_view_updated_at,
                headshot_updated_at=record.headshot_updated_at,
                base_character_id=record.base_character_id,
                voice_id=record.voice_id,
                voice_name=record.voice_name,
                voice_speed=record.voice_speed,
                voice_pitch=record.voice_pitch,
                voice_volume=record.voice_volume,
                locked=record.locked,
                status=record.status,
            )
        )

    scenes_by_series = defaultdict(list)
    for record in scenes:
        scenes_by_series[record.owner_id].append(
            Scene(
                id=record.id,
                name=record.name,
                description=record.description,
                visual_weight=record.visual_weight,
                time_of_day=record.time_of_day,
                lighting_mood=record.lighting_mood,
                image_url=record.image_url,
                image_asset=_build_image_asset(record.image_selected_id, image_groups.get(("scene", record.id, "image_asset"), [])),
                video_assets=[],
                video_prompt=record.video_prompt,
                locked=record.locked,
                status=record.status,
            )
        )

    props_by_series = defaultdict(list)
    for record in props:
        props_by_series[record.owner_id].append(
            Prop(
                id=record.id,
                name=record.name,
                description=record.description,
                video_url=record.video_url,
                audio_url=record.audio_url,
                sfx_url=record.sfx_url,
                bgm_url=record.bgm_url,
                image_url=record.image_url,
                image_asset=_build_image_asset(record.image_selected_id, image_groups.get(("prop", record.id, "image_asset"), [])),
                video_assets=[],
                video_prompt=record.video_prompt,
                locked=record.locked,
                status=record.status,
            )
        )

    projects = _active(session.query(ProjectRecord.id, ProjectRecord.series_id)).filter(ProjectRecord.series_id.in_(series_ids)).all()
    episode_ids_by_series = defaultdict(list)
    for project_id, series_id in projects:
        episode_ids_by_series[series_id].append(project_id)

    result = {}
    for record in series_records:
        result[record.id] = Series(
            id=record.id,
            title=record.title,
            description=record.description or "",
            characters=chars_by_series.get(record.id, []),
            scenes=scenes_by_series.get(record.id, []),
            props=props_by_series.get(record.id, []),
            art_direction=ArtDirection(**record.art_direction) if record.art_direction else None,
            prompt_config=PromptConfig(**(record.prompt_config or {})),
            model_settings=ModelSettings(**(record.model_settings or {})),
            episode_ids=episode_ids_by_series.get(record.id, []),
            organization_id=record.organization_id,
            workspace_id=record.workspace_id,
            created_by=record.created_by,
            updated_by=record.updated_by,
            version=record.version,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
    return result


def replace_project_graph(session: Session, items: list[Script]) -> None:
    incoming_ids = {item.id for item in items}
    existing_ids = {record.id for record in _active(session.query(ProjectRecord.id)).all()}
    missing_ids = existing_ids - incoming_ids

    _soft_delete_project_graph(session, incoming_ids | missing_ids)

    for project in items:
        tenant = _tenant_kwargs(project)
        session.merge(
            ProjectRecord(
                id=project.id,
                title=project.title,
                original_text=project.original_text,
                style_preset=project.style_preset,
                style_prompt=project.style_prompt,
                merged_video_url=project.merged_video_url,
                series_id=project.series_id,
                episode_number=project.episode_number,
                art_direction=project.art_direction.model_dump(mode="json") if project.art_direction else None,
                model_settings=project.model_settings.model_dump(mode="json"),
                prompt_config=project.prompt_config.model_dump(mode="json"),
                version=project.version,
                is_deleted=False,
                deleted_at=None,
                deleted_by=None,
                **tenant,
                **_audit_time_kwargs(project),
            )
        )
        _insert_project_children(session, project, tenant)


def replace_series_graph(session: Session, items: list[Series]) -> None:
    incoming_ids = {item.id for item in items}
    existing_ids = {record.id for record in _active(session.query(SeriesRecord.id)).all()}
    missing_ids = existing_ids - incoming_ids

    _soft_delete_series_graph(session, incoming_ids | missing_ids)

    for series in items:
        tenant = _tenant_kwargs(series)
        session.merge(
            SeriesRecord(
                id=series.id,
                title=series.title,
                description=series.description,
                art_direction=series.art_direction.model_dump(mode="json") if series.art_direction else None,
                model_settings=series.model_settings.model_dump(mode="json"),
                prompt_config=series.prompt_config.model_dump(mode="json"),
                version=series.version,
                is_deleted=False,
                deleted_at=None,
                deleted_by=None,
                **tenant,
                **_audit_time_kwargs(series),
            )
        )
        _insert_series_children(session, series, tenant)


def _soft_delete_project_graph(session: Session, project_ids: set[str], deleted_by: str | None = None) -> None:
    if not project_ids:
        return
    character_ids = [row[0] for row in _active(session.query(CharacterRecord.id)).filter(CharacterRecord.owner_type == "project", CharacterRecord.owner_id.in_(project_ids)).all()]
    scene_ids = [row[0] for row in _active(session.query(SceneRecord.id)).filter(SceneRecord.owner_type == "project", SceneRecord.owner_id.in_(project_ids)).all()]
    prop_ids = [row[0] for row in _active(session.query(PropRecord.id)).filter(PropRecord.owner_type == "project", PropRecord.owner_id.in_(project_ids)).all()]
    frame_ids = [row[0] for row in _active(session.query(StoryboardFrameRecord.id)).filter(StoryboardFrameRecord.project_id.in_(project_ids)).all()]
    unit_ids = [row[0] for row in _active(session.query(CharacterAssetUnitRecord.id)).filter(CharacterAssetUnitRecord.character_id.in_(character_ids)).all()] if character_ids else []

    if unit_ids:
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character_asset_unit", ImageVariantRecord.owner_id.in_(unit_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(VideoVariantRecord).filter(VideoVariantRecord.owner_type == "character_asset_unit", VideoVariantRecord.owner_id.in_(unit_ids), VideoVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(CharacterAssetUnitRecord).filter(CharacterAssetUnitRecord.character_id.in_(character_ids), CharacterAssetUnitRecord.is_deleted.is_(False)), deleted_by)
    if character_ids:
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character", ImageVariantRecord.owner_id.in_(character_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(CharacterRecord).filter(CharacterRecord.id.in_(character_ids), CharacterRecord.is_deleted.is_(False)), deleted_by)
    if scene_ids:
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "scene", ImageVariantRecord.owner_id.in_(scene_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(SceneRecord).filter(SceneRecord.id.in_(scene_ids), SceneRecord.is_deleted.is_(False)), deleted_by)
    if prop_ids:
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "prop", ImageVariantRecord.owner_id.in_(prop_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(PropRecord).filter(PropRecord.id.in_(prop_ids), PropRecord.is_deleted.is_(False)), deleted_by)
    if frame_ids:
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "storyboard_frame", ImageVariantRecord.owner_id.in_(frame_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(StoryboardFrameRecord).filter(StoryboardFrameRecord.id.in_(frame_ids), StoryboardFrameRecord.is_deleted.is_(False)), deleted_by)
    _soft_delete_query(session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id.in_(project_ids), VideoTaskRecord.is_deleted.is_(False)), deleted_by)
    _soft_delete_query(session.query(ProjectRecord).filter(ProjectRecord.id.in_(project_ids), ProjectRecord.is_deleted.is_(False)), deleted_by)


def _soft_delete_series_graph(session: Session, series_ids: set[str], deleted_by: str | None = None) -> None:
    if not series_ids:
        return
    character_ids = [row[0] for row in _active(session.query(CharacterRecord.id)).filter(CharacterRecord.owner_type == "series", CharacterRecord.owner_id.in_(series_ids)).all()]
    scene_ids = [row[0] for row in _active(session.query(SceneRecord.id)).filter(SceneRecord.owner_type == "series", SceneRecord.owner_id.in_(series_ids)).all()]
    prop_ids = [row[0] for row in _active(session.query(PropRecord.id)).filter(PropRecord.owner_type == "series", PropRecord.owner_id.in_(series_ids)).all()]
    unit_ids = [row[0] for row in _active(session.query(CharacterAssetUnitRecord.id)).filter(CharacterAssetUnitRecord.character_id.in_(character_ids)).all()] if character_ids else []

    if unit_ids:
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character_asset_unit", ImageVariantRecord.owner_id.in_(unit_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(VideoVariantRecord).filter(VideoVariantRecord.owner_type == "character_asset_unit", VideoVariantRecord.owner_id.in_(unit_ids), VideoVariantRecord.is_deleted.is_(False)), deleted_by)
    if character_ids:
        _soft_delete_query(session.query(CharacterAssetUnitRecord).filter(CharacterAssetUnitRecord.character_id.in_(character_ids), CharacterAssetUnitRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character", ImageVariantRecord.owner_id.in_(character_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(CharacterRecord).filter(CharacterRecord.id.in_(character_ids), CharacterRecord.is_deleted.is_(False)), deleted_by)
    if scene_ids:
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "scene", ImageVariantRecord.owner_id.in_(scene_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(SceneRecord).filter(SceneRecord.id.in_(scene_ids), SceneRecord.is_deleted.is_(False)), deleted_by)
    if prop_ids:
        _soft_delete_query(session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "prop", ImageVariantRecord.owner_id.in_(prop_ids), ImageVariantRecord.is_deleted.is_(False)), deleted_by)
        _soft_delete_query(session.query(PropRecord).filter(PropRecord.id.in_(prop_ids), PropRecord.is_deleted.is_(False)), deleted_by)
    _soft_delete_query(session.query(SeriesRecord).filter(SeriesRecord.id.in_(series_ids), SeriesRecord.is_deleted.is_(False)), deleted_by)


def _insert_project_children(session: Session, project: Script, tenant: dict) -> None:
    task_map: dict[str, VideoTask] = {task.id: task for task in project.video_tasks}
    for character in project.characters:
        _insert_character(session, character, "project", project.id, tenant)
        for task in character.video_assets:
            task_map.setdefault(task.id, task)
    for scene in project.scenes:
        _insert_scene(session, scene, "project", project.id, tenant)
        for task in scene.video_assets:
            task_map.setdefault(task.id, task)
    for prop in project.props:
        _insert_prop(session, prop, "project", project.id, tenant)
        for task in prop.video_assets:
            task_map.setdefault(task.id, task)
    for order, frame in enumerate(project.frames):
        _insert_frame(session, frame, project.id, order, tenant)
    for task in task_map.values():
        session.merge(_video_task_record(task, tenant))


def _insert_series_children(session: Session, series: Series, tenant: dict) -> None:
    for character in series.characters:
        _insert_character(session, character, "series", series.id, tenant)
    for scene in series.scenes:
        _insert_scene(session, scene, "series", series.id, tenant)
    for prop in series.props:
        _insert_prop(session, prop, "series", series.id, tenant)


def _insert_character(session: Session, character: Character, owner_type: str, owner_id: str, tenant: dict) -> None:
    session.merge(
        CharacterRecord(
            id=character.id,
            owner_type=owner_type,
            owner_id=owner_id,
            name=character.name,
            description=character.description,
            age=character.age,
            gender=character.gender,
            clothing=character.clothing,
            visual_weight=character.visual_weight,
            full_body_image_url=character.full_body_image_url,
            full_body_prompt=character.full_body_prompt,
            full_body_asset_selected_id=(character.full_body_asset.selected_id if character.full_body_asset else None),
            three_view_image_url=character.three_view_image_url,
            three_view_prompt=character.three_view_prompt,
            three_view_asset_selected_id=(character.three_view_asset.selected_id if character.three_view_asset else None),
            headshot_image_url=character.headshot_image_url,
            headshot_prompt=character.headshot_prompt,
            headshot_asset_selected_id=(character.headshot_asset.selected_id if character.headshot_asset else None),
            video_prompt=character.video_prompt,
            image_url=character.image_url,
            avatar_url=character.avatar_url,
            is_consistent=character.is_consistent,
            full_body_updated_at=character.full_body_updated_at,
            three_view_updated_at=character.three_view_updated_at,
            headshot_updated_at=character.headshot_updated_at,
            base_character_id=character.base_character_id,
            voice_id=character.voice_id,
            voice_name=character.voice_name,
            voice_speed=character.voice_speed,
            voice_pitch=character.voice_pitch,
            voice_volume=character.voice_volume,
            locked=character.locked,
            status=character.status,
            is_deleted=False,
            deleted_at=None,
            deleted_by=None,
            **tenant,
            **_audit_time_kwargs(character),
        )
    )
    for group_name, image_asset in (
        ("full_body_asset", character.full_body_asset or ImageAsset()),
        ("three_view_asset", character.three_view_asset or ImageAsset()),
        ("headshot_asset", character.headshot_asset or ImageAsset()),
    ):
        for variant in image_asset.variants:
            session.merge(_image_variant_record("character", character.id, group_name, variant, tenant))

    for unit_type in CHARACTER_UNIT_TYPES:
        unit = getattr(character, unit_type, None) or AssetUnit()
        unit_id = f"{character.id}_{unit_type}"
        session.merge(
            CharacterAssetUnitRecord(
                id=unit_id,
                character_id=character.id,
                unit_type=unit_type,
                selected_image_id=unit.selected_image_id,
                selected_video_id=unit.selected_video_id,
                image_prompt=unit.image_prompt,
                video_prompt=unit.video_prompt,
                image_updated_at=unit.image_updated_at,
                video_updated_at=unit.video_updated_at,
                is_deleted=False,
                deleted_at=None,
                deleted_by=None,
                **tenant,
                **_audit_time_kwargs(character),
            )
        )
        for variant in unit.image_variants:
            session.merge(_image_variant_record("character_asset_unit", unit_id, "image_variants", variant, tenant))
        for variant in unit.video_variants:
            session.merge(_video_variant_record("character_asset_unit", unit_id, "video_variants", variant, tenant))


def _insert_scene(session: Session, scene: Scene, owner_type: str, owner_id: str, tenant: dict) -> None:
    session.merge(
        SceneRecord(
            id=scene.id,
            owner_type=owner_type,
            owner_id=owner_id,
            name=scene.name,
            description=scene.description,
            visual_weight=scene.visual_weight,
            time_of_day=scene.time_of_day,
            lighting_mood=scene.lighting_mood,
            image_url=scene.image_url,
            image_selected_id=(scene.image_asset.selected_id if scene.image_asset else None),
            video_prompt=scene.video_prompt,
            locked=scene.locked,
            status=scene.status,
            is_deleted=False,
            deleted_at=None,
            deleted_by=None,
            **tenant,
            **_audit_time_kwargs(scene),
        )
    )
    for variant in (scene.image_asset.variants if scene.image_asset else []):
        session.merge(_image_variant_record("scene", scene.id, "image_asset", variant, tenant))


def _insert_prop(session: Session, prop: Prop, owner_type: str, owner_id: str, tenant: dict) -> None:
    session.merge(
        PropRecord(
            id=prop.id,
            owner_type=owner_type,
            owner_id=owner_id,
            name=prop.name,
            description=prop.description,
            video_url=prop.video_url,
            audio_url=prop.audio_url,
            sfx_url=prop.sfx_url,
            bgm_url=prop.bgm_url,
            image_url=prop.image_url,
            image_selected_id=(prop.image_asset.selected_id if prop.image_asset else None),
            video_prompt=prop.video_prompt,
            locked=prop.locked,
            status=prop.status,
            is_deleted=False,
            deleted_at=None,
            deleted_by=None,
            **tenant,
            **_audit_time_kwargs(prop),
        )
    )
    for variant in (prop.image_asset.variants if prop.image_asset else []):
        session.merge(_image_variant_record("prop", prop.id, "image_asset", variant, tenant))


def _insert_frame(session: Session, frame: StoryboardFrame, project_id: str, order: int, tenant: dict) -> None:
    session.merge(
        StoryboardFrameRecord(
            id=frame.id,
            project_id=project_id,
            frame_order=order,
            scene_id=frame.scene_id,
            character_ids=frame.character_ids,
            prop_ids=frame.prop_ids,
            action_description=frame.action_description,
            facial_expression=frame.facial_expression,
            dialogue=frame.dialogue,
            speaker=frame.speaker,
            visual_atmosphere=frame.visual_atmosphere,
            character_acting=frame.character_acting,
            key_action_physics=frame.key_action_physics,
            shot_size=frame.shot_size,
            camera_angle=frame.camera_angle,
            camera_movement=frame.camera_movement,
            composition=frame.composition,
            atmosphere=frame.atmosphere,
            composition_data=frame.composition_data,
            image_prompt=frame.image_prompt,
            image_prompt_cn=frame.image_prompt_cn,
            image_prompt_en=frame.image_prompt_en,
            image_url=frame.image_url,
            image_selected_id=(frame.image_asset.selected_id if frame.image_asset else None),
            rendered_image_url=frame.rendered_image_url,
            rendered_image_selected_id=(frame.rendered_image_asset.selected_id if frame.rendered_image_asset else None),
            video_prompt=frame.video_prompt,
            video_url=frame.video_url,
            audio_url=frame.audio_url,
            audio_error=frame.audio_error,
            sfx_url=frame.sfx_url,
            selected_video_id=frame.selected_video_id,
            locked=frame.locked,
            status=frame.status,
            updated_at=frame.updated_at,
            created_at=frame.updated_at,
            is_deleted=False,
            deleted_at=None,
            deleted_by=None,
            **tenant,
        )
    )
    for variant in (frame.image_asset.variants if frame.image_asset else []):
        session.merge(_image_variant_record("storyboard_frame", frame.id, "image_asset", variant, tenant))
    for variant in (frame.rendered_image_asset.variants if frame.rendered_image_asset else []):
        session.merge(_image_variant_record("storyboard_frame", frame.id, "rendered_image_asset", variant, tenant))
