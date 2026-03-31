"""
项目应用服务。

这里负责项目级 CRUD 与轻量配置更新，
替代过去以 pipeline 为中心的项目写入路径。
"""

from ...repository import ProjectRepository, SeriesRepository
from ...common.log import get_logger
from ...providers import ScriptProcessor
from .model_provider_service import ModelProviderService
from .project_command_service import ProjectCommandService
from ...schemas.models import ModelSettings, PromptConfig
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class ProjectService:
    """负责项目聚合相关应用操作。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.text_provider = ScriptProcessor()
        self.model_provider_service = ModelProviderService()
        self.project_command_service = ProjectCommandService()

    def create_project(
        self,
        title: str,
        text: str,
        skip_analysis: bool = False,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        created_by: str | None = None,
    ):
        """根据原始文本创建并持久化项目。"""
        # 创建项目时记录文本长度和模式，后续可以区分是 AI 解析慢还是草稿创建阶段慢。
        logger.info(
            "PROJECT_SERVICE: create_project title=%s text_length=%s skip_analysis=%s",
            title,
            len(text or ""),
            skip_analysis,
        )
        if skip_analysis:
            project = self.text_provider.create_draft_script(title, text)
        else:
            project = self.text_provider.parse_novel(title, text)
        project.organization_id = organization_id
        project.workspace_id = workspace_id
        project.created_by = created_by
        project.updated_by = created_by
        self.project_repository.create(project)
        logger.info("PROJECT_SERVICE: create_project completed project_id=%s", project.id)
        return project

    def reparse_project(self, script_id: str, text: str):
        """重新解析剧本中的实体信息，同时保留分镜、视频等非实体资源。"""
        logger.info(
            "PROJECT_SERVICE: reparse_project script_id=%s text_length=%s",
            script_id,
            len(text or ""),
        )
        existing = self.get_project(script_id)
        if not existing:
            logger.warning("PROJECT_SERVICE: reparse_project target missing script_id=%s", script_id)
            raise ValueError("Script not found")

        reparsed = self.text_provider.parse_novel(existing.title, text)
        # 重新解析时仅替换剧本文本与实体集合；分镜、视频任务、成片地址等非实体资源继续沿用旧项目，
        # 避免“提取实体”误伤已存在的分镜或后续生产产物。
        reparsed.id = existing.id
        reparsed.created_at = existing.created_at
        reparsed.updated_at = utc_now()
        reparsed.original_text = text
        reparsed.frames = existing.frames
        reparsed.video_tasks = existing.video_tasks
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

        reparsed.characters = self._reuse_entity_ids(existing.characters, reparsed.characters)
        reparsed.scenes = self._reuse_entity_ids(existing.scenes, reparsed.scenes)
        reparsed.props = self._reuse_entity_ids(existing.props, reparsed.props)

        patched_project = self.project_repository.patch_metadata(
            script_id,
            {"original_text": text, "updated_at": utc_now()},
            expected_version=existing.version,
        )
        updated_project = self.project_command_service.sync_entities(
            script_id,
            patched_project.version,
            reparsed.characters,
            reparsed.scenes,
            reparsed.props,
        )
        logger.info("PROJECT_SERVICE: reparse_project completed script_id=%s", script_id)
        return updated_project

    def list_projects(self, workspace_id: str | None = None):
        """返回所有已持久化项目。"""
        projects = self.project_repository.list(workspace_id=workspace_id)
        logger.info("PROJECT_SERVICE: list_projects count=%s", len(projects))
        return projects

    def list_project_briefs(self, workspace_id: str | None = None):
        """返回轻量项目摘要，避免任务中心加载完整项目聚合。"""
        projects = self.project_repository.list_briefs(workspace_id=workspace_id)
        logger.info("PROJECT_SERVICE: list_project_briefs count=%s", len(projects))
        return projects

    def list_project_summaries(self, workspace_id: str | None = None):
        """返回项目中心卡片所需的轻量项目汇总。"""
        projects = self.project_repository.list_summaries(workspace_id=workspace_id)
        logger.info("PROJECT_SERVICE: list_project_summaries count=%s", len(projects))
        return projects

    def list_episode_briefs(self, series_id: str, workspace_id: str | None = None):
        """返回某个系列下的分集轻量列表。"""
        episodes = self.project_repository.list_episode_briefs(series_id, workspace_id=workspace_id)
        logger.info("PROJECT_SERVICE: list_episode_briefs series_id=%s count=%s", series_id, len(episodes))
        return episodes

    def get_project(self, script_id: str):
        """加载单个项目聚合。"""
        project = self.project_repository.get(script_id)
        logger.info("PROJECT_SERVICE: get_project script_id=%s found=%s", script_id, bool(project))
        return project

    def delete_project(self, script_id: str):
        """删除项目，并在需要时解除它与系列的关联。"""
        logger.info("PROJECT_SERVICE: delete_project script_id=%s", script_id)
        project = self.get_project(script_id)
        if not project:
            logger.warning("PROJECT_SERVICE: delete_project target missing script_id=%s", script_id)
            raise ValueError("Project not found")

        if project.series_id:
            series = self.series_repository.get(project.series_id)
            if series:
                self.series_repository.patch_metadata(series.id, {"updated_at": utc_now()}, expected_version=series.version)

        self.project_repository.soft_delete(script_id)
        logger.info(
            "PROJECT_SERVICE: delete_project completed script_id=%s title=%s series_id=%s",
            script_id,
            project.title,
            project.series_id,
        )
        return {"status": "deleted", "id": script_id, "title": project.title}

    def sync_descriptions(self, script_id: str):
        """清空缓存提示词，便于后续按最新描述重新生成。"""
        logger.info("PROJECT_SERVICE: sync_descriptions script_id=%s", script_id)
        project = self.get_project(script_id)
        if not project:
            logger.warning("PROJECT_SERVICE: sync_descriptions target missing script_id=%s", script_id)
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

        updated_project = self.project_command_service.sync_entities(
            script_id,
            project.version,
            project.characters,
            project.scenes,
            project.props,
        )
        logger.info(
            "PROJECT_SERVICE: sync_descriptions completed script_id=%s characters=%s scenes=%s props=%s",
            script_id,
            len(project.characters),
            len(project.scenes),
            len(project.props),
        )
        return updated_project

    def _reuse_entity_ids(self, existing_items: list, incoming_items: list):
        """按归一化名称复用旧实体 ID，减少 reparse 对下游引用的冲击。"""
        existing_by_name = {
            self._normalize_entity_name(item.name): item
            for item in existing_items
            if getattr(item, "name", None)
        }
        for item in incoming_items:
            matched = existing_by_name.get(self._normalize_entity_name(getattr(item, "name", "")))
            if not matched:
                continue
            item.id = matched.id
            item.created_at = matched.created_at
        return incoming_items

    def _normalize_entity_name(self, value: str) -> str:
        return str(value or "").strip().lower()

    def update_style(self, script_id: str, style_preset: str, style_prompt: str | None = None):
        """更新项目级视觉风格选择。"""
        logger.info(
            "PROJECT_SERVICE: update_style script_id=%s style_preset=%s has_style_prompt=%s",
            script_id,
            style_preset,
            bool(style_prompt),
        )
        project = self.get_project(script_id)
        if not project:
            logger.warning("PROJECT_SERVICE: update_style target missing script_id=%s", script_id)
            raise ValueError("Script not found")
        return self.project_repository.patch_metadata(
            script_id,
            {"style_preset": style_preset, "style_prompt": style_prompt, "updated_at": utc_now()},
            expected_version=project.version,
        )

    def update_model_settings(self, script_id: str, **updates):
        """增量更新项目上的模型设置字段。"""
        effective_updates = {k: v for k, v in updates.items() if v is not None}
        logger.info(
            "PROJECT_SERVICE: update_model_settings script_id=%s fields=%s",
            script_id,
            sorted(effective_updates.keys()),
        )
        project = self.get_project(script_id)
        if not project:
            logger.warning("PROJECT_SERVICE: update_model_settings target missing script_id=%s", script_id)
            raise ValueError("Script not found")
        self.model_provider_service.ensure_model_settings_allowed(effective_updates)
        project.model_settings = project.model_settings.model_copy(update=effective_updates)
        return self.project_repository.patch_metadata(
            script_id,
            {"model_settings": project.model_settings.model_dump(mode="json"), "updated_at": utc_now()},
            expected_version=project.version,
        )

    def get_prompt_config(self, script_id: str):
        """返回提示词配置，缺省时给出空配置对象。"""
        logger.info("PROJECT_SERVICE: get_prompt_config script_id=%s", script_id)
        project = self.get_project(script_id)
        if not project:
            logger.warning("PROJECT_SERVICE: get_prompt_config target missing script_id=%s", script_id)
            raise ValueError("Project not found")
        return project.prompt_config if hasattr(project, "prompt_config") else PromptConfig()

    def update_prompt_config(self, script_id: str, storyboard_polish: str = "", video_polish: str = "", r2v_polish: str = ""):
        """整体替换项目的提示词覆写配置。"""
        logger.info(
            "PROJECT_SERVICE: update_prompt_config script_id=%s storyboard=%s video=%s r2v=%s",
            script_id,
            bool(storyboard_polish),
            bool(video_polish),
            bool(r2v_polish),
        )
        project = self.get_project(script_id)
        if not project:
            logger.warning("PROJECT_SERVICE: update_prompt_config target missing script_id=%s", script_id)
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
        logger.info("PROJECT_SERVICE: update_prompt_config completed script_id=%s", script_id)
        return prompt_config
