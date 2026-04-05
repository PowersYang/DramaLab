"""
统一任务路由。

第一期先暴露视频任务的查询、取消与重试接口，
让前端可以不再依赖整份项目详情轮询任务状态。
"""

import time

from fastapi import APIRouter, Depends, HTTPException, Query

from ..application.tasks import TaskService
from ..application.tasks.service import TaskRetryLimitReached
from ..auth.constants import CAP_TASK_RUN
from ..auth.dependencies import RequestContext, get_request_context, require_capability
from ..common import signed_response
from ..common.log import get_logger


router = APIRouter(dependencies=[Depends(get_request_context)])
logger = get_logger(__name__)
task_service = TaskService()


@router.get("/tasks/{job_id}")
async def get_task(job_id: str, context: RequestContext = Depends(get_request_context)):
    job = task_service.get_job(job_id)
    if not job or job.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="任务不存在")
    return signed_response(job)


@router.get("/tasks")
async def list_tasks(
    project_id: str | None = None,
    series_id: str | None = None,
    statuses: str | None = Query(None, description="Comma separated task statuses"),
    limit: int = Query(200, ge=1, le=500, description="Maximum tasks to return"),
    context: RequestContext = Depends(get_request_context),
):
    started_at = time.perf_counter()
    # 任务中心页需要直接拉最近任务，不能再依赖“先枚举项目再逐个查询”。
    parsed_statuses = [item.strip() for item in statuses.split(",") if item.strip()] if statuses else None
    jobs = task_service.list_jobs(
        project_id=project_id,
        series_id=series_id,
        workspace_id=context.current_workspace_id,
        statuses=parsed_statuses,
        limit=limit,
    )
    logger.info(
        "任务接口：列出任务 project_id=%s series_id=%s 状态=%s 限制=%s 数量=%s 耗时ms=%.2f",
        project_id,
        series_id,
        parsed_statuses,
        limit,
        len(jobs),
        (time.perf_counter() - started_at) * 1000,
    )
    return signed_response(jobs)


@router.post("/tasks/{job_id}/cancel")
async def cancel_task(job_id: str, context: RequestContext = Depends(require_capability(CAP_TASK_RUN))):
    try:
        job = task_service.get_job(job_id)
        if not job or job.workspace_id != context.current_workspace_id:
            raise ValueError(f"任务 {job_id} 不存在")
        job = task_service.cancel_job(job_id)
        return signed_response(job)
    except ValueError as exc:
        logger.warning("任务接口：取消任务 失败 任务ID=%s 详情=%s", job_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/tasks/{job_id}/retry")
async def retry_task(job_id: str, context: RequestContext = Depends(require_capability(CAP_TASK_RUN))):
    try:
        job = task_service.get_job(job_id)
        if not job or job.workspace_id != context.current_workspace_id:
            raise ValueError(f"任务 {job_id} 不存在")
        job = task_service.retry_job(job_id)
        return signed_response(job)
    except TaskRetryLimitReached as exc:
        logger.warning("任务接口：重试任务 被拒绝 任务ID=%s 详情=%s", job_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        logger.warning("任务接口：重试任务 失败 任务ID=%s 详情=%s", job_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
