from contextlib import contextmanager
from functools import lru_cache
import re

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session, sessionmaker

from .base import Base
from src.settings.env_settings import get_env


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


def _ensure_incremental_columns(engine, schema: str | None = None) -> None:
    inspector = inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("users", schema=schema)}
    billing_account_columns = {column["name"] for column in inspector.get_columns("billing_accounts", schema=schema)}
    statements: list[str] = []

    # 中文注释：当前仓库还没有正式 migration 基础设施，这里只为新增的认证列做一次幂等补齐，避免旧库启动后直接报错。
    if "password_hash" not in user_columns:
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."users"' if schema else '"users"'
            statements.append(f'ALTER TABLE {target} ADD COLUMN password_hash VARCHAR(512)')
        else:
            statements.append("ALTER TABLE users ADD COLUMN password_hash VARCHAR(512)")

    if "user_art_styles" not in user_columns:
        # 中文注释：用户级风格库先收敛到 users 表上的 JSON 列，避免在没有正式 migration 体系前再引入额外关联表。
        if engine.dialect.name == "postgresql":
            target = f'"{schema}"."users"' if schema else '"users"'
            statements.append(f"ALTER TABLE {target} ADD COLUMN user_art_styles JSONB NOT NULL DEFAULT '[]'::jsonb")
        else:
            statements.append("ALTER TABLE users ADD COLUMN user_art_styles JSON NOT NULL DEFAULT '[]'")

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

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


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
