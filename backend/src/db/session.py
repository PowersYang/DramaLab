from contextlib import contextmanager
from functools import lru_cache
import json
import re

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session, sessionmaker

from .base import Base
from src.settings.env_settings import get_env
from .models import UserArtStyleRecord

_SCHEMA_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _get_database_url() -> str:
    database_url = get_env("DATABASE_URL")
    if database_url:
        return database_url

    host = get_env("POSTGRES_HOST")
    port = get_env("POSTGRES_PORT", "5432")
    database = get_env("POSTGRES_DB")
    user = get_env("POSTGRES_USER")
    password = get_env("POSTGRES_PASSWORD")
    if host and database and user is not None and password is not None:
        return URL.create(
            "postgresql+psycopg",
            username=user,
            password=password,
            host=host,
            port=int(port),
            database=database,
        ).render_as_string(hide_password=False)

    raise RuntimeError(
        "Database is not configured. Set DATABASE_URL or POSTGRES_HOST/POSTGRES_PORT/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD."
    )


def _get_postgres_schema() -> str | None:
    schema = get_env("POSTGRES_SCHEMA")
    if schema is None:
        return None

    schema = schema.strip()
    if not schema:
        return None
    if not _SCHEMA_NAME_RE.fullmatch(schema):
        raise RuntimeError(
            "POSTGRES_SCHEMA is invalid. Use a PostgreSQL schema name containing only letters, digits, and underscores."
        )
    return schema


def _configure_postgres_connection(dbapi_connection, schema: str | None) -> None:  # noqa: ANN001
    # 中文注释：显式固定 PostgreSQL 会话时区为北京时间，避免不同数据库默认配置导致 created_at / updated_at 出现 8 小时偏差。
    with dbapi_connection.cursor() as cursor:
        if schema:
            cursor.execute(f'SET search_path TO "{schema}", public')
        cursor.execute("SET TIME ZONE 'Asia/Shanghai'")


@lru_cache(maxsize=1)
def get_engine():
    url = _get_database_url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)

    schema = _get_postgres_schema() if engine.dialect.name == "postgresql" else None
    if engine.dialect.name == "postgresql":
        @event.listens_for(engine, "connect")
        def _configure_postgres_session(dbapi_connection, connection_record):  # noqa: ANN001, ARG001
            _configure_postgres_connection(dbapi_connection, schema=schema)

    return engine


@lru_cache(maxsize=1)
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)


def init_database() -> None:
    from . import models  # noqa: F401

    engine = get_engine()
    schema = _get_postgres_schema() if engine.dialect.name == "postgresql" else None

    if schema:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))

    Base.metadata.create_all(bind=engine)
    _ensure_incremental_columns(engine, schema=schema)
    _ensure_incremental_indexes(engine, schema=schema)
    _migrate_legacy_user_art_styles(engine, schema=schema)


