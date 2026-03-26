from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session, sessionmaker

from .base import Base
from src.settings.env_settings import get_env


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
        return str(
            URL.create(
                "postgresql+psycopg",
                username=user,
                password=password,
                host=host,
                port=int(port),
                database=database,
            )
        )

    raise RuntimeError(
        "Database is not configured. Set DATABASE_URL or POSTGRES_HOST/POSTGRES_PORT/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD."
    )


@lru_cache(maxsize=1)
def get_engine():
    url = _get_database_url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)


@lru_cache(maxsize=1)
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)


def init_database() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=get_engine())


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
