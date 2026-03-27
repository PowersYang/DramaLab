from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from ..utils.oss_utils import OSSImageUploader, sign_oss_urls_in_data


def signed_response(data):
    """
    返回给前端前，统一为数据里的 OSS 地址补签名。

    支持 Pydantic 模型、模型列表和普通字典；
    最终直接返回 `JSONResponse`，避免再次经过 Pydantic 清洗字段。
    """
    if data is None:
        return JSONResponse(content=None)

    if hasattr(data, "model_dump"):
        processed_data = data.model_dump()
    elif isinstance(data, list):
        processed_data = [
            item.model_dump() if hasattr(item, "model_dump") else item
            for item in data
        ]
    else:
        processed_data = data

    uploader = OSSImageUploader()
    if uploader.is_configured:
        processed_data = sign_oss_urls_in_data(processed_data, uploader)

    # 业务时间字段已切到 datetime，这里统一做 JSON 安全编码，避免接口返回阶段再抛序列化异常。
    return JSONResponse(content=jsonable_encoder(processed_data))
