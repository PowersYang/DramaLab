from datetime import datetime
from pydantic import BaseModel, Field

class AnnouncementBase(BaseModel):
    title: str = Field(..., max_length=255)
    content: str
    status: str = Field("active", pattern="^(active|inactive)$")
    priority: int = 0
    publish_at: datetime | None = None
    expires_at: datetime | None = None

class AnnouncementCreate(AnnouncementBase):
    pass

class AnnouncementUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    content: str | None = None
    status: str | None = Field(None, pattern="^(active|inactive)$")
    priority: int | None = None
    publish_at: datetime | None = None
    expires_at: datetime | None = None

class Announcement(AnnouncementBase):
    id: str
    created_at: datetime
    updated_at: datetime
    created_by: str | None = None
    is_read: bool = False

    class Config:
        from_attributes = True
