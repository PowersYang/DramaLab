from ....application.workflows.series_workflow import SeriesWorkflow
from ....schemas.task_models import TaskJob


class SeriesImportAssetsExecutor:
    """执行跨系列素材导入。"""

    def __init__(self):
        self.series_workflow = SeriesWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        series, imported_ids, skipped_ids = self.series_workflow.import_assets_from_series(
            payload["series_id"],
            payload["source_series_id"],
            payload.get("asset_ids", []),
        )
        return {
            "series_id": series.id,
            "imported_ids": imported_ids,
            "skipped_ids": skipped_ids,
            "imported_count": len(imported_ids),
            "skipped_count": len(skipped_ids),
        }
