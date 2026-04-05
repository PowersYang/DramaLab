"""Alembic 环境配置。

这里把 SQLAlchemy metadata 与当前仓库的数据库配置统一接进 Alembic，
后续 schema 变更不再只依赖 create_all + 启动时补列。
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from src.db.base import Base
from src.db.session import _get_database_url, _get_postgres_schema
from src.db import models  # noqa: F401


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _configure_url() -> tuple[str, str | None]:
    """统一读取仓库已有数据库配置，避免 Alembic 再维护第二套连接来源。"""
    url = _get_database_url()
    schema = _get_postgres_schema() if url.startswith("postgresql") else None
    # 中文注释：Alembic 使用 ConfigParser，URL 中的 %（如密码里的 @ 被编码为 %40）需要先转义为 %% 才能写入配置。
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return url, schema


def run_migrations_offline() -> None:
    """离线模式下生成 SQL。"""
    url, schema = _configure_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_schemas=bool(schema),
        version_table_schema=schema,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式下直接执行迁移。"""
    _, schema = _configure_url()
    connectable = create_engine(
        config.get_main_option("sqlalchemy.url"),
        future=True,
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        if schema and connection.dialect.name == "postgresql":
            connection.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            connection.exec_driver_sql(f'SET search_path TO "{schema}", public')
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_schemas=bool(schema),
            version_table_schema=schema,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
