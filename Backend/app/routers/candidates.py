from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from .. import models, schemas
from ..database import (
    get_candidates_collection,
    get_users_collection,
    serialize_doc,
    to_object_id,
    build_id_query
)
from ..auth import get_current_user
from .notifications import create_notification

router = APIRouter()

@router.post("/", response_model=schemas.CandidateOut, status_code=status.HTTP_201_CREATED)
def create_candidate(candidate: schemas.CandidateCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    
    candidates_col = get_candidates_collection()
    if candidates_col.find_one({"email": candidate.email}):
        raise HTTPException(status_code=400, detail="Candidate with this email already exists")
    
    now = datetime.now(timezone.utc)
    status_history = [{
        "status": "applied",
        "previous_status": None,
        "updated_by": current_user.get("username", "recruiter"),
        "timestamp": now,
        "remarks": "Candidate application registered."
    }]
    
    new_doc = {
        "name": candidate.name,
        "email": candidate.email,
        "phone": candidate.phone,
        "status": "applied",
        "status_history": status_history,
        "user_id": None,
        "recruiter_id": str(current_user.get("id")),
        "created_at": now,
        "updated_at": now,
    }
    result = candidates_col.insert_one(new_doc)
    new_doc["_id"] = result.inserted_id

    # Emit notification
    create_notification(
        title="Candidate Application Registered",
        message=f"Candidate {candidate.name} has been registered into the pipeline.",
        recipient_role="recruiter",
        notification_type="status_change",
        link_section="candidates"
    )

    return serialize_doc(new_doc)

@router.get("/", response_model=List[schemas.CandidateOut])
def list_candidates(
    skip: int = 0,
    limit: int = 100,
    unassigned_only: Optional[bool] = False,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. Candidates cannot view candidate list.")
    
    candidates_col = get_candidates_collection()
    query: Dict[str, Any] = {}
    if user_role in (models.UserRole.recruiter.value, "recruiter"):
        rec_id = str(current_user.get("id"))
        query = {
            "$or": [
                {"assigned_recruiter_id": rec_id},
                {"recruiter_id": rec_id}
            ]
        }
    elif unassigned_only:
        query = {
            "$or": [
                {"assigned_recruiter_id": None},
                {"assigned_recruiter_id": {"$exists": False}},
                {"assigned_recruiter_id": ""}
            ]
        }
    
    candidates = list(candidates_col.find(query).sort("created_at", -1).skip(skip).limit(limit))
    return [serialize_doc(c) for c in candidates]

@router.put("/{candidate_id}/assign-recruiter", response_model=schemas.CandidateOut)
def assign_candidate_recruiter(
    candidate_id: str,
    payload: schemas.AssignRecruiterInput,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Admin-only: assign or reassign a candidate to a specific recruiter.
    """
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required to assign candidates.")

    candidates_col = get_candidates_collection()
    query = build_id_query(candidate_id)
    cand = candidates_col.find_one(query)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    recruiter_id = payload.recruiter_id
    now = datetime.now(timezone.utc)

    if recruiter_id:
        users_col = get_users_collection()
        rec_user = users_col.find_one(build_id_query(recruiter_id))
        if not rec_user:
            raise HTTPException(status_code=404, detail="Recruiter not found")
        rec_role = str(rec_user.get("role", "")).lower()
        if rec_role not in (models.UserRole.recruiter.value, models.UserRole.admin.value, "recruiter", "admin"):
            raise HTTPException(status_code=400, detail="Assigned user must have a recruiter role.")

        rec_id_str = str(rec_user["_id"])
        rec_name = rec_user.get("username") or rec_user.get("name") or "Assigned Recruiter"

        history_item = {
            "status": cand.get("status", "applied"),
            "new_status": cand.get("status", "applied"),
            "previous_status": cand.get("status", "applied"),
            "updated_by": current_user.get("username", "admin"),
            "timestamp": now,
            "remarks": f"Candidate assigned to recruiter '{rec_name}' by Admin."
        }

        candidates_col.update_one(
            {"_id": cand["_id"]},
            {
                "$set": {
                    "assigned_recruiter_id": rec_id_str,
                    "assigned_recruiter_name": rec_name,
                    "recruiter_id": rec_id_str,
                    "updated_at": now
                },
                "$push": {"status_history": history_item}
            }
        )

        create_notification(
            title=f"New Candidate Assigned: {cand.get('name')}",
            message=f"Admin assigned candidate {cand.get('name')} ({cand.get('email')}) to your portfolio.",
            recipient_user_id=rec_id_str,
            recipient_role="recruiter",
            notification_type="assignment",
            link_section="candidates"
        )
    else:
        # Clear assignment
        history_item = {
            "status": cand.get("status", "applied"),
            "new_status": cand.get("status", "applied"),
            "previous_status": cand.get("status", "applied"),
            "updated_by": current_user.get("username", "admin"),
            "timestamp": now,
            "remarks": "Candidate recruiter assignment cleared by Admin."
        }
        candidates_col.update_one(
            {"_id": cand["_id"]},
            {
                "$set": {
                    "assigned_recruiter_id": None,
                    "assigned_recruiter_name": None,
                    "updated_at": now
                },
                "$push": {"status_history": history_item}
            }
        )

    updated = candidates_col.find_one({"_id": cand["_id"]})
    return serialize_doc(updated)

@router.get("/me", response_model=schemas.CandidateOut)
def get_my_candidate_profile(current_user: Dict[str, Any] = Depends(get_current_user)):
    candidates_col = get_candidates_collection()
    user_id = str(current_user.get("id"))
    candidate = candidates_col.find_one({"user_id": user_id})
    if not candidate:
        candidate = candidates_col.find_one({"email": current_user.get("email")})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate profile not found")
    return serialize_doc(candidate)

@router.put("/me", response_model=schemas.CandidateOut)
def update_my_candidate_profile(payload: schemas.CandidateUpdate, current_user: Dict[str, Any] = Depends(get_current_user)):
    candidates_col = get_candidates_collection()
    user_id = str(current_user.get("id"))
    candidate = candidates_col.find_one({"user_id": user_id})
    if not candidate:
        candidate = candidates_col.find_one({"email": current_user.get("email")})
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate profile not found")
    
    update_data = payload.model_dump(exclude_unset=True)
    # Security: Candidates cannot change their own recruitment status
    update_data.pop("status", None)
    update_data.pop("remarks", None)
    update_data.pop("status_history", None)
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    candidates_col.update_one({"_id": candidate["_id"]}, {"$set": update_data})
    updated = candidates_col.find_one({"_id": candidate["_id"]})
    return serialize_doc(updated)

@router.get("/{candidate_id}", response_model=schemas.CandidateOut)
def get_candidate(candidate_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    candidates_col = get_candidates_collection()
    query = build_id_query(candidate_id)
    candidate = candidates_col.find_one(query)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    user_role = current_user.get("role")
    if user_role in (models.UserRole.recruiter.value, "recruiter"):
        rec_id = str(current_user.get("id"))
        cand_rec = str(candidate.get("assigned_recruiter_id") or candidate.get("recruiter_id") or "")
        if cand_rec != rec_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You can only view candidates assigned to you.")
    elif user_role not in (models.UserRole.admin.value, "admin"):
        if str(candidate.get("user_id")) != str(current_user.get("id")) and candidate.get("email") != current_user.get("email"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            
    return serialize_doc(candidate)

@router.put("/{candidate_id}", response_model=schemas.CandidateOut)
def update_candidate(candidate_id: str, payload: schemas.CandidateUpdate, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    
    candidates_col = get_candidates_collection()
    query = build_id_query(candidate_id)
    
    existing = candidates_col.find_one(query)
    if not existing:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    update_data = payload.model_dump(exclude_unset=True)
    raw_new_status = update_data.get("status")
    old_status = existing.get("status", "applied")
    remarks = update_data.pop("remarks", None)
    now = datetime.now(timezone.utc)
    
    clean_new_status = raw_new_status.lower().strip() if raw_new_status else None
    clean_old_status = old_status.lower().strip()
    status_changed = bool(clean_new_status and clean_new_status != clean_old_status)
    
    is_admin = user_role in (models.UserRole.admin.value, "admin")
    if not is_admin:
        rec_id = str(current_user.get("id"))
        cand_rec = str(existing.get("assigned_recruiter_id") or existing.get("recruiter_id") or "")
        if cand_rec != rec_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You can only update candidates assigned to you.")
    
    if status_changed:
        # Standard recruitment lifecycle:
        # applied -> shortlisted -> scheduled -> interviewed -> selected / rejected
        ALLOWED_TRANSITIONS = {
            "applied": ["shortlisted", "rejected"],
            "shortlisted": ["scheduled", "rejected", "applied"],
            "scheduled": ["interviewed", "shortlisted", "rejected"],
            "interviewed": ["selected", "hired", "rejected", "scheduled"],
            "selected": ["hired", "rejected"],
            "hired": ["selected", "rejected"],
            "rejected": ["applied", "shortlisted"],  # Admin correction/reconsideration
        }
        
        # Non-admins must strictly adhere to the lifecycle
        if not is_admin:
            allowed = ALLOWED_TRANSITIONS.get(clean_old_status, [])
            if clean_new_status not in allowed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status transition from '{clean_old_status}' to '{clean_new_status}'. Allowed next stages: {', '.join(allowed)}."
                )

        # Requirement 6: Mandatory decision remarks when finalizing candidate selection or rejection
        if clean_new_status in ("selected", "hired", "rejected"):
            if not remarks or not remarks.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Mandatory decision remarks are required when finalizing candidate {clean_new_status.title()}."
                )
        
        update_data["status"] = clean_new_status
        history_entry = {
            "status": clean_new_status,
            "new_status": clean_new_status,
            "previous_status": clean_old_status,
            "updated_by": current_user.get("username", "recruiter"),
            "timestamp": now,
            "remarks": remarks or (
                f"Status administratively corrected from '{clean_old_status}' to '{clean_new_status}'."
                if is_admin and clean_new_status not in ALLOWED_TRANSITIONS.get(clean_old_status, [])
                else f"Status updated from '{clean_old_status}' to '{clean_new_status}'."
            )
        }
        mongo_update = {"$set": update_data, "$push": {"status_history": history_entry}}
    elif remarks:
        history_entry = {
            "status": clean_old_status,
            "new_status": clean_old_status,
            "previous_status": clean_old_status,
            "updated_by": current_user.get("username", "recruiter"),
            "timestamp": now,
            "remarks": remarks
        }
        mongo_update = {"$set": update_data, "$push": {"status_history": history_entry}}
    else:
        mongo_update = {"$set": update_data}
    
    update_data["updated_at"] = now
    candidates_col.update_one({"_id": existing["_id"]}, mongo_update)
    updated = candidates_col.find_one({"_id": existing["_id"]})
    
    # Emit role-scoped notifications on status change
    if status_changed:
        display_status = str(clean_new_status).replace("_", " ").title()
        cand_name = existing.get("name", "Candidate")
        
        # 1. Candidate notification
        if existing.get("user_id"):
            if clean_new_status in ("selected", "hired"):
                notif_title = "Congratulations! You have been Selected"
                notif_msg = f"We are pleased to inform you that you have been Selected! Remarks: {remarks or 'Recruitment completed successfully.'}"
                notif_type = "hiring_decision"
                notif_link = "application"
            elif clean_new_status == "rejected":
                notif_title = "Application Update: Decision Concluded"
                notif_msg = f"Thank you for interviewing with us. Your application status is now Closed. Remarks: {remarks or 'Application closed.'}"
                notif_type = "hiring_decision"
                notif_link = "application"
            elif clean_new_status == "shortlisted":
                notif_title = "Application Update: Shortlisted"
                notif_msg = f"Your application has been Shortlisted for an interview! Remarks: {remarks or 'Screening passed.'}"
                notif_type = "status_change"
                notif_link = "application"
            else:
                notif_title = f"Application Status: {display_status}"
                notif_msg = f"Your application status is now '{display_status}'. Remarks: {remarks or 'Stage progressed.'}"
                notif_type = "status_change"
                notif_link = "application"
                
            create_notification(
                title=notif_title,
                message=notif_msg,
                recipient_user_id=str(existing.get("user_id")),
                notification_type=notif_type,
                link_section=notif_link
            )
            
        # 2. Admin & Recruiter broadcast notifications
        admin_title = f"Status Update: {cand_name} -> {display_status}"
        admin_msg = f"{cand_name} marked as '{display_status}' by {current_user.get('username')}. Remarks: {remarks or 'Stage updated.'}"
        create_notification(
            title=admin_title,
            message=admin_msg,
            recipient_role="admin",
            notification_type="status_change",
            link_section="candidates"
        )
        create_notification(
            title=admin_title,
            message=admin_msg,
            recipient_role="recruiter",
            notification_type="status_change",
            link_section="candidates"
        )
        if existing.get("assigned_recruiter_id"):
            create_notification(
                title=admin_title,
                message=admin_msg,
                recipient_user_id=str(existing["assigned_recruiter_id"]),
                recipient_role="recruiter",
                notification_type="status_change",
                link_section="candidates"
            )
    
    return serialize_doc(updated)

@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(candidate_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")
    
    candidates_col = get_candidates_collection()
    query = build_id_query(candidate_id)
    
    result = candidates_col.delete_one(query)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return None
