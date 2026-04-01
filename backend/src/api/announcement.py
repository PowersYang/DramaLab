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
    # 统一通过 RequestContext.user_id 取操作者，兼容旧调用点并保持接口层简洁。
    announcements = repo.list_active(user_id=context.user_id)
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
    # 公告审计字段需要记录实际操作者，避免依赖路由层手动拆解 user 对象。
    new_announcement = repo.create(announcement, created_by=context.user_id)
    return signed_response(new_announcement)

@router.get("/{announcement_id}", response_model=Announcement)
async def get_announcement(announcement_id: str, context: RequestContext = Depends(get_request_context)):
    """Get a specific announcement."""
    announcement = repo.get(announcement_id, user_id=context.user_id)
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return signed_response(announcement)

@router.post("/{announcement_id}/read", status_code=status.HTTP_200_OK)
async def mark_announcement_as_read(
    announcement_id: str,
    context: RequestContext = Depends(get_request_context)
):
    """Mark an announcement as read."""
    # 已读状态按用户维度记录，因此这里显式传入当前请求用户。
    success = repo.mark_as_read(announcement_id, user_id=context.user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return {"status": "ok"}

@router.patch("/{announcement_id}", response_model=Announcement)
async def update_announcement(
    announcement_id: str,
    update: AnnouncementUpdate,
    context: RequestContext = Depends(require_capability(CAP_PLATFORM_MANAGE))
):
    """Update an existing announcement (Admin only)."""
    # 更新与删除都沿用统一的上下文操作者 ID，便于后续审计字段扩展。
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
