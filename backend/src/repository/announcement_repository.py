from typing import List
import uuid
from sqlalchemy import desc
from sqlalchemy.orm import Session

from .base import BaseRepository
from ..db.models import SystemAnnouncementRecord
from ..schemas.announcement import Announcement, AnnouncementCreate, AnnouncementUpdate
from ..utils.datetime import utc_now

class AnnouncementRepository(BaseRepository[Announcement]):
    def get(self, announcement_id: str, session: Session | None = None) -> Announcement | None:
        with self._with_session(session) as s:
            record = self._get_active(s, SystemAnnouncementRecord, announcement_id)
            if not record:
                return None
            return Announcement.from_orm(record)

    def list_active(self, session: Session | None = None) -> List[Announcement]:
        """List active announcements that are published and not expired."""
        now = utc_now()
        with self._with_session(session) as s:
            query = s.query(SystemAnnouncementRecord).filter(
                SystemAnnouncementRecord.is_deleted.is_(False),
                SystemAnnouncementRecord.status == "active"
            )
            # Filter by publish_at and expires_at if set
            query = query.filter(
                (SystemAnnouncementRecord.publish_at.is_(None)) | (SystemAnnouncementRecord.publish_at <= now)
            )
            query = query.filter(
                (SystemAnnouncementRecord.expires_at.is_(None)) | (SystemAnnouncementRecord.expires_at >= now)
            )
            
            records = query.order_by(desc(SystemAnnouncementRecord.priority), desc(SystemAnnouncementRecord.created_at)).all()
            return [Announcement.from_orm(r) for r in records]

    def list_all(self, session: Session | None = None) -> List[Announcement]:
        """List all announcements (for admin)."""
        with self._with_session(session) as s:
            records = s.query(SystemAnnouncementRecord).filter(
                SystemAnnouncementRecord.is_deleted.is_(False)
            ).order_by(desc(SystemAnnouncementRecord.created_at)).all()
            return [Announcement.from_orm(r) for r in records]

    def create(self, announcement: AnnouncementCreate, created_by: str, session: Session | None = None) -> Announcement:
        with self._with_session(session) as s:
            record = SystemAnnouncementRecord(
                id=f"ann_{uuid.uuid4().hex[:12]}",
                title=announcement.title,
                content=announcement.content,
                status=announcement.status,
                priority=announcement.priority,
                publish_at=announcement.publish_at,
                expires_at=announcement.expires_at,
                created_by=created_by,
                updated_by=created_by,
                created_at=utc_now(),
                updated_at=utc_now()
            )
            s.add(record)
            s.commit()
            s.refresh(record)
            return Announcement.from_orm(record)

    def update(self, announcement_id: str, update: AnnouncementUpdate, updated_by: str, session: Session | None = None) -> Announcement | None:
        with self._with_session(session) as s:
            record = self._get_active(s, SystemAnnouncementRecord, announcement_id)
            if not record:
                return None
            
            patch = update.model_dump(exclude_unset=True)
            self._patch_record(record, patch)
            record.updated_by = updated_by
            
            s.commit()
            s.refresh(record)
            return Announcement.from_orm(record)

    def delete(self, announcement_id: str, deleted_by: str, session: Session | None = None) -> bool:
        with self._with_session(session) as s:
            record = self._get_active(s, SystemAnnouncementRecord, announcement_id)
            if not record:
                return False
            
            self._soft_delete_record(record, deleted_by=deleted_by)
            s.commit()
            return True
