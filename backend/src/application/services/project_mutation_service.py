"""
兼容层：项目命令服务旧名称。

运行时请优先使用 ``ProjectCommandService``，这里仅保留给旧导入路径过渡。
"""

from .project_command_service import ProjectCommandService


class ProjectMutationService(ProjectCommandService):
    """兼容旧名称，行为委托给更窄职责的项目命令服务。"""

