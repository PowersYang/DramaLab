"""统一资产任务路由：项目/系列一套生成入口。"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter, Depends, Header, HTTPException

from ..application.services import ProjectService, SeriesService
from ..application.services.art_direction_resolution_service import ArtDirectionResolutionService
from ..application.services.model_provider_service import ModelProviderService
from ..application.tasks import TaskService
from ..application.workflows import AssetWorkflow
from ..auth.constants import CAP_ASSET_EDIT
from ..auth.dependencies import RequestContext, get_request_context, require_capability
from ..common import signed_response
from ..common.log import get_logger
from ..repository import AssetPromptStateRepository
from ..schemas.requests import GenerateAssetJobRequest, GenerateMotionRefJobRequest
from ..schemas.task_models import TaskReceipt


router = APIRouter(dependencies=[Depends(get_request_context)])
logger = get_logger(__name__)
project_service = ProjectService()
series_service = SeriesService()
asset_workflow = AssetWorkflow()
task_service = TaskService()
model_provider_service = ModelProviderService()
art_direction_resolution_service = ArtDirectionResolutionService()
asset_prompt_state_repository = AssetPromptStateRepository()

# 中文注释：系列角色动作参考继续走专用队列，避免历史 worker 在共享 video 队列里抢到后执行分支错误。
SERIES_MOTION_REF_QUEUE = "video_series_motion"


@dataclass
class _ResolvedAssetOwner:
    project_id: str | None
    series_id: str | None
    owner_scope: str


@router.get("/asset-jobs/prompt-states")
async def list_asset_prompt_states(
    asset_id: str,
    asset_type: str,
    project_id: str | None = None,
    series_id: str | None = None,
    output_type: str | None = None,
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """按资产读取提示词状态，供弹窗默认回填。"""
    try:
        owner = _resolve_asset_owner(
            project_id=project_id,
            series_id=series_id,
            asset_id=asset_id,
            asset_type=asset_type,
            context=context,
        )
        owner_id = owner.series_id if owner.owner_scope == "series" else owner.project_id
        if not owner_id:
            raise ValueError("资产归属不存在")
        states = asset_prompt_state_repository.list_by_asset(
            owner_scope=owner.owner_scope,
            owner_id=owner_id,
            asset_type=asset_type,
            asset_id=asset_id,
            output_type=output_type,
        )
        return signed_response({"states": [item.model_dump(mode="json") for item in states]})
    except ValueError as exc:
        logger.warning("统一素材任务：读取提示词状态 失败 详情=%s", exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("统一素材任务：读取提示词状态 发生未预期异常")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/asset-jobs/generate", response_model=TaskReceipt)
async def generate_asset_job(
    request: GenerateAssetJobRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """统一资产生图入口，按资产真实归属自动路由到项目或系列。"""
    try:
        owner = _resolve_asset_owner(
            project_id=request.project_id,
            series_id=request.series_id,
            asset_id=request.asset_id,
            asset_type=request.asset_type,
            context=context,
        )
        logger.info(
            "统一素材任务：生成素材 资产ID=%s 资产类型=%s owner_scope=%s 项目ID=%s 系列ID=%s",
            request.asset_id,
            request.asset_type,
            owner.owner_scope,
            owner.project_id,
            owner.series_id,
        )

        if request.model_name:
            model_provider_service.require_model_enabled(request.model_name, "t2i")

        if owner.owner_scope == "series":
            if not owner.series_id:
                raise ValueError("系列不存在")
            asset_workflow.prepare_series_asset_generation(
                owner.series_id,
                request.asset_id,
                request.asset_type,
            )
            art_direction_context = art_direction_resolution_service.build_task_art_direction_context(
                series_id=owner.series_id,
                apply_style=request.apply_style,
            )
        else:
            if not owner.project_id:
                raise ValueError("项目不存在")
            asset_workflow.prepare_project_asset_generation(
                owner.project_id,
                request.asset_id,
                request.asset_type,
            )
            art_direction_context = art_direction_resolution_service.build_task_art_direction_context(
                project_id=owner.project_id,
                apply_style=request.apply_style,
            )

        payload = {
            "asset_id": request.asset_id,
            "asset_type": request.asset_type,
            "style_preset": request.style_preset,
            "reference_image_url": request.reference_image_url,
            "style_prompt": request.style_prompt,
            "generation_type": request.generation_type,
            "prompt": request.prompt,
            "apply_style": request.apply_style,
            "negative_prompt": request.negative_prompt,
            "batch_size": request.batch_size,
            "model_name": request.model_name,
            **art_direction_context,
        }
        if owner.project_id:
            payload["project_id"] = owner.project_id
        if owner.series_id and owner.owner_scope == "series":
            payload["series_id"] = owner.series_id
        _upsert_asset_image_prompt_state(owner=owner, request=request, context=context)

        receipt = task_service.create_job(
            task_type="asset.generate",
            payload=payload,
            project_id=owner.project_id,
            series_id=owner.series_id if owner.owner_scope == "series" else None,
            queue_name="image",
            resource_type=request.asset_type,
            resource_id=request.asset_id,
            timeout_seconds=1200,
            idempotency_key=idempotency_key,
            dedupe_scope=_build_asset_generate_dedupe_scope(owner, request),
        )
        logger.info(
            "统一素材任务：生成素材 已创建任务 任务ID=%s owner_scope=%s 项目ID=%s 系列ID=%s",
            receipt.job_id,
            owner.owner_scope,
            owner.project_id,
            owner.series_id,
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("统一素材任务：生成素材 失败 详情=%s", exc)
        status_code = 400 if "model" in str(exc).lower() else 404
        raise HTTPException(status_code=status_code, detail=str(exc))
    except Exception as exc:
        logger.exception("统一素材任务：生成素材 发生未预期异常")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/asset-jobs/generate_motion_ref", response_model=TaskReceipt)
async def generate_motion_ref_job(
    request: GenerateMotionRefJobRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """统一动作参考入口，按资产真实归属自动路由到项目或系列。"""
    try:
        owner = _resolve_asset_owner(
            project_id=request.project_id,
            series_id=request.series_id,
            asset_id=request.asset_id,
            asset_type=request.asset_type,
            context=context,
        )
        logger.info(
            "统一素材任务：生成动作参考 资产ID=%s 资产类型=%s owner_scope=%s 项目ID=%s 系列ID=%s",
            request.asset_id,
            request.asset_type,
            owner.owner_scope,
            owner.project_id,
            owner.series_id,
        )

        if owner.owner_scope == "series":
            if not owner.series_id:
                raise ValueError("系列不存在")
            asset_workflow.prepare_series_motion_ref_generation(
                series_id=owner.series_id,
                asset_id=request.asset_id,
                asset_type=request.asset_type,
            )
        else:
            if not owner.project_id:
                raise ValueError("项目不存在")
            asset_workflow.prepare_motion_ref_generation(
                script_id=owner.project_id,
                asset_id=request.asset_id,
                asset_type=request.asset_type,
            )

        payload = {
            "asset_id": request.asset_id,
            "asset_type": request.asset_type,
            "prompt": request.prompt,
            "audio_url": request.audio_url,
            "negative_prompt": request.negative_prompt,
            "duration": request.duration,
            "batch_size": request.batch_size,
        }
        if owner.project_id:
            payload["project_id"] = owner.project_id
        if owner.series_id and owner.owner_scope == "series":
            payload["series_id"] = owner.series_id
        _upsert_asset_motion_prompt_state(owner=owner, request=request, context=context)

        receipt = task_service.create_job(
            task_type="asset.motion_ref.generate",
            payload=payload,
            project_id=owner.project_id,
            series_id=owner.series_id if owner.owner_scope == "series" else None,
            queue_name=SERIES_MOTION_REF_QUEUE if owner.owner_scope == "series" else "video",
            resource_type=request.asset_type,
            resource_id=request.asset_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope=_build_motion_ref_dedupe_scope(owner, request),
        )
        logger.info(
            "统一素材任务：生成动作参考 已创建任务 任务ID=%s owner_scope=%s 项目ID=%s 系列ID=%s",
            receipt.job_id,
            owner.owner_scope,
            owner.project_id,
            owner.series_id,
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("统一素材任务：生成动作参考 失败 详情=%s", exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("统一素材任务：生成动作参考 发生未预期异常")
        raise HTTPException(status_code=500, detail=str(exc))


def _normalize_prompt_text(value: str | None) -> str:
    if not value:
        return ""
    return value.strip()


def _resolve_image_slot_type(asset_type: str, generation_type: str) -> str:
    # 中文注释：角色图片按分面持久化，场景/道具统一落到 default 槽位。
    if asset_type == "character" and generation_type in {"full_body", "three_view", "headshot"}:
        return generation_type
    return "default"


def _resolve_motion_slot_type(asset_type: str) -> str:
    # 中文注释：角色动态提示词按 full_body/head_shot 分槽，其它资产默认 default。
    if asset_type in {"full_body", "head_shot"}:
        return asset_type
    return "default"


def _upsert_asset_image_prompt_state(owner: _ResolvedAssetOwner, request: GenerateAssetJobRequest, context: RequestContext) -> None:
    positive_prompt = _normalize_prompt_text(request.prompt)
    negative_prompt = _normalize_prompt_text(request.negative_prompt)
    # 中文注释：空输入不主动覆盖历史记录，避免“只点生成”把用户手写提示词清空。
    if not positive_prompt and not negative_prompt:
        return
    owner_id = owner.series_id if owner.owner_scope == "series" else owner.project_id
    if not owner_id:
        return
    asset_prompt_state_repository.upsert_by_scope(
        owner_scope=owner.owner_scope,
        owner_id=owner_id,
        asset_type=request.asset_type,
        asset_id=request.asset_id,
        output_type="image",
        slot_type=_resolve_image_slot_type(request.asset_type, request.generation_type),
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        source="user_input",
        organization_id=context.current_organization_id,
        workspace_id=context.current_workspace_id,
        actor_id=context.user_id,
    )


def _upsert_asset_motion_prompt_state(owner: _ResolvedAssetOwner, request: GenerateMotionRefJobRequest, context: RequestContext) -> None:
    positive_prompt = _normalize_prompt_text(request.prompt)
    negative_prompt = _normalize_prompt_text(request.negative_prompt)
    if not positive_prompt and not negative_prompt:
        return
    owner_id = owner.series_id if owner.owner_scope == "series" else owner.project_id
    if not owner_id:
        return
    normalized_asset_type = "character" if request.asset_type in {"full_body", "head_shot"} else request.asset_type
    asset_prompt_state_repository.upsert_by_scope(
        owner_scope=owner.owner_scope,
        owner_id=owner_id,
        asset_type=normalized_asset_type,
        asset_id=request.asset_id,
        output_type="motion",
        slot_type=_resolve_motion_slot_type(request.asset_type),
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        source="user_input",
        organization_id=context.current_organization_id,
        workspace_id=context.current_workspace_id,
        actor_id=context.user_id,
    )


def _resolve_asset_owner(
    *,
    project_id: str | None,
    series_id: str | None,
    asset_id: str,
    asset_type: str,
    context: RequestContext,
) -> _ResolvedAssetOwner:
    """解析统一入口的目标归属：系列共享素材优先回写 series，其余回写 project。"""
    if not project_id and not series_id:
        raise ValueError("project_id 或 series_id 至少提供一个")

    project = project_service.get_project(project_id) if project_id else None
    if project_id and not project:
        raise ValueError("项目不存在")
    if project and project.workspace_id != context.current_workspace_id:
        raise ValueError("项目不存在")

    series = series_service.get_series(series_id) if series_id else None
    if series_id and not series:
        raise ValueError("系列不存在")
    if series and series.workspace_id != context.current_workspace_id:
        raise ValueError("系列不存在")

    if project and series and not project.series_id:
        raise ValueError("project_id 与 series_id 不匹配")

    if project and project.series_id:
        if series and project.series_id != series.id:
            raise ValueError("project_id 与 series_id 不匹配")
        if not series:
            series = series_service.get_series(project.series_id)
            if not series or series.workspace_id != context.current_workspace_id:
                raise ValueError("项目关联系列不存在")

    if project and series and _is_series_owned_asset(project=project, series=series, asset_id=asset_id, asset_type=asset_type):
        return _ResolvedAssetOwner(project_id=project.id, series_id=series.id, owner_scope="series")

    if project:
        return _ResolvedAssetOwner(project_id=project.id, series_id=series.id if series else None, owner_scope="project")

    if series:
        return _ResolvedAssetOwner(project_id=None, series_id=series.id, owner_scope="series")

    raise ValueError("项目或系列不存在")


def _is_series_owned_asset(*, project, series, asset_id: str, asset_type: str) -> bool:
    """判断系列项目里的目标素材是否应写回系列主档。"""
    if asset_type in {"character", "full_body", "head_shot"}:
        if any(link.character_id == asset_id for link in (project.series_character_links or [])):
            return True
        return any(item.id == asset_id for item in (series.characters or []))

    if asset_type == "scene":
        return any(item.id == asset_id for item in (series.scenes or []))

    if asset_type == "prop":
        return any(item.id == asset_id for item in (series.props or []))

    return False


def _build_asset_generate_dedupe_scope(owner: _ResolvedAssetOwner, request: GenerateAssetJobRequest) -> str:
    """统一构建素材生图去重 scope，确保项目/系列链路不会互相误复用。"""
    scope = f"series:{owner.series_id}" if owner.owner_scope == "series" else f"project:{owner.project_id}"
    return f"{scope}:{request.asset_type}:{request.asset_id}:{request.generation_type}"


def _build_motion_ref_dedupe_scope(owner: _ResolvedAssetOwner, request: GenerateMotionRefJobRequest) -> str:
    """统一构建动作参考去重 scope，系列与项目任务分开去重。"""
    scope = f"series:{owner.series_id}" if owner.owner_scope == "series" else f"project:{owner.project_id}"
    return f"motion_ref:{scope}:{request.asset_type}:{request.asset_id}"
