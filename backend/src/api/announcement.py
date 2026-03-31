from fastapi import APIRouter, Depends, HTTPException, status
from typing import List

from ..auth.constants import CAP_PLATFORM_MANAGE
from ..auth.dependencies import RequestContext, get_request_context, require_capability
from ..schemas.announcement import Announcement, AnnouncementCreate, AnnouncementUpdate
from ..repository.announcement_repository import AnnouncementRepository
from ..common import signed_response

router = APIRouter(prefix="/announcements", tags=["Announcements"])
repo = AnnouncementRepository()

@router.get("", response_model=List[Announcement])
async def list_announcements(context: RequestContext = Depends(get_request_context)):
    """List active announcements for current user."""
    announcements = repo.list_active()
    return signed_response(announcements)

@router.get("/all", response_model=List[Announcement])
async def list_all_announcements(context: RequestContext = Depends(require_capability(CAP_PLATFORM_MANAGE))):
    """List all announcements for admin management."""
    announcements = repo.list_all()
    return signed_response(announcements)

@router.post("", response_model=Announcement, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    announcement: AnnouncementCreate,
    context: RequestContext = Depends(require_capability(CAP_PLATFORM_MANAGE))
):
    """Create a new announcement (Admin only)."""
    new_announcement = repo.create(announcement, created_by=context.user_id)
    return signed_response(new_announcement)

@router.get("/{announcement_id}", response_model=Announcement)
async def get_announcement(announcement_id: str, context: RequestContext = Depends(get_request_context)):
    """Get a specific announcement."""
    announcement = repo.get(announcement_id)
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return signed_response(announcement)

@router.patch("/{announcement_id}", response_model=Announcement)
async def update_announcement(
    announcement_id: str,
    update: AnnouncementUpdate,
    context: RequestContext = Depends(require_capability(CAP_PLATFORM_MANAGE))
):
    """Update an existing announcement (Admin only)."""
    updated = repo.update(announcement_id, update, updated_by=context.user_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return signed_response(updated)

@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_announcement(
    announcement_id: str,
    context: RequestContext = Depends(require_capability(CAP_PLATFORM_MANAGE))
):
    """Delete an announcement (Admin only)."""
    success = repo.delete(announcement_id, deleted_by=context.user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return
