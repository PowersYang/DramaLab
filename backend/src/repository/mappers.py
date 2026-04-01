from collections import defaultdict
from datetime import datetime
import time
from typing import Iterable
import uuid

from sqlalchemy.orm import Session

from ..common.log import get_logger
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
    TaskAttemptRecord,
    TaskEventRecord,
    TaskJobRecord,
)
from ..schemas.models import (
    ArtDirection,
    AssetUnit,
    Character,
    ImageAsset,
    ImageVariant,
    ModelSettings,
    ProjectTimeline,
    PromptConfig,
    Prop,
    Scene,
    Script,
    Series,
    StoryboardFrame,
    VideoTask,
    VideoVariant,
)
from ..schemas.task_models import TaskAttempt, TaskEvent, TaskJob
from ..utils.datetime import utc_now


logger = get_logger(__name__)
CHARACTER_UNIT_TYPES = ("full_body", "three_views", "head_shot")
CHARACTER_LEGACY_ASSET_TO_UNIT = {
    "full_body_asset": "full_body",
    "three_view_asset": "three_views",
    "headshot_asset": "head_shot",
}


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


def _scoped(query, include_deleted: bool = False):
    return query if include_deleted else _active(query)


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
        # replace_graph 会先软删除旧图谱；这里如果不显式清空删除标记，
        # session.merge 命中同主键时会把旧的 is_deleted/deleted_at 原样保留下来，
        # 于是图片其实还在库里，但 hydrate 查询永远读不到。
        is_deleted=False,
        deleted_at=None,
        deleted_by=None,
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
        # 视频变体和图片变体共享同一套 replace_graph 软删路径；
        # 不在这里复位删除态，就会出现“视频生成成功过，但前端始终查不到”的假消失。
        is_deleted=False,
        deleted_at=None,
        deleted_by=None,
        **tenant,
    )


def _build_image_asset(selected_id: str | None, variants: list[ImageVariant]) -> ImageAsset:
    return ImageAsset(selected_id=selected_id, variants=sorted(variants, key=lambda item: item.created_at))


def _legacy_character_asset(character: Character, group_name: str) -> ImageAsset:
    """优先读取角色 legacy 容器，缺失时再回退到对应的新 AssetUnit。"""
    legacy_asset = getattr(character, group_name, None) or ImageAsset()
    if legacy_asset.variants:
        return legacy_asset

    unit_type = CHARACTER_LEGACY_ASSET_TO_UNIT[group_name]
    unit = getattr(character, unit_type, None) or AssetUnit()
    return _build_image_asset(unit.selected_image_id, list(unit.image_variants))


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


def _recover_soft_deleted_variant_groups(active_records, deleted_records):
    active_groups = {
        (record.owner_type, record.owner_id, record.variant_group)
        for record in active_records
    }
    recovered_records = list(active_records)
    grouped_deleted_records = defaultdict(list)
    for record in deleted_records:
        grouped_deleted_records[(record.owner_type, record.owner_id, record.variant_group)].append(record)

    for group_key, records in grouped_deleted_records.items():
        if group_key in active_groups:
            continue
        # 历史 bug 会把整组候选图/视频在 replace_graph 时误标成 deleted；
        # 当某个仍然存活的素材组已经没有任何 active 变体时，优先回退这组软删快照，
        # 避免“库里有记录、前端完全消失”的数据假丢失。
        recovered_records.extend(sorted(records, key=lambda item: (item.created_at, item.id)))
    return recovered_records


