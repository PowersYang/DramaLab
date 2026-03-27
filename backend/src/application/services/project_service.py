"""
项目应用服务。

这里负责项目级 CRUD 与轻量配置更新，
替代过去以 pipeline 为中心的项目写入路径。
"""

from ...repository import ProjectRepository, SeriesRepository
from ...providers import ScriptProcessor
from ...schemas.models import ModelSettings, PromptConfig
from ...utils.datetime import utc_now


class ProjectService:
    """负责项目聚合相关应用操作。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.text_provider = ScriptProcessor()

    def create_project(self, title: str, text: str, skip_analysis: bool = False):
        """根据原始文本创建并持久化项目。"""
        if skip_analysis:
            project = self.text_provider.create_draft_script(title, text)
        else:
            project = self.text_provider.parse_novel(title, text)
        self.project_repository.create(project)
        return project

    def reparse_project(self, script_id: str, text: str):
        """重新解析剧本，同时保留稳定元数据字段。"""
        existing = self.get_project(script_id)
        if not existing:
            raise ValueError("Script not found")

        reparsed = self.text_provider.parse_novel(existing.title, text)
        # 重新解析时只替换结构化内容，保留标识、租户占位字段和用户已编辑配置。
        reparsed.id = existing.id
        reparsed.created_at = existing.created_at
        reparsed.updated_at = utc_now()
        reparsed.art_direction = existing.art_direction
        reparsed.model_settings = existing.model_settings
        reparsed.style_preset = existing.style_preset
        reparsed.style_prompt = existing.style_prompt
        reparsed.merged_video_url = existing.merged_video_url
        reparsed.series_id = existing.series_id
        reparsed.episode_number = existing.episode_number
        reparsed.organization_id = existing.organization_id
        reparsed.workspace_id = existing.workspace_id
        reparsed.created_by = existing.created_by
        reparsed.updated_by = existing.updated_by

        self.project_repository.replace_graph(reparsed)
        return reparsed

    def list_projects(self):
        """返回所有已持久化项目。"""
        return self.project_repository.list()

    def get_project(self, script_id: str):
        """加载单个项目聚合。"""
        return self.project_repository.get(script_id)

    def delete_project(self, script_id: str):
        """删除项目，并在需要时解除它与系列的关联。"""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Project not found")

        if project.series_id:
            series = self.series_repository.get(project.series_id)
            if series and script_id in series.episode_ids:
                series.episode_ids.remove(script_id)
                series.updated_at = utc_now()
                self.series_repository.replace_graph(series)

        self.project_repository.soft_delete(script_id)
        return {"status": "deleted", "id": script_id, "title": project.title}

    def sync_descriptions(self, script_id: str):
        """清空缓存提示词，便于后续按最新描述重新生成。"""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Script not found")

        for character in project.characters:
            character.full_body_prompt = None
            character.three_view_prompt = None
            character.headshot_prompt = None
            character.video_prompt = None
        for scene in project.scenes:
            if hasattr(scene, "prompt"):
                scene.prompt = None
        for prop in project.props:
            if hasattr(prop, "prompt"):
                prop.prompt = None

        return self.project_repository.replace_graph(project)

    def update_style(self, script_id: str, style_preset: str, style_prompt: str | None = None):
        """更新项目级视觉风格选择。"""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Script not found")
        return self.project_repository.patch_metadata(
            script_id,
            {"style_preset": style_preset, "style_prompt": style_prompt, "updated_at": utc_now()},
            expected_version=project.version,
        )

    def update_model_settings(self, script_id: str, **updates):
        """增量更新项目上的模型设置字段。"""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Script not found")
        project.model_settings = project.model_settings.model_copy(update={k: v for k, v in updates.items() if v is not None})
        return self.project_repository.patch_metadata(
            script_id,
            {"model_settings": project.model_settings.model_dump(mode="json"), "updated_at": utc_now()},
            expected_version=project.version,
        )

    def get_prompt_config(self, script_id: str):
        """返回提示词配置，缺省时给出空配置对象。"""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Project not found")
        return project.prompt_config if hasattr(project, "prompt_config") else PromptConfig()

    def update_prompt_config(self, script_id: str, storyboard_polish: str = "", video_polish: str = "", r2v_polish: str = ""):
        """整体替换项目的提示词覆写配置。"""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Project not found")
        prompt_config = PromptConfig(
            storyboard_polish=storyboard_polish,
            video_polish=video_polish,
            r2v_polish=r2v_polish,
        )
        self.project_repository.patch_metadata(
            script_id,
            {"prompt_config": prompt_config.model_dump(mode="json"), "updated_at": utc_now()},
            expected_version=project.version,
        )
        return prompt_config
