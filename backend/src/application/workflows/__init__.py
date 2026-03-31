from importlib import import_module

__all__ = [
    "AssetWorkflow",
    "MediaWorkflow",
    "SeriesWorkflow",
    "StoryboardWorkflow",
]

_EXPORT_MAP = {
    "AssetWorkflow": (".asset_workflow", "AssetWorkflow"),
    "MediaWorkflow": (".media_workflow", "MediaWorkflow"),
    "SeriesWorkflow": (".series_workflow", "SeriesWorkflow"),
    "StoryboardWorkflow": (".storyboard_workflow", "StoryboardWorkflow"),
}


def __getattr__(name):
    if name not in _EXPORT_MAP:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attribute_name = _EXPORT_MAP[name]
    module = import_module(module_name, __name__)
    value = getattr(module, attribute_name)
    globals()[name] = value
    return value


def __dir__():
    return sorted(set(globals()) | set(__all__))

"""
应用工作流导出入口。

workflow 负责串联分析、生成、导出这类多步骤流程，
通过 repository 和 provider 组织执行，而不再持有核心内存状态。
"""