def _ensure_incremental_columns(engine, schema: str | None = None) -> None:
    inspector = inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("users", schema=schema)}
    billing_account_columns = {column["name"] for column in inspector.get_columns("billing_accounts", schema=schema)}
    billing_transaction_columns = {column["name"] for column in inspector.get_columns("billing_transactions", schema=schema)}
    billing_charge_columns = {column["name"] for column in inspector.get_columns("billing_charges", schema=schema)}
    billing_pricing_rule_columns = {column["name"] for column in inspector.get_columns("billing_pricing_rules", schema=schema)}
    project_columns = {column["name"] for column in inspector.get_columns("projects", schema=schema)}
    series_columns = {column["name"] for column in inspector.get_columns("series", schema=schema)}
    character_columns = {column["name"] for column in inspector.get_columns("characters", schema=schema)}
    statements: list[str] = []

    # 中文注释：当前仓库还没有正式 migration 基础设施，这里只为新增的认证列做一次幂等补齐，避免旧库启动后直接报错。
    if "password_hash" not in user_columns:
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."users"' if schema else '"users"'
            statements.append(f'ALTER TABLE {target} ADD COLUMN password_hash VARCHAR(512)')
        else:
            statements.append("ALTER TABLE users ADD COLUMN password_hash VARCHAR(512)")

    billing_account_additions = {
        "owner_type": "VARCHAR(16) NOT NULL DEFAULT 'organization'",
        "owner_id": "VARCHAR(64)",
        "currency": "VARCHAR(16) NOT NULL DEFAULT 'CNY'",
        "balance_credits": "INTEGER NOT NULL DEFAULT 0",
        "total_recharged_cents": "INTEGER NOT NULL DEFAULT 0",
        "total_credited": "INTEGER NOT NULL DEFAULT 0",
        "total_bonus_credits": "INTEGER NOT NULL DEFAULT 0",
        "total_consumed_credits": "INTEGER NOT NULL DEFAULT 0",
        "pricing_version": "VARCHAR(64)",
    }
    for column_name, definition in billing_account_additions.items():
        if column_name in billing_account_columns:
            continue
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."billing_accounts"' if schema else '"billing_accounts"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN {column_name} {definition}")
        else:
            statements.append(f"ALTER TABLE billing_accounts ADD COLUMN {column_name} {definition}")

    if "timeline_json" not in project_columns:
        # 中文注释：Phase 1 先把时间轴工程落到 projects 表的 JSON 列，避免在没有正式 migration 体系前就引入一套新子表。
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."projects"' if schema else '"projects"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN timeline_json JSONB")
        else:
            statements.append("ALTER TABLE projects ADD COLUMN timeline_json JSON")

    if "status" not in project_columns:
        # 中文注释：项目列表和任务面板已经依赖 status 字段，旧库启动时需要自动补齐，避免 ORM 查询直接引用不存在的列。
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."projects"' if schema else '"projects"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'")
        else:
            statements.append("ALTER TABLE projects ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'")

    if "status" not in series_columns:
        # 中文注释：系列列表与工作台总览都依赖 series.status，旧库缺列时会在 ORM 查询阶段直接抛错。
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."series"' if schema else '"series"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'")
        else:
            statements.append("ALTER TABLE series ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'")

    character_additions = {
        "canonical_name": "VARCHAR(255)",
        "aliases_json": "JSONB" if engine.dialect.name == "postgresql" else "JSON",
        "identity_fingerprint": "VARCHAR(255)",
        "merge_status": "VARCHAR(32) NOT NULL DEFAULT 'active'",
    }
    for column_name, definition in character_additions.items():
        if column_name in character_columns:
            continue
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."characters"' if schema else '"characters"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN {column_name} {definition}")
        else:
            statements.append(f"ALTER TABLE characters ADD COLUMN {column_name} {definition}")

    billing_transaction_additions = {
        "charge_id": "VARCHAR(64)",
        "source_event": "VARCHAR(64)",
        "external_ref": "VARCHAR(255)",
    }
    for column_name, definition in billing_transaction_additions.items():
        if column_name in billing_transaction_columns:
            continue
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."billing_transactions"' if schema else '"billing_transactions"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN {column_name} {definition}")
        else:
            statements.append(f"ALTER TABLE billing_transactions ADD COLUMN {column_name} {definition}")

    billing_charge_additions = {
        "reserved_credits": "INTEGER NOT NULL DEFAULT 0",
        "settled_credits": "INTEGER",
        "refunded_credits": "INTEGER NOT NULL DEFAULT 0",
        "adjusted_credits": "INTEGER NOT NULL DEFAULT 0",
        "pricing_mode": "VARCHAR(16) NOT NULL DEFAULT 'fixed'",
        "usage_snapshot_json": "JSONB" if engine.dialect.name == "postgresql" else "JSON",
        "settlement_reason": "VARCHAR(64)",
        "settled_at": "TIMESTAMP WITH TIME ZONE" if engine.dialect.name == "postgresql" else "DATETIME",
        "reconciled_at": "TIMESTAMP WITH TIME ZONE" if engine.dialect.name == "postgresql" else "DATETIME",
        "last_reconcile_error": "TEXT",
        "version": "INTEGER NOT NULL DEFAULT 1",
    }
    for column_name, definition in billing_charge_additions.items():
        if column_name in billing_charge_columns:
            continue
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."billing_charges"' if schema else '"billing_charges"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN {column_name} {definition}")
        else:
            statements.append(f"ALTER TABLE billing_charges ADD COLUMN {column_name} {definition}")

    billing_pricing_rule_additions = {
        "reserve_credits": "INTEGER NOT NULL DEFAULT 0",
        "minimum_credits": "INTEGER NOT NULL DEFAULT 0",
        "pricing_config_json": "JSONB NOT NULL DEFAULT '{}'::jsonb" if engine.dialect.name == "postgresql" else "JSON",
        "usage_metric_key": "VARCHAR(64)",
    }
    for column_name, definition in billing_pricing_rule_additions.items():
        if column_name in billing_pricing_rule_columns:
            continue
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."billing_pricing_rules"' if schema else '"billing_pricing_rules"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN {column_name} {definition}")
        else:
            statements.append(f"ALTER TABLE billing_pricing_rules ADD COLUMN {column_name} {definition}")

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _ensure_incremental_indexes(engine, schema: str | None = None) -> None:
    statements: list[str] = []

    if engine.dialect.name == "postgresql":
        task_jobs_table = f'"{schema}"."task_jobs"' if schema else '"task_jobs"'
        statements.append(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_task_jobs_active_dedupe_key "
            f"ON {task_jobs_table}(dedupe_key) "
            "WHERE dedupe_key IS NOT NULL AND status IN ('queued','claimed','running','retry_waiting','cancel_requested')"
        )
    else:
        statements.append(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_task_jobs_active_dedupe_key "
            "ON task_jobs(dedupe_key) "
            "WHERE dedupe_key IS NOT NULL AND status IN ('queued','claimed','running','retry_waiting','cancel_requested')"
        )

    if engine.dialect.name == "postgresql":
        characters_table = f'"{schema}"."characters"' if schema else '"characters"'
        project_character_links_table = f'"{schema}"."project_character_links"' if schema else '"project_character_links"'
        statements.append(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_characters_series_canonical_name_active "
            f"ON {characters_table}(owner_id, canonical_name) "
            "WHERE owner_type = 'series' AND is_deleted = false AND canonical_name IS NOT NULL"
        )
        statements.append(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_project_character_links_project_character_active "
            f"ON {project_character_links_table}(project_id, character_id) "
            "WHERE is_deleted = false"
        )
    else:
        statements.append(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_characters_series_canonical_name_active "
            "ON characters(owner_id, canonical_name) "
            "WHERE owner_type = 'series' AND is_deleted = 0 AND canonical_name IS NOT NULL"
        )
        statements.append(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_project_character_links_project_character_active "
            "ON project_character_links(project_id, character_id) "
            "WHERE is_deleted = 0"
        )

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _migrate_legacy_user_art_styles(engine, schema: str | None = None) -> None:
    """把旧版风格 JSON 存储迁到一条风格一行的明细表。"""
    from .models import UserArtStyleRecord

    inspector = inspect(engine)
    users_table = f'"{schema}"."users"' if engine.dialect.name == "postgresql" and schema else '"users"'
    legacy_library_table = f'"{schema}"."user_art_style_libraries"' if engine.dialect.name == "postgresql" and schema else '"user_art_style_libraries"'
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)

    user_columns = {column["name"] for column in inspector.get_columns("users", schema=schema)}
    legacy_tables = set(inspector.get_table_names(schema=schema))

    with SessionLocal() as session:
        existing_user_ids = {
            user_id
            for (user_id,) in session.query(UserArtStyleRecord.user_id).distinct().all()
        }
        changed = False

        if "user_art_styles" in user_columns:
            rows = session.execute(text(f"SELECT id, user_art_styles FROM {users_table}")).all()
            for user_id, raw_styles in rows:
                if user_id in existing_user_ids:
                    continue
                styles = _normalize_legacy_style_list(raw_styles)
                changed |= _insert_legacy_style_rows(session, user_id, styles)
                if styles:
                    existing_user_ids.add(user_id)

        if "user_art_style_libraries" in legacy_tables:
            rows = session.execute(text(f"SELECT user_id, styles_json FROM {legacy_library_table}")).all()
            for user_id, raw_styles in rows:
                if user_id in existing_user_ids:
                    continue
                styles = _normalize_legacy_style_list(raw_styles)
                changed |= _insert_legacy_style_rows(session, user_id, styles)
                if styles:
                    existing_user_ids.add(user_id)

        if changed:
            session.commit()
        else:
            session.rollback()


def _insert_legacy_style_rows(session: Session, user_id: str, styles: list[dict[str, object]]) -> bool:
    """把旧 JSON 风格数组插成明细行。"""
    changed = False
    for index, style in enumerate(styles):
        style_id = str(style.get("id") or f"{user_id}-style-{index}")
        session.add(
            UserArtStyleRecord(
                id=style_id,
                user_id=user_id,
                name=str(style.get("name") or ""),
                description=str(style.get("description") or ""),
                positive_prompt=str(style.get("positive_prompt") or ""),
                negative_prompt=str(style.get("negative_prompt") or ""),
                thumbnail_url=str(style["thumbnail_url"]) if style.get("thumbnail_url") else None,
                is_custom=bool(style.get("is_custom", True)),
                reason=str(style["reason"]) if style.get("reason") else None,
                sort_order=int(style.get("sort_order", index)),
            )
        )
        changed = True
    return changed


def _normalize_legacy_style_list(value) -> list[dict[str, object]]:  # noqa: ANN001
    """兼容旧 JSON 列与旧风格库表的返回值格式。"""
    if value in (None, "", "null"):
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []
    return []
@contextmanager
def session_scope():
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
