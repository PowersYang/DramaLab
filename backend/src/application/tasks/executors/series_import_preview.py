from ....application.services import SystemService
from ....schemas.task_models import TaskJob


class SeriesImportPreviewExecutor:
    """执行导入文件的分集预览分析。"""

    def __init__(self):
        self.system_service = SystemService()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        result = self.system_service.preview_import(
            payload["text"],
            payload.get("suggested_episodes", 3),
        )
        return {
            "filename": payload.get("filename"),
            "text_length": len(payload.get("text", "")),
            "text": payload.get("text", ""),
            **result,
        }
