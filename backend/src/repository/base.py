from typing import Dict, Generic, Iterable, TypeVar

from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.session import session_scope


ModelT = TypeVar("ModelT", bound=BaseModel)


class BaseRepository(Generic[ModelT]):
    def _with_session(self, session: Session | None = None):
        if session is not None:
            return _SessionAdapter(session)
        return session_scope()

    def list_map(self) -> Dict[str, ModelT]:
        raise NotImplementedError

    def sync(self, items: Iterable[ModelT]) -> None:
        raise NotImplementedError


class _SessionAdapter:
    def __init__(self, session: Session):
        self._session = session

    def __enter__(self) -> Session:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False