def _video_task_from_record(record: VideoTaskRecord) -> VideoTask:
    return VideoTask(
        id=record.id,
        project_id=record.project_id,
        frame_id=record.frame_id,
        asset_id=record.asset_id,
        source_job_id=record.source_job_id,
        provider_task_id=record.provider_task_id,
        image_url=record.image_url,
        prompt=record.prompt,
        status=record.status,
        video_url=record.video_url,
        failed_reason=record.failed_reason,
        completed_at=record.completed_at,
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
        source_job_id=task.source_job_id,
        provider_task_id=task.provider_task_id,
        image_url=task.image_url,
        prompt=task.prompt,
        status=task.status,
        video_url=task.video_url,
        failed_reason=task.failed_reason,
        completed_at=task.completed_at,
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


def _task_job_from_record(record: TaskJobRecord) -> TaskJob:
    return TaskJob(
        id=record.id,
        task_type=record.task_type,
        status=record.status,
        queue_name=record.queue_name,
        priority=record.priority,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        project_id=record.project_id,
        series_id=record.series_id,
        resource_type=record.resource_type,
        resource_id=record.resource_id,
        payload_json=record.payload_json or {},
        result_json=record.result_json,
        error_code=record.error_code,
        error_message=record.error_message,
        idempotency_key=record.idempotency_key,
        dedupe_key=record.dedupe_key,
        max_attempts=record.max_attempts,
        attempt_count=record.attempt_count,
        timeout_seconds=record.timeout_seconds,
        scheduled_at=record.scheduled_at,
        claimed_at=record.claimed_at,
        started_at=record.started_at,
        heartbeat_at=record.heartbeat_at,
        finished_at=record.finished_at,
        cancel_requested_at=record.cancel_requested_at,
        worker_id=record.worker_id,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _task_job_record(job: TaskJob) -> TaskJobRecord:
    return TaskJobRecord(
        id=job.id,
        task_type=job.task_type,
        status=job.status,
        queue_name=job.queue_name,
        priority=job.priority,
        organization_id=job.organization_id,
        workspace_id=job.workspace_id,
        project_id=job.project_id,
        series_id=job.series_id,
        resource_type=job.resource_type,
        resource_id=job.resource_id,
        payload_json=job.payload_json,
        result_json=job.result_json,
        error_code=job.error_code,
        error_message=job.error_message,
        idempotency_key=job.idempotency_key,
        dedupe_key=job.dedupe_key,
        max_attempts=job.max_attempts,
        attempt_count=job.attempt_count,
        timeout_seconds=job.timeout_seconds,
        scheduled_at=job.scheduled_at,
        claimed_at=job.claimed_at,
        started_at=job.started_at,
        heartbeat_at=job.heartbeat_at,
        finished_at=job.finished_at,
        cancel_requested_at=job.cancel_requested_at,
        worker_id=job.worker_id,
        created_by=job.created_by,
        updated_by=job.updated_by,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _task_attempt_from_record(record: TaskAttemptRecord) -> TaskAttempt:
    return TaskAttempt(
        id=record.id,
        job_id=record.job_id,
        attempt_no=record.attempt_no,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        created_by=record.created_by,
        updated_by=record.updated_by,
        worker_id=record.worker_id,
        provider_name=record.provider_name,
        provider_task_id=record.provider_task_id,
        started_at=record.started_at,
        ended_at=record.ended_at,
        outcome=record.outcome,
        error_code=record.error_code,
        error_message=record.error_message,
        metrics_json=record.metrics_json or {},
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _task_attempt_record(attempt: TaskAttempt) -> TaskAttemptRecord:
    return TaskAttemptRecord(
        id=attempt.id,
        job_id=attempt.job_id,
        attempt_no=attempt.attempt_no,
        organization_id=attempt.organization_id,
        workspace_id=attempt.workspace_id,
        created_by=attempt.created_by,
        updated_by=attempt.updated_by,
        worker_id=attempt.worker_id,
        provider_name=attempt.provider_name,
        provider_task_id=attempt.provider_task_id,
        started_at=attempt.started_at,
        ended_at=attempt.ended_at,
        outcome=attempt.outcome,
        error_code=attempt.error_code,
        error_message=attempt.error_message,
        metrics_json=attempt.metrics_json,
        created_at=attempt.created_at,
        updated_at=attempt.updated_at,
    )


def _task_event_from_record(record: TaskEventRecord) -> TaskEvent:
    return TaskEvent(
        id=record.id,
        job_id=record.job_id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        created_by=record.created_by,
        updated_by=record.updated_by,
        event_type=record.event_type,
        from_status=record.from_status,
        to_status=record.to_status,
        progress=record.progress,
        message=record.message,
        event_payload_json=record.event_payload_json or {},
        created_at=record.created_at,
        updated_at=record.created_at,
    )


def _task_event_record(event: TaskEvent) -> TaskEventRecord:
    return TaskEventRecord(
        id=event.id,
        job_id=event.job_id,
        organization_id=event.organization_id,
        workspace_id=event.workspace_id,
        created_by=event.created_by,
        updated_by=event.updated_by,
        event_type=event.event_type,
        from_status=event.from_status,
        to_status=event.to_status,
        progress=event.progress,
        message=event.message,
        event_payload_json=event.event_payload_json,
        created_at=event.created_at,
    )


def hydrate_project_map(session: Session, project_ids: set[str] | None = None, include_deleted: bool = False) -> dict[str, Script]:
    started_at = time.perf_counter()
    query = session.query(ProjectRecord)
    if not include_deleted:
        query = _active(query)
    if project_ids is not None:
        if not project_ids:
            return {}
        query = query.filter(ProjectRecord.id.in_(project_ids))
    project_records = query.order_by(ProjectRecord.created_at.asc(), ProjectRecord.id.asc()).all()
    project_query_duration_ms = (time.perf_counter() - started_at) * 1000
    if not project_records:
        logger.info(
            "REPO_HYDRATE: project_map projects=0 include_deleted=%s project_query_ms=%.2f total_ms=%.2f",
            include_deleted,
            project_query_duration_ms,
            (time.perf_counter() - started_at) * 1000,
        )
        return {}

    project_ids = [record.id for record in project_records]
    child_query_started_at = time.perf_counter()
    # 子资源默认全部走活跃态过滤，这样项目聚合读出来就是“当前视图”，不是历史快照全集。
    characters = _scoped(session.query(CharacterRecord), include_deleted).filter(
        CharacterRecord.owner_type == "project",
        CharacterRecord.owner_id.in_(project_ids),
    ).order_by(CharacterRecord.owner_id.asc(), CharacterRecord.created_at.asc(), CharacterRecord.id.asc()).all()
    scenes = _scoped(session.query(SceneRecord), include_deleted).filter(
        SceneRecord.owner_type == "project",
        SceneRecord.owner_id.in_(project_ids),
    ).order_by(SceneRecord.owner_id.asc(), SceneRecord.created_at.asc(), SceneRecord.id.asc()).all()
    props = _scoped(session.query(PropRecord), include_deleted).filter(
        PropRecord.owner_type == "project",
        PropRecord.owner_id.in_(project_ids),
    ).order_by(PropRecord.owner_id.asc(), PropRecord.created_at.asc(), PropRecord.id.asc()).all()
    frames = _scoped(session.query(StoryboardFrameRecord), include_deleted).filter(StoryboardFrameRecord.project_id.in_(project_ids)).order_by(StoryboardFrameRecord.project_id, StoryboardFrameRecord.frame_order).all()
    tasks = _scoped(session.query(VideoTaskRecord), include_deleted).filter(
        VideoTaskRecord.project_id.in_(project_ids)
    ).order_by(VideoTaskRecord.project_id.asc(), VideoTaskRecord.created_at.asc(), VideoTaskRecord.id.asc()).all()

    character_ids = [record.id for record in characters]
    scene_ids = [record.id for record in scenes]
    prop_ids = [record.id for record in props]
    frame_ids = [record.id for record in frames]
    unit_records = _scoped(session.query(CharacterAssetUnitRecord), include_deleted).filter(
        CharacterAssetUnitRecord.character_id.in_(character_ids)
    ).order_by(
        CharacterAssetUnitRecord.character_id.asc(),
        CharacterAssetUnitRecord.image_updated_at.asc(),
        CharacterAssetUnitRecord.id.asc(),
    ).all() if character_ids else []
    unit_ids = [record.id for record in unit_records]

    image_variant_filter = (
        ((ImageVariantRecord.owner_type == "character") & (ImageVariantRecord.owner_id.in_(character_ids))) |
        ((ImageVariantRecord.owner_type == "character_asset_unit") & (ImageVariantRecord.owner_id.in_(unit_ids))) |
        ((ImageVariantRecord.owner_type == "scene") & (ImageVariantRecord.owner_id.in_(scene_ids))) |
        ((ImageVariantRecord.owner_type == "prop") & (ImageVariantRecord.owner_id.in_(prop_ids))) |
        ((ImageVariantRecord.owner_type == "storyboard_frame") & (ImageVariantRecord.owner_id.in_(frame_ids)))
    )
    image_variant_records = _scoped(session.query(ImageVariantRecord), include_deleted).filter(
        image_variant_filter
    ).order_by(ImageVariantRecord.created_at.asc(), ImageVariantRecord.id.asc()).all() if (character_ids or unit_ids or scene_ids or prop_ids or frame_ids) else []
    if not include_deleted and (character_ids or unit_ids or scene_ids or prop_ids or frame_ids):
        deleted_image_variant_records = session.query(ImageVariantRecord).filter(
            image_variant_filter,
            ImageVariantRecord.is_deleted.is_(True),
        ).order_by(ImageVariantRecord.created_at.asc(), ImageVariantRecord.id.asc()).all()
        image_variant_records = _recover_soft_deleted_variant_groups(image_variant_records, deleted_image_variant_records)

    video_variant_records = _scoped(session.query(VideoVariantRecord), include_deleted).filter(
        (VideoVariantRecord.owner_type == "character_asset_unit") & (VideoVariantRecord.owner_id.in_(unit_ids))
    ).order_by(VideoVariantRecord.created_at.asc(), VideoVariantRecord.id.asc()).all() if unit_ids else []
    if not include_deleted and unit_ids:
        deleted_video_variant_records = session.query(VideoVariantRecord).filter(
            (VideoVariantRecord.owner_type == "character_asset_unit") & (VideoVariantRecord.owner_id.in_(unit_ids)),
            VideoVariantRecord.is_deleted.is_(True),
        ).order_by(VideoVariantRecord.created_at.asc(), VideoVariantRecord.id.asc()).all()
        video_variant_records = _recover_soft_deleted_variant_groups(video_variant_records, deleted_video_variant_records)

    image_groups = _group_image_variants(image_variant_records)
    video_groups = _group_video_variants(video_variant_records)
    child_query_duration_ms = (time.perf_counter() - child_query_started_at) * 1000

    materialize_started_at = time.perf_counter()
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
        full_body_unit = units_by_character.get(record.id, {}).get("full_body", AssetUnit())
        three_views_unit = units_by_character.get(record.id, {}).get("three_views", AssetUnit())
        head_shot_unit = units_by_character.get(record.id, {}).get("head_shot", AssetUnit())

        full_body_variants = image_groups.get(("character", record.id, "full_body_asset"), [])
        if not full_body_variants and full_body_unit.image_variants:
            full_body_variants = [variant.model_copy(deep=True) for variant in full_body_unit.image_variants]

        three_view_variants = image_groups.get(("character", record.id, "three_view_asset"), [])
        if not three_view_variants and three_views_unit.image_variants:
            three_view_variants = [variant.model_copy(deep=True) for variant in three_views_unit.image_variants]

        headshot_variants = image_groups.get(("character", record.id, "headshot_asset"), [])
        if not headshot_variants and head_shot_unit.image_variants:
            headshot_variants = [variant.model_copy(deep=True) for variant in head_shot_unit.image_variants]

        character = Character(
            id=record.id,
            created_at=record.created_at,
            name=record.name,
            description=record.description,
            age=record.age,
            gender=record.gender,
            clothing=record.clothing,
            visual_weight=record.visual_weight,
            full_body=full_body_unit,
            three_views=three_views_unit,
            head_shot=head_shot_unit,
            full_body_image_url=record.full_body_image_url,
            full_body_prompt=record.full_body_prompt,
            full_body_asset=_build_image_asset(record.full_body_asset_selected_id or full_body_unit.selected_image_id, full_body_variants),
            three_view_image_url=record.three_view_image_url,
            three_view_prompt=record.three_view_prompt,
            three_view_asset=_build_image_asset(record.three_view_asset_selected_id or three_views_unit.selected_image_id, three_view_variants),
            headshot_image_url=record.headshot_image_url,
            headshot_prompt=record.headshot_prompt,
            headshot_asset=_build_image_asset(record.headshot_asset_selected_id or head_shot_unit.selected_image_id, headshot_variants),
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
            created_at=record.created_at,
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
            created_at=record.created_at,
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
            frame_order=record.frame_order,
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
            timeline=ProjectTimeline(**record.timeline_json) if record.timeline_json else None,
            series_id=record.series_id,
            episode_number=record.episode_number,
            organization_id=record.organization_id,
            workspace_id=record.workspace_id,
            created_by=record.created_by,
            updated_by=record.updated_by,
            version=record.version,
            status=record.status or "pending",
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
    materialize_duration_ms = (time.perf_counter() - materialize_started_at) * 1000
    logger.info(
        "REPO_HYDRATE: project_map projects=%s characters=%s scenes=%s props=%s frames=%s tasks=%s image_variants=%s video_variants=%s project_query_ms=%.2f child_query_ms=%.2f materialize_ms=%.2f total_ms=%.2f",
        len(project_records),
        len(characters),
        len(scenes),
        len(props),
        len(frames),
        len(tasks),
        len(image_variant_records),
        len(video_variant_records),
        project_query_duration_ms,
        child_query_duration_ms,
        materialize_duration_ms,
        (time.perf_counter() - started_at) * 1000,
    )
    return result


def hydrate_series_map(session: Session, series_ids: set[str] | None = None, include_deleted: bool = False) -> dict[str, Series]:
    started_at = time.perf_counter()
    query = session.query(SeriesRecord)
    if not include_deleted:
        query = _active(query)
    if series_ids is not None:
        if not series_ids:
            return {}
        query = query.filter(SeriesRecord.id.in_(series_ids))
    series_records = query.all()
    series_query_duration_ms = (time.perf_counter() - started_at) * 1000
    if not series_records:
        logger.info(
            "REPO_HYDRATE: series_map series=0 include_deleted=%s series_query_ms=%.2f total_ms=%.2f",
            include_deleted,
            series_query_duration_ms,
            (time.perf_counter() - started_at) * 1000,
        )
        return {}

    series_ids = [record.id for record in series_records]
    child_query_started_at = time.perf_counter()
    characters = _scoped(session.query(CharacterRecord), include_deleted).filter(CharacterRecord.owner_type == "series", CharacterRecord.owner_id.in_(series_ids)).all()
    scenes = _scoped(session.query(SceneRecord), include_deleted).filter(SceneRecord.owner_type == "series", SceneRecord.owner_id.in_(series_ids)).all()
    props = _scoped(session.query(PropRecord), include_deleted).filter(PropRecord.owner_type == "series", PropRecord.owner_id.in_(series_ids)).all()
    unit_records = _scoped(session.query(CharacterAssetUnitRecord), include_deleted).filter(CharacterAssetUnitRecord.character_id.in_([record.id for record in characters])).all() if characters else []
    unit_ids = [record.id for record in unit_records]
    image_variant_filter = (
        ((ImageVariantRecord.owner_type == "character") & (ImageVariantRecord.owner_id.in_([record.id for record in characters]))) |
        ((ImageVariantRecord.owner_type == "character_asset_unit") & (ImageVariantRecord.owner_id.in_(unit_ids))) |
        ((ImageVariantRecord.owner_type == "scene") & (ImageVariantRecord.owner_id.in_([record.id for record in scenes]))) |
        ((ImageVariantRecord.owner_type == "prop") & (ImageVariantRecord.owner_id.in_([record.id for record in props])))
    )
    image_variant_records = _scoped(session.query(ImageVariantRecord), include_deleted).filter(
        image_variant_filter
    ).order_by(ImageVariantRecord.created_at.asc(), ImageVariantRecord.id.asc()).all() if (characters or scenes or props or unit_ids) else []
    if not include_deleted and (characters or scenes or props or unit_ids):
        deleted_image_variant_records = session.query(ImageVariantRecord).filter(
            image_variant_filter,
            ImageVariantRecord.is_deleted.is_(True),
        ).order_by(ImageVariantRecord.created_at.asc(), ImageVariantRecord.id.asc()).all()
        image_variant_records = _recover_soft_deleted_variant_groups(image_variant_records, deleted_image_variant_records)
    video_variant_records = _scoped(session.query(VideoVariantRecord), include_deleted).filter(
        (VideoVariantRecord.owner_type == "character_asset_unit") & (VideoVariantRecord.owner_id.in_(unit_ids))
    ).order_by(VideoVariantRecord.created_at.asc(), VideoVariantRecord.id.asc()).all() if unit_ids else []
    if not include_deleted and unit_ids:
        deleted_video_variant_records = session.query(VideoVariantRecord).filter(
            (VideoVariantRecord.owner_type == "character_asset_unit") & (VideoVariantRecord.owner_id.in_(unit_ids)),
            VideoVariantRecord.is_deleted.is_(True),
        ).order_by(VideoVariantRecord.created_at.asc(), VideoVariantRecord.id.asc()).all()
        video_variant_records = _recover_soft_deleted_variant_groups(video_variant_records, deleted_video_variant_records)

    image_groups = _group_image_variants(image_variant_records)
    video_groups = _group_video_variants(video_variant_records)
    child_query_duration_ms = (time.perf_counter() - child_query_started_at) * 1000
    materialize_started_at = time.perf_counter()
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
        full_body_unit = units_by_character.get(record.id, {}).get("full_body", AssetUnit())
        three_views_unit = units_by_character.get(record.id, {}).get("three_views", AssetUnit())
        head_shot_unit = units_by_character.get(record.id, {}).get("head_shot", AssetUnit())

        full_body_variants = image_groups.get(("character", record.id, "full_body_asset"), [])
        if not full_body_variants and full_body_unit.image_variants:
            full_body_variants = [variant.model_copy(deep=True) for variant in full_body_unit.image_variants]

        three_view_variants = image_groups.get(("character", record.id, "three_view_asset"), [])
        if not three_view_variants and three_views_unit.image_variants:
            three_view_variants = [variant.model_copy(deep=True) for variant in three_views_unit.image_variants]

        headshot_variants = image_groups.get(("character", record.id, "headshot_asset"), [])
        if not headshot_variants and head_shot_unit.image_variants:
            headshot_variants = [variant.model_copy(deep=True) for variant in head_shot_unit.image_variants]

        chars_by_series[record.owner_id].append(
            Character(
                id=record.id,
                name=record.name,
                description=record.description,
                age=record.age,
                gender=record.gender,
                clothing=record.clothing,
                visual_weight=record.visual_weight,
                full_body=full_body_unit,
                three_views=three_views_unit,
                head_shot=head_shot_unit,
                full_body_image_url=record.full_body_image_url,
                full_body_prompt=record.full_body_prompt,
                full_body_asset=_build_image_asset(record.full_body_asset_selected_id or full_body_unit.selected_image_id, full_body_variants),
                three_view_image_url=record.three_view_image_url,
                three_view_prompt=record.three_view_prompt,
                three_view_asset=_build_image_asset(record.three_view_asset_selected_id or three_views_unit.selected_image_id, three_view_variants),
                headshot_image_url=record.headshot_image_url,
                headshot_prompt=record.headshot_prompt,
                headshot_asset=_build_image_asset(record.headshot_asset_selected_id or head_shot_unit.selected_image_id, headshot_variants),
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
            status=record.status or "active",
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
    materialize_duration_ms = (time.perf_counter() - materialize_started_at) * 1000
    logger.info(
        "REPO_HYDRATE: series_map series=%s characters=%s scenes=%s props=%s projects=%s image_variants=%s video_variants=%s series_query_ms=%.2f child_query_ms=%.2f materialize_ms=%.2f total_ms=%.2f",
        len(series_records),
        len(characters),
        len(scenes),
        len(props),
        len(projects),
        len(image_variant_records),
        len(video_variant_records),
        series_query_duration_ms,
        child_query_duration_ms,
        materialize_duration_ms,
        (time.perf_counter() - started_at) * 1000,
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
                timeline_json=project.timeline.model_dump(mode="json") if project.timeline else None,
                version=project.version,
                status=project.status,
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
                status=series.status,
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
    # 先把角色主记录刷入数据库，避免 PostgreSQL 在写角色素材单元时触发外键约束失败。
    session.flush()

    persisted_image_variant_ids: set[str] = set()

    for group_name in ("full_body_asset", "three_view_asset", "headshot_asset"):
        image_asset = _legacy_character_asset(character, group_name)
        unit_type = CHARACTER_LEGACY_ASSET_TO_UNIT[group_name]
        unit = getattr(character, unit_type, None) or AssetUnit()
        # 新结构和 legacy 容器会在运行时共享同一批 ImageVariant；如果两边都入库，
        # PostgreSQL 会因为 image_variants.id 是全局主键而产生重复键冲突。
        # 因此当对应 AssetUnit 已经承载图片时，只持久化 unit 这一份记录。
        if unit.image_variants:
            continue
        for variant in image_asset.variants:
            if variant.id and variant.id in persisted_image_variant_ids:
                continue
            session.merge(_image_variant_record("character", character.id, group_name, variant, tenant))
            if variant.id:
                persisted_image_variant_ids.add(variant.id)

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
            if variant.id and variant.id in persisted_image_variant_ids:
                continue
            session.merge(_image_variant_record("character_asset_unit", unit_id, "image_variants", variant, tenant))
            if variant.id:
                persisted_image_variant_ids.add(variant.id)
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
