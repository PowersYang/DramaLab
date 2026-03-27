from ....application.services import SystemService
from ....schemas.task_models import TaskJob


class SeriesImportConfirmExecutor:
    """执行文件导入确认，正式创建系列与分集。"""

    def __init__(self):
        self.system_service = SystemService()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        result = self.system_service.create_series_from_import(
            payload["title"],
            payload["text"],
            payload.get("episodes", []),
            payload.get("description", ""),
        )
        series = result.get("series", {})
        episodes = result.get("episodes", [])
        return {
            "series_id": series.get("id"),
            "episode_count": len(episodes),
            "episodes": episodes,
            "series": series,
        }
