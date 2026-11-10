from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from ..database import get_notifications_collection, serialize_doc, to_object_id, build_id_query
from ..auth import get_current_user
from .. import schemas

router = APIRouter()

def create_notification(
    title: str,
    message: str,
    recipient_role: Optional[str] = None,
    recipient_user_id: Optional[str] = None,
    notification_type: str = "general",
    link_section: Optional[str] = None
) -> dict:
    """
    Utility function to create a new persistent notification in MongoDB Atlas.
    """
    col = get_notifications_collection()
    now = datetime.now(timezone.utc)
    doc = {
        "title": title,
        "message": message,
        "recipient_role": recipient_role.lower() if recipient_role else None,
        "recipient_user_id": str(recipient_user_id) if recipient_user_id else None,
        "notification_type": notification_type,
        "link_section": link_section,
        "is_read": False,
        "created_at": now
    }
    result = col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)

@router.get("", response_model=Dict[str, Any])
@router.get("/", response_model=Dict[str, Any])
def get_user_notifications(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Fetches all notifications scoped to the current user and their active role.
    """
    col = get_notifications_collection()
    user_id = str(current_user.get("id"))
    user_role = str(current_user.get("role", "candidate")).lower()

    role_variants = [user_role, user_role.upper(), user_role.capitalize(), "all", "ALL", "All"]

    # Query: Specific to user OR broadcast to user's role / all
    query = {
        "$or": [
            {"recipient_user_id": user_id},
            {"recipient_role": {"$in": role_variants}}
        ]
    }

    cursor = col.find(query).sort("created_at", -1).limit(50)
    notifications = [serialize_doc(doc) for doc in cursor]
    unread_count = sum(1 for n in notifications if not n.get("is_read"))

    return {
        "notifications": notifications,
        "unread_count": unread_count
    }

@router.put("/{notification_id}/read", response_model=Dict[str, Any])
def mark_notification_as_read(notification_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Marks a single notification as read.
    """
    col = get_notifications_collection()
    query = build_id_query(notification_id)
    notif = col.find_one(query)
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")

    col.update_one({"_id": notif["_id"]}, {"$set": {"is_read": True}})
    updated = col.find_one({"_id": notif["_id"]})
    return serialize_doc(updated)

@router.put("/read-all", response_model=Dict[str, Any])
@router.put("/read-all/", response_model=Dict[str, Any])
def mark_all_as_read(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Marks all unread notifications for the current user as read.
    """
    col = get_notifications_collection()
    user_id = str(current_user.get("id"))
    user_role = str(current_user.get("role", "candidate")).lower()
    role_variants = [user_role, user_role.upper(), user_role.capitalize(), "all", "ALL", "All"]

    query = {
        "is_read": False,
        "$or": [
            {"recipient_user_id": user_id},
            {"recipient_role": {"$in": role_variants}}
        ]
    }

    result = col.update_many(query, {"$set": {"is_read": True}})
    return {"status": "ok", "modified_count": result.modified_count}

