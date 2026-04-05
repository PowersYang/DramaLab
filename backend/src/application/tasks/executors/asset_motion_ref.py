from ....application.workflows import AssetWorkflow
from ....common.log import get_logger
from ....schemas.task_models import TaskJob


logger = get_logger(__name__)


class AssetMotionRefExecutor:
    def __init__(self):
        self.asset_workflow = AssetWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        # 中文注释：执行路由必须以 task_jobs 主表字段为真源，而不是 payload_json；
        # payload 是业务参数，历史任务或补偿任务里可能缺字段/脏字段，不能再用它决定分支。
        # 这里仅在主表字段缺失时回退 payload，兼容历史脏数据的兜底读取。
        series_id = job.series_id or payload.get("series_id")
        project_id = job.project_id or payload.get("project_id")

        if series_id:
            series = self.asset_workflow.execute_series_motion_ref_generation(
                series_id=series_id,
                asset_id=payload["asset_id"],
                asset_type=payload["asset_type"],
                prompt=payload.get("prompt"),
                audio_url=payload.get("audio_url"),
                negative_prompt=payload.get("negative_prompt"),
                duration=payload.get("duration", 5),
                batch_size=payload.get("batch_size", 1),
            )
            return {
                "series_id": series.id,
                "asset_id": payload["asset_id"],
                "asset_type": payload["asset_type"],
            }

        if not project_id:
            raise ValueError("动作参考任务缺少 project_id / series_id，无法执行")

        project = self.asset_workflow.execute_motion_ref_generation(
            script_id=project_id,
            asset_id=payload["asset_id"],
            asset_type=payload["asset_type"],
            prompt=payload.get("prompt"),
            audio_url=payload.get("audio_url"),
            negative_prompt=payload.get("negative_prompt"),
            duration=payload.get("duration", 5),
            batch_size=payload.get("batch_size", 1),
        )
        return {
            "project_id": project.id,
            "asset_id": payload["asset_id"],
            "asset_type": payload["asset_type"],
        }
