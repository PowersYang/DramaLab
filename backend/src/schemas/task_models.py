from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from ..utils.datetime import utc_now


class TaskStatus(str, Enum):
    QUEUED = "queued"
    CLAIMED = "claimed"
    RUNNING = "running"
    RETRY_WAITING = "retry_waiting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"


class TaskType(str, Enum):
    VIDEO_GENERATE_FRAME = "video.generate.frame"
    VIDEO_GENERATE_ASSET = "video.generate.asset"
    STORYBOARD_ANALYZE = "storyboard.analyze"
    STORYBOARD_RENDER = "storyboard.render"
    STORYBOARD_GENERATE_ALL = "storyboard.generate_all"
    ASSET_GENERATE = "asset.generate"
    ASSET_GENERATE_BATCH = "asset.generate_batch"
    ASSET_MOTION_REF_GENERATE = "asset.motion_ref.generate"
    SERIES_ASSET_GENERATE = "series.asset.generate"
    ART_DIRECTION_ANALYZE = "art_direction.analyze"


class TaskJob(BaseModel):
    id: str
    task_type: str
    status: TaskStatus = TaskStatus.QUEUED
    queue_name: str = "default"
    priority: int = 100
    organization_id: str | None = None
    workspace_id: str | None = None
    project_id: str | None = None
    series_id: str | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    payload_json: dict[str, Any] = Field(default_factory=dict)
    result_json: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None
    idempotency_key: str | None = None
    dedupe_key: str | None = None
    max_attempts: int = 2
    attempt_count: int = 0
    timeout_seconds: int = 1800
    scheduled_at: datetime = Field(default_factory=utc_now)
    claimed_at: datetime | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    finished_at: datetime | None = None
    cancel_requested_at: datetime | None = None
    worker_id: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class TaskAttempt(BaseModel):
    id: str
    job_id: str
    attempt_no: int
    organization_id: str | None = None
    workspace_id: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    worker_id: str | None = None
    provider_name: str | None = None
    provider_task_id: str | None = None
    started_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = None
    outcome: str = "running"
    error_code: str | None = None
    error_message: str | None = None
    metrics_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class TaskEvent(BaseModel):
    id: str
    job_id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    created_by: str | None = None
    updated_by: str | None = None
    event_type: str
    from_status: str | None = None
    to_status: str | None = None
    progress: int | None = None
    message: str | None = None
    event_payload_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class TaskReceipt(BaseModel):
    job_id: str
    task_type: str
    status: TaskStatus
    queue_name: str
    project_id: str | None = None
    series_id: str | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    source_video_task_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
