from contextlib import contextmanager
from functools import lru_cache
import re

from sqlalchemy import create_engine, event, text
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


@lru_cache(maxsize=1)
def get_engine():
    url = _get_database_url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)

    schema = _get_postgres_schema() if engine.dialect.name == "postgresql" else None
    if schema:
        @event.listens_for(engine, "connect")
        def _set_postgres_search_path(dbapi_connection, connection_record):  # noqa: ANN001, ARG001
            with dbapi_connection.cursor() as cursor:
                cursor.execute(f'SET search_path TO "{schema}", public')

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
