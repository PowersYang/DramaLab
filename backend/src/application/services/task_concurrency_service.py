"""组织级任务并发控制服务。"""

from __future__ import annotations

import uuid

from ...common.log import get_logger
from ...repository import OrganizationRepository, TaskConcurrencyLimitRepository, TaskJobRepository
from ...schemas.models import TaskConcurrencyLimit, TaskConcurrencyLimitSummary, TaskConcurrencyTaskTypeOption
from ...schemas.task_models import TaskType
from ...utils.datetime import utc_now


logger = get_logger(__name__)
DEFAULT_NEW_ORGANIZATION_TASK_MAX_CONCURRENCY = 10


TASK_TYPE_LABELS: dict[str, str] = {
    TaskType.ART_DIRECTION_ANALYZE.value: "AI 风格分析",
    TaskType.ASSET_GENERATE.value: "资产生成",
    TaskType.ASSET_GENERATE_BATCH.value: "批量资产生成",
    TaskType.ASSET_MOTION_REF_GENERATE.value: "动作参考生成",
    TaskType.AUDIO_GENERATE_LINE.value: "台词配音生成",
    TaskType.AUDIO_GENERATE_PROJECT.value: "项目音频生成",
    TaskType.MEDIA_MERGE.value: "视频合成",
    TaskType.MIX_GENERATE_BGM.value: "背景音乐生成",
    TaskType.MIX_GENERATE_SFX.value: "音效生成",
    TaskType.PROJECT_EXPORT.value: "项目导出",
    TaskType.PROJECT_REPARSE.value: "项目重解析",
    TaskType.PROJECT_SYNC_DESCRIPTIONS.value: "描述同步",
    TaskType.SERIES_ASSET_GENERATE.value: "系列资产生成",
    TaskType.SERIES_ASSETS_EXTRACT.value: "系列资产识别",
    TaskType.SERIES_IMPORT_ASSETS.value: "系列资产导入",
    TaskType.SERIES_IMPORT_CONFIRM.value: "系列导入确认",
    TaskType.SERIES_IMPORT_PREVIEW.value: "系列导入预分析",
    TaskType.STORYBOARD_ANALYZE.value: "分镜分析",
    TaskType.STORYBOARD_GENERATE_ALL.value: "分镜生成",
    TaskType.STORYBOARD_REFINE_PROMPT.value: "分镜提示词润色",
    TaskType.STORYBOARD_RENDER.value: "分镜渲染",
    TaskType.VIDEO_GENERATE_ASSET.value: "资产视频生成",
    TaskType.VIDEO_GENERATE_FRAME.value: "分镜视频生成",
    TaskType.VIDEO_GENERATE_PROJECT.value: "项目视频生成",
    TaskType.VIDEO_POLISH_PROMPT.value: "视频提示词润色",
    TaskType.VIDEO_POLISH_R2V_PROMPT.value: "R2V 提示词润色",
}


