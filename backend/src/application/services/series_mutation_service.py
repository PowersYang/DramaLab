"""
兼容层：系列命令服务旧名称。

运行时请优先使用 ``SeriesCommandService``，这里仅保留给旧导入路径过渡。
"""

from .series_command_service import SeriesCommandService


class SeriesMutationService(SeriesCommandService):
    """兼容旧名称，行为委托给更窄职责的系列命令服务。"""

