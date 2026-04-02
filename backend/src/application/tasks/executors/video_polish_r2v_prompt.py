from ....application.services import SystemService
from ....providers import ScriptProcessor
from ..metrics import attach_resource_metrics
from ....schemas.task_models import TaskJob


class VideoPolishR2VPromptExecutor:
    """执行图生视频提示词润色。"""

    def __init__(self):
        self.system_service = SystemService()
        self.text_provider = ScriptProcessor()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        custom_prompt = self.system_service.get_effective_prompt(
            payload.get("script_id", ""),
            "r2v_polish",
        ) if payload.get("script_id") else ""
        result = self.text_provider.polish_r2v_prompt(
            payload["draft_prompt"],
            payload.get("slots", []),
            payload.get("feedback", ""),
            custom_prompt,
        )
        response = {
            "prompt_cn": result.get("prompt_cn", ""),
            "prompt_en": result.get("prompt_en", ""),
            "script_id": payload.get("script_id"),
        }
        metrics = attach_resource_metrics(
            self.text_provider.get_last_metrics(),
            operation="video.polish_r2v_prompt",
            resource={"project_id": payload.get("script_id")},
            artifacts={"slot_count": len(payload.get("slots", []) or [])},
        )
        if metrics:
            response["__metrics__"] = metrics
        return response