class TaskConcurrencyService:
    """统一管理组织级任务并发限制，并为 worker 提供可执行配额。"""

    def __init__(self):
        self.organization_repository = OrganizationRepository()
        self.limit_repository = TaskConcurrencyLimitRepository()
        self.task_job_repository = TaskJobRepository()

    def list_task_type_options(self) -> list[TaskConcurrencyTaskTypeOption]:
        """返回平台允许配置并发限制的任务类型枚举。"""
        return [
            TaskConcurrencyTaskTypeOption(task_type=task_type, label=TASK_TYPE_LABELS.get(task_type, task_type))
            for task_type in self._supported_task_types()
        ]

    def list_limits(self) -> list[TaskConcurrencyLimitSummary]:
        """列出所有已配置的组织级任务并发限制。"""
        organizations = {item.id: item for item in self.organization_repository.list()}
        return [
            TaskConcurrencyLimitSummary(
                **item.model_dump(),
                organization_name=organizations.get(item.organization_id).name if organizations.get(item.organization_id) else None,
            )
            for item in self.limit_repository.list()
        ]

    def get_limit_map(self) -> dict[tuple[str, str], int]:
        """返回 worker 认领任务时使用的限额映射。"""
        return {
            (item.organization_id, item.task_type): item.max_concurrency
            for item in self.limit_repository.list()
        }

    def bootstrap_default_limits_for_organization(
        self,
        organization_id: str,
        *,
        max_concurrency: int = DEFAULT_NEW_ORGANIZATION_TASK_MAX_CONCURRENCY,
        actor_id: str | None = None,
    ) -> list[TaskConcurrencyLimitSummary]:
        """为新组织初始化全量任务默认并发，避免未配置时退回不限流。"""
        self._validate_organization_exists(organization_id)
        if max_concurrency < 0:
            raise ValueError("Task concurrency limit must be >= 0")
        organization = self.organization_repository.get(organization_id)
        created_limits = []
        for task_type in self._supported_task_types():
            item = self.limit_repository.upsert_by_scope(
                organization_id=organization_id,
                task_type=task_type,
                max_concurrency=max_concurrency,
                actor_id=actor_id,
                record_id=f"tcl_{uuid.uuid4().hex[:16]}",
            )
            created_limits.append(
                TaskConcurrencyLimitSummary(
                    **item.model_dump(),
                    organization_name=organization.name if organization else None,
                )
            )
        logger.info(
            "并发限制服务：初始化默认并发限制 组织ID=%s 任务类型数量=%s 最大并发=%s",
            organization_id,
            len(created_limits),
            max_concurrency,
        )
        return created_limits

    def upsert_limit(
        self,
        *,
        organization_id: str,
        task_type: str,
        max_concurrency: int,
        actor_id: str | None = None,
    ) -> TaskConcurrencyLimitSummary:
        """创建或更新组织级任务并发限制。"""
        self._validate_scope(organization_id, task_type)
        if max_concurrency < 0:
            raise ValueError("Task concurrency limit must be >= 0")
        item = self.limit_repository.upsert_by_scope(
            organization_id=organization_id,
            task_type=task_type,
            max_concurrency=max_concurrency,
            actor_id=actor_id,
            record_id=f"tcl_{uuid.uuid4().hex[:16]}",
        )
        organization = self.organization_repository.get(organization_id)
        logger.info(
            "并发限制服务：创建/更新并发限制 组织ID=%s 任务类型=%s 最大并发=%s",
            organization_id,
            task_type,
            max_concurrency,
        )
        return TaskConcurrencyLimitSummary(
            **item.model_dump(),
            organization_name=organization.name if organization else None,
        )

    def delete_limit(self, *, organization_id: str, task_type: str) -> dict[str, str]:
        """删除并发限制配置，删除后该组织该任务类型恢复为不限流。"""
        self._validate_scope(organization_id, task_type)
        self.limit_repository.delete_by_scope(organization_id, task_type)
        logger.info("并发限制服务：删除并发限制 组织ID=%s 任务类型=%s", organization_id, task_type)
        return {"status": "deleted", "organization_id": organization_id, "task_type": task_type}

    def _validate_scope(self, organization_id: str, task_type: str) -> None:
        """确保组织存在、任务类型可识别，避免无效配置悄悄落库。"""
        self._validate_organization_exists(organization_id)
        if task_type not in self._supported_task_types():
            raise ValueError(f"Unsupported task type: {task_type}")

    def _validate_organization_exists(self, organization_id: str) -> None:
        """集中校验组织是否存在，避免初始化默认限流时重复散落判空逻辑。"""
        if self.organization_repository.get(organization_id) is None:
            raise ValueError("Organization not found")

    def _supported_task_types(self) -> list[str]:
        """统一从任务枚举派生支持列表，避免任务类型新增后忘记补默认限流初始化。"""
        return sorted(task_type.value for task_type in TaskType)
