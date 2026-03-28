"""
统一任务路由。

第一期先暴露视频任务的查询、取消与重试接口，
让前端可以不再依赖整份项目详情轮询任务状态。
"""

from fastapi import APIRouter, HTTPException, Query

from ..application.tasks import TaskService
from ..common import signed_response
from ..common.log import get_logger


router = APIRouter()
logger = get_logger(__name__)
task_service = TaskService()


@router.get("/tasks/{job_id}")
async def get_task(job_id: str):
    job = task_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Task not found")
    return signed_response(job)


@router.get("/tasks")
async def list_tasks(
    project_id: str | None = None,
    series_id: str | None = None,
    statuses: str | None = Query(None, description="Comma separated task statuses"),
    limit: int = Query(200, ge=1, le=500, description="Maximum tasks to return"),
):
    # 任务中心页需要直接拉最近任务，不能再依赖“先枚举项目再逐个查询”。
    parsed_statuses = [item.strip() for item in statuses.split(",") if item.strip()] if statuses else None
    jobs = task_service.list_jobs(
        project_id=project_id,
        series_id=series_id,
        statuses=parsed_statuses,
        limit=limit,
    )
    return signed_response(jobs)


@router.post("/tasks/{job_id}/cancel")
async def cancel_task(job_id: str):
    try:
        job = task_service.cancel_job(job_id)
        return signed_response(job)
    except ValueError as exc:
        logger.warning("TASK_API: cancel_task failed job_id=%s detail=%s", job_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/tasks/{job_id}/retry")
async def retry_task(job_id: str):
    try:
        job = task_service.retry_job(job_id)
        return signed_response(job)
    except ValueError as exc:
        logger.warning("TASK_API: retry_task failed job_id=%s detail=%s", job_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
