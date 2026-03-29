"""
项目媒体路由：视频任务、语音音频、混音、合成与导出。
"""

import hashlib
import json

from fastapi import APIRouter, Depends, Header, HTTPException

from ..application.tasks import TaskService
from ..application.services import ProjectService, VideoTaskService
from ..application.services.model_provider_service import ModelProviderService
from ..auth.dependencies import get_request_context
from ..application.workflows import MediaWorkflow
from ..schemas.models import Script
from ..common import logger, signed_response
from ..schemas.requests import (
    BindVoiceRequest,
    CreateVideoTaskRequest,
    ExportRequest,
    GenerateLineAudioRequest,
    MergeVideosRequest,
    UpdateVoiceParamsRequest,
)
from ..schemas.task_models import TaskReceipt


router = APIRouter(dependencies=[Depends(get_request_context)])
video_task_service = VideoTaskService()
media_workflow = MediaWorkflow()
project_service = ProjectService()
task_service = TaskService()
model_provider_service = ModelProviderService()


def _timeline_scope_suffix(final_mix_timeline: dict | None) -> str:
    if not final_mix_timeline:
        return "default"
    digest = hashlib.sha256(json.dumps(final_mix_timeline, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    return digest


@router.post("/projects/{script_id}/generate_video", response_model=TaskReceipt)
async def generate_video(
    script_id: str,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """触发整项目视频生成。"""
    try:
        logger.info("MEDIA_API: generate_video script_id=%s", script_id)
        receipt = task_service.create_job(
            task_type="video.generate.project",
            payload={"project_id": script_id},
            project_id=script_id,
            queue_name="video",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope="project_video",
        )
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("MEDIA_API: generate_video unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/generate_audio", response_model=TaskReceipt)
async def generate_audio(
    script_id: str,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """触发整项目音频生成。

    这里改为只落统一任务，避免 API 线程同步阻塞在整片音频生成上。
    """
    try:
        logger.info("MEDIA_API: generate_audio script_id=%s", script_id)
        receipt = task_service.create_job(
            task_type="audio.generate.project",
            payload={"project_id": script_id},
            project_id=script_id,
            queue_name="audio",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope="project_audio",
        )
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("MEDIA_API: generate_audio unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/video_tasks", response_model=list[TaskReceipt])
async def create_video_task(
    script_id: str,
    request: CreateVideoTaskRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """创建一个或多个视频生成任务。

    第一期迁移后，这里只负责落业务占位记录和统一任务回执，
    真正执行交给独立 worker，不再依赖 API 进程内 BackgroundTasks。
    """
    try:
        logger.info(
            "MEDIA_API: create_video_task script_id=%s frame_id=%s batch_size=%s model=%s generation_mode=%s",
            script_id,
            request.frame_id,
            request.batch_size,
            request.model,
            request.generation_mode,
        )
        receipts = video_task_service.create_video_generation_jobs(
            script_id=script_id,
            image_url=request.image_url,
            prompt=request.prompt,
            frame_id=request.frame_id,
            duration=request.duration,
            seed=request.seed,
            resolution=request.resolution,
            generate_audio=request.generate_audio,
            audio_url=request.audio_url,
            prompt_extend=request.prompt_extend,
            negative_prompt=request.negative_prompt,
            batch_size=request.batch_size,
            model=request.model,
            shot_type=request.shot_type,
            generation_mode=request.generation_mode,
            reference_video_urls=request.reference_video_urls,
            mode=request.mode,
            sound=request.sound,
            cfg_scale=request.cfg_scale,
            vidu_audio=request.vidu_audio,
            movement_amplitude=request.movement_amplitude,
            idempotency_key=idempotency_key,
        )
        logger.info("MEDIA_API: create_video_task completed script_id=%s job_count=%s", script_id, len(receipts))
        return signed_response(receipts)
    except ValueError as exc:
        logger.warning("MEDIA_API: create_video_task invalid_request script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("MEDIA_API: create_video_task unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/characters/{char_id}/voice", response_model=Script)
async def bind_voice(script_id: str, char_id: str, request: BindVoiceRequest):
    """给角色绑定语音。"""
    try:
        logger.info("MEDIA_API: bind_voice script_id=%s char_id=%s voice_id=%s", script_id, char_id, request.voice_id)
        updated_script = video_task_service.bind_voice(script_id, char_id, request.voice_id, request.voice_name)
        return signed_response(updated_script)
    except Exception as exc:
        logger.exception("MEDIA_API: bind_voice unexpected_error script_id=%s char_id=%s", script_id, char_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.put(
    "/projects/{script_id}/characters/{char_id}/voice_params",
    response_model=Script,
)
async def update_voice_params(
    script_id: str,
    char_id: str,
    request: UpdateVoiceParamsRequest,
):
    """更新角色语音参数。"""
    try:
        logger.info("MEDIA_API: update_voice_params script_id=%s char_id=%s", script_id, char_id)
        updated_script = video_task_service.update_voice_params(script_id, char_id, request.speed, request.pitch, request.volume)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("MEDIA_API: update_voice_params failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/voices")
async def get_voices():
    """返回当前可用语音列表。"""
    logger.info("MEDIA_API: get_voices")
    return media_workflow.get_available_voices()


@router.post("/projects/{script_id}/frames/{frame_id}/audio", response_model=TaskReceipt)
async def generate_line_audio(
    script_id: str,
    frame_id: str,
    request: GenerateLineAudioRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """按指定参数为某一帧生成对白音频。"""
    try:
        logger.info("MEDIA_API: generate_line_audio script_id=%s frame_id=%s", script_id, frame_id)
        receipt = task_service.create_job(
            task_type="audio.generate.line",
            payload={
                "project_id": script_id,
                "frame_id": frame_id,
                "speed": request.speed,
                "pitch": request.pitch,
                "volume": request.volume,
            },
            project_id=script_id,
            queue_name="audio",
            resource_type="storyboard_frame",
            resource_id=frame_id,
            timeout_seconds=600,
            idempotency_key=idempotency_key,
            dedupe_scope=f"line_audio:{frame_id}",
        )
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("MEDIA_API: generate_line_audio unexpected_error script_id=%s frame_id=%s", script_id, frame_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/mix/generate_sfx", response_model=TaskReceipt)
async def generate_mix_sfx(
    script_id: str,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """为全片触发音效生成流程。"""
    try:
        logger.info("MEDIA_API: generate_mix_sfx script_id=%s", script_id)
        receipt = task_service.create_job(
            task_type="mix.generate.sfx",
            payload={"project_id": script_id},
            project_id=script_id,
            queue_name="audio",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope="mix_sfx",
        )
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("MEDIA_API: generate_mix_sfx unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/mix/generate_bgm", response_model=TaskReceipt)
async def generate_mix_bgm(
    script_id: str,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """触发背景音乐生成。"""
    try:
        logger.info("MEDIA_API: generate_mix_bgm script_id=%s", script_id)
        receipt = task_service.create_job(
            task_type="mix.generate.bgm",
            payload={"project_id": script_id},
            project_id=script_id,
            queue_name="audio",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope="mix_bgm",
        )
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("MEDIA_API: generate_mix_bgm unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/merge", response_model=TaskReceipt)
async def merge_videos(
    script_id: str,
    request: MergeVideosRequest | None = None,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """把所有已选中的分镜视频合成为最终成片。"""
    try:
        logger.info("MEDIA_API: merge_videos script_id=%s", script_id)
        receipt = task_service.create_job(
            task_type="media.merge",
            payload={
                "project_id": script_id,
                "final_mix_timeline": request.model_dump(mode="json").get("final_mix_timeline") if request else None,
            },
            project_id=script_id,
            queue_name="video",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope=f"media_merge:{_timeline_scope_suffix(request.model_dump(mode='json').get('final_mix_timeline') if request else None)}",
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.error("[MERGE ERROR] Validation failed: %s", exc)
        logger.exception("MEDIA_API: merge_videos validation_error script_id=%s", script_id)
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        logger.error("[MERGE ERROR] Runtime error: %s", exc)
        logger.exception("MEDIA_API: merge_videos runtime_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error("[MERGE ERROR] Unexpected error: %s", exc)
        logger.exception("MEDIA_API: merge_videos unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(exc)}")


@router.post("/projects/{script_id}/export", response_model=TaskReceipt)
async def export_project(
    script_id: str,
    request: ExportRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """
    导出项目视频。

    当前实现仍复用既有合成流程；
    `resolution`、`format`、`subtitles` 参数已预留，
    但尚未真正接入导出管线。
    """
    try:
        logger.info("MEDIA_API: export_project script_id=%s", script_id)
        script = project_service.get_project(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Project not found")
        receipt = task_service.create_job(
            task_type="project.export",
            payload={"project_id": script_id, "options": request.model_dump()},
            project_id=script_id,
            queue_name="export",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope=(
                f"project_export:{request.resolution}:{request.format}:{request.subtitles}:"
                f"{_timeline_scope_suffix(request.model_dump(mode='json').get('final_mix_timeline'))}"
            ),
        )
        return signed_response(receipt)
    except HTTPException:
        raise
    except ValueError as exc:
        logger.warning("MEDIA_API: export_project invalid_request script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        logger.exception("MEDIA_API: export_project runtime_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error("[EXPORT ERROR] %s", exc)
        logger.exception("MEDIA_API: export_project unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=f"Export failed: {str(exc)}")
