from datetime import datetime, timezone


def utc_now() -> datetime:
    # 持久化统一使用带时区的 UTC 时间，避免前后端和数据库各自写本地时间。
    return datetime.now(timezone.utc)


def epoch_start() -> datetime:
    # 需要“零值时间”时统一回退到 epoch，避免再混入 float 时间戳。
    return datetime.fromtimestamp(0, timezone.utc)
