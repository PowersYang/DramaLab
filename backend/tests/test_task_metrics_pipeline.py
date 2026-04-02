import unittest


class _StubMediaWorkflow:
    def __init__(self):
        self.calls = []

    def process_video_task(self, project_id: str, video_task_id: str) -> None:
        self.calls.append((project_id, video_task_id))


class _StubVideoTaskRepository:
    def __init__(self, task):
        self.task = task

    def get(self, project_id: str, video_task_id: str):
        return self.task


class _StubProject:
    def __init__(self, project_id: str):
        self.id = project_id
        self.characters = [object(), object()]
        self.scenes = [object()]
        self.props = [object(), object(), object()]


class _StubProjectService:
    def __init__(self):
        from src.providers.text.script_processor import ScriptProcessor

        self.text_provider = ScriptProcessor()
        self.text_provider.llm._last_response_metrics = {
            "version": "v1",
            "provider": {"name": "OPENAI", "model": "gpt-4.1"},
            "usage": {"input_tokens": 120, "output_tokens": 80, "total_tokens": 200},
            "cost": {"amount": 0.01, "currency": "USD", "pricing_basis": "provider_usage"},
            "supplier_reference": {"request_id": "req_llm_1", "task_id": None},
        }

    def reparse_project(self, project_id: str, text: str):
        return _StubProject(project_id)


class _StubStoryboardProject:
    def __init__(self, project_id: str):
        self.id = project_id


class _StubStoryboardWorkflow:
    def __init__(self):
        from types import SimpleNamespace

        self.image_provider = SimpleNamespace(
            last_generation_metrics={
                "version": "v1",
                "provider": {"name": "DASHSCOPE", "model": "wan2.6-image"},
                "usage": {"images": 1, "request_count": 1},
                "cost": {"amount": None, "currency": "UNKNOWN", "pricing_basis": "provider_usage"},
                "supplier_reference": {"task_id": "img-task-1", "request_id": "img-req-1"},
            }
        )

    def render_frame(self, project_id: str, frame_id: str, composition_data, prompt: str, batch_size: int = 1):
        return _StubStoryboardProject(project_id)


class TaskMetricsPipelineTest(unittest.TestCase):
    def test_video_generate_executor_emits_standardized_metrics(self):
        from src.application.tasks.executors.video_generate import VideoGenerateExecutor
        from src.schemas.models import VideoTask
        from src.schemas.task_models import TaskJob
        from src.utils.datetime import utc_now

        now = utc_now()
        task = VideoTask(
            id="video_task_1",
            project_id="project_1",
            frame_id="frame_1",
            provider_task_id="supplier-task-1",
            image_url="https://example.com/image.png",
            prompt="make it move",
            status="completed",
            video_url="https://example.com/video.mp4",
            duration=5,
            resolution="720p",
            model="wan2.6-i2v",
            generation_mode="i2v",
            created_at=now,
        )
        job = TaskJob(
            id="job_video_metrics_1",
            task_type="video.generate",
            queue_name="video",
            payload_json={"project_id": "project_1", "video_task_id": "video_task_1"},
            created_at=now,
            updated_at=now,
        )

        executor = VideoGenerateExecutor()
        executor.media_workflow = _StubMediaWorkflow()
        executor.video_task_repository = _StubVideoTaskRepository(task)

        result = executor.execute(job)

        self.assertIn("__metrics__", result)
        self.assertEqual(result["__metrics__"]["version"], "v1")
        self.assertEqual(result["__metrics__"]["provider"]["name"], "WANX")
        self.assertEqual(result["__metrics__"]["supplier_reference"]["task_id"], "supplier-task-1")
        self.assertEqual(result["video_task_id"], "video_task_1")

    def test_project_reparse_executor_emits_llm_usage_metrics(self):
        from src.application.tasks.executors.project_reparse import ProjectReparseExecutor
        from src.schemas.task_models import TaskJob
        from src.utils.datetime import utc_now

        now = utc_now()
        job = TaskJob(
            id="job_project_reparse_metrics_1",
            task_type="project.reparse",
            queue_name="llm",
            payload_json={"project_id": "project_llm_1", "text": "some story text"},
            created_at=now,
            updated_at=now,
        )

        executor = ProjectReparseExecutor()
        executor.project_service = _StubProjectService()

        result = executor.execute(job)

        self.assertIn("__metrics__", result)
        self.assertEqual(result["__metrics__"]["provider"]["name"], "OPENAI")
        self.assertEqual(result["__metrics__"]["usage"]["total_tokens"], 200)
        self.assertEqual(result["__metrics__"]["resource"]["project_id"], "project_llm_1")
        self.assertEqual(result["__metrics__"]["artifacts"]["character_count"], 2)

    def test_storyboard_render_executor_emits_image_provider_metrics(self):
        from src.application.tasks.executors.storyboard_render import StoryboardRenderExecutor
        from src.schemas.task_models import TaskJob
        from src.utils.datetime import utc_now

        now = utc_now()
        job = TaskJob(
            id="job_storyboard_render_metrics_1",
            task_type="storyboard.render",
            queue_name="image",
            payload_json={"project_id": "project_img_1", "frame_id": "frame_1", "prompt": "draw it", "batch_size": 2},
            created_at=now,
            updated_at=now,
        )

        executor = StoryboardRenderExecutor()
        executor.storyboard_workflow = _StubStoryboardWorkflow()

        result = executor.execute(job)

        self.assertIn("__metrics__", result)
        self.assertEqual(result["__metrics__"]["provider"]["name"], "DASHSCOPE")
        self.assertEqual(result["__metrics__"]["supplier_reference"]["task_id"], "img-task-1")
        self.assertEqual(result["__metrics__"]["resource"]["frame_id"], "frame_1")
        self.assertEqual(result["__metrics__"]["artifacts"]["batch_size"], 2)


if __name__ == "__main__":
    unittest.main()
