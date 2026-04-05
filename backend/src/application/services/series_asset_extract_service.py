"""
系列资产识别服务。

这里负责把系列文本识别成候选角色/场景/道具，仅返回预览结果，不直接写库。
"""

from ...providers import ScriptProcessor
from ...repository import SeriesRepository


class SeriesAssetExtractService:
    """执行系列资产识别 dry-run。"""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.text_provider = ScriptProcessor()

    def extract_assets_preview(self, series_id: str, text: str) -> dict:
        """根据输入文本返回系列资产候选结果，但不创建临时项目。"""
        series = self.series_repository.get(series_id)
        if not series:
            raise ValueError("系列不存在")

        parsed = self.text_provider.parse_novel(series.title, text)
        return {
            "series_id": series.id,
            "series_title": series.title,
            "characters": [item.model_dump(mode="json") for item in (parsed.characters or [])],
            "scenes": [item.model_dump(mode="json") for item in (parsed.scenes or [])],
            "props": [item.model_dump(mode="json") for item in (parsed.props or [])],
        }
