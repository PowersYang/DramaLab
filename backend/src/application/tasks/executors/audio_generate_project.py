from ....application.workflows import MediaWorkflow
from ....schemas.task_models import TaskJob


class AudioGenerateProjectExecutor:
    """执行整项目音频生成。

    这里先复用既有 workflow，把同步长流程托管给统一任务系统，
    后续再继续拆成对白/SFX/BGM 更细粒度的执行单元。
    """

    def __init__(self):
        self.media_workflow = MediaWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.media_workflow.generate_audio(payload["project_id"])
        audio_frame_count = len([frame for frame in (project.frames or []) if frame.audio_url])
        return {
            "project_id": project.id,
            "audio_frame_count": audio_frame_count,
        }
