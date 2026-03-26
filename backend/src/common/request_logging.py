import json
import time
import uuid
from typing import Any

from fastapi import Request

from src.common.log import get_logger


logger = get_logger("http.request")

_SENSITIVE_KEYWORDS = ("password", "secret", "token", "key", "authorization", "cookie")
_MAX_BODY_LENGTH = 4000


def _compact_json(value: Any) -> str:
    if value is None:
        return "-"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _build_request_summary(request_id: str, request: Request, payload: Any) -> str:
    query_params = dict(request.query_params)
    path_params = dict(request.path_params)
    client = request.client.host if request.client else "-"
    return (
        f"id={request_id} "
        f"client={client} "
        f"method={request.method} "
        f"path={request.url.path} "
        f"query={_compact_json(query_params)} "
        f"path_params={_compact_json(path_params)} "
        f"payload={_compact_json(payload)}"
    )


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: ("***" if any(word in key.lower() for word in _SENSITIVE_KEYWORDS) else _sanitize_value(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_value(item) for item in value)
    return value


def _parse_request_payload(request: Request, body: bytes) -> Any:
    if not body:
        return None

    content_type = request.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        try:
            return _sanitize_value(json.loads(body.decode("utf-8")))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {"raw_body": body.decode("utf-8", errors="replace")[:_MAX_BODY_LENGTH]}

    if "application/x-www-form-urlencoded" in content_type:
        raw_text = body.decode("utf-8", errors="replace")
        return {"raw_body": raw_text[:_MAX_BODY_LENGTH]}

    if "multipart/form-data" in content_type:
        return {
            "content_type": content_type,
            "content_length": request.headers.get("content-length", "unknown"),
            "note": "multipart body omitted",
        }

    return {
        "content_type": content_type or "unknown",
        "content_length": request.headers.get("content-length", str(len(body))),
        "raw_body": body.decode("utf-8", errors="replace")[:_MAX_BODY_LENGTH],
    }


async def log_request_response(request: Request, call_next):
    start_time = time.perf_counter()
    request_id = uuid.uuid4().hex[:8]
    body = await request.body()
    payload = _parse_request_payload(request, body)
    request_summary = _build_request_summary(request_id, request, payload)
    logger.info("START %s", request_summary)

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        logger.exception("FAIL  %s duration_ms=%.2f", request_summary, duration_ms)
        raise

    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
    logger.info(
        "END   %s status=%s duration_ms=%.2f",
        request_summary,
        response.status_code,
        duration_ms,
    )
    return response
