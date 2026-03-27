from ....application.services import SystemService
from ....providers import ScriptProcessor
from ....schemas.task_models import TaskJob


class VideoPolishPromptExecutor:
    """执行视频提示词润色。"""

    def __init__(self):
        self.system_service = SystemService()
        self.text_provider = ScriptProcessor()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        custom_prompt = self.system_service.get_effective_prompt(
            payload.get("script_id", ""),
            "video_polish",
        ) if payload.get("script_id") else ""
        result = self.text_provider.polish_video_prompt(
            payload["draft_prompt"],
            payload.get("feedback", ""),
            custom_prompt,
        )
        return {
            "prompt_cn": result.get("prompt_cn", ""),
            "prompt_en": result.get("prompt_en", ""),
            "script_id": payload.get("script_id"),
        }
