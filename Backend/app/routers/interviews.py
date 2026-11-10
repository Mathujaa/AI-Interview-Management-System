from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any
from datetime import datetime, timezone

from ..database import (
    get_interviews_collection,
    get_candidates_collection,
    get_feedback_collection,
    get_users_collection,
    serialize_doc,
    to_object_id,
    build_id_query
)
from .. import models, schemas
from ..auth import get_current_user
from .notifications import create_notification

router = APIRouter()

@router.post("/", response_model=schemas.InterviewOut, status_code=status.HTTP_201_CREATED)
def schedule_interview(interview: schemas.InterviewCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    
    # Verify candidate exists
    candidates_col = get_candidates_collection()
    cand_query = build_id_query(interview.candidate_id)
    candidate = candidates_col.find_one(cand_query)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    is_admin = user_role in (models.UserRole.admin.value, "admin")
    if not is_admin:
        cand_rec = str(candidate.get("assigned_recruiter_id") or candidate.get("recruiter_id") or "")
        if cand_rec != str(current_user.get("id")):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You can only schedule interviews for candidates assigned to you.")

    # Validate assigned evaluator (recruiter/admin role required, candidates strictly forbidden)
    users_col = get_users_collection()
    interviewer_id_to_store = None
    interviewer_name = "Assigned Recruiter"
    if not is_admin:
        interviewer_id_to_store = str(current_user.get("id"))
        interviewer_name = current_user.get("username", "Assigned Recruiter")
    elif interview.interviewer_id:
        interviewer = users_col.find_one(build_id_query(interview.interviewer_id))
        if not interviewer:
            raise HTTPException(status_code=400, detail="Assigned evaluator not found in user directory")
        evaluator_role = str(interviewer.get("role", "")).lower()
        if evaluator_role not in (models.UserRole.recruiter.value, models.UserRole.admin.value, "recruiter", "admin"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assigned evaluator must have a recruiter role. Candidate accounts cannot evaluate interviews."
            )
        interviewer_id_to_store = str(interviewer["_id"])
        interviewer_name = interviewer.get("username") or interviewer.get("name") or "Assigned Recruiter"
    else:
        # Default to current user (admin or recruiter)
        interviewer_id_to_store = str(current_user.get("id"))
        interviewer_name = current_user.get("username", "Assigned Recruiter")
    
    interviews_col = get_interviews_collection()
    cand_id_str = str(candidate["_id"])

    # Requirement 3: Prevent duplicate active interviews for the same candidate and round unless an existing interview is explicitly rescheduled.
    existing_active = interviews_col.find_one({
        "$or": [{"candidate_id": cand_id_str}, {"candidate_id": str(interview.candidate_id)}],
        "round": interview.round,
        "status": {"$in": ["scheduled", "in_progress", "pending"]}
    })
    if existing_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"An active Round {interview.round} interview is already scheduled for candidate '{candidate.get('name')}'. Please reschedule or complete the existing interview."
        )

    now = datetime.now(timezone.utc)
    new_doc = {
        "candidate_id": cand_id_str,
        "interviewer_id": interviewer_id_to_store,
        "evaluator_id": interviewer_id_to_store,
        "created_by": str(current_user.get("id")),
        "scheduled_at": interview.scheduled_at,
        "round": interview.round,
        "status": "scheduled",
        "created_at": now,
        "updated_at": now,
    }
    result = interviews_col.insert_one(new_doc)
    new_doc["_id"] = result.inserted_id

    # Automatically synchronize candidate status to "scheduled" if applied or shortlisted
    old_cand_status = candidate.get("status", "applied")
    if old_cand_status in ("applied", "shortlisted"):
        formatted_date = interview.scheduled_at.strftime('%Y-%m-%d %H:%M') if hasattr(interview.scheduled_at, 'strftime') else str(interview.scheduled_at)
        history_item = {
            "status": "scheduled",
            "new_status": "scheduled",
            "previous_status": old_cand_status,
            "updated_by": current_user.get("username", "recruiter"),
            "timestamp": now,
            "remarks": f"Round {interview.round} scheduled for {formatted_date} with evaluator '{interviewer_name}'."
        }
        candidates_col.update_one(
            {"_id": candidate["_id"]},
            {
                "$set": {"status": "scheduled", "updated_at": now},
                "$push": {"status_history": history_item}
            }
        )

    # Notifications
    time_str = interview.scheduled_at.strftime('%b %d, %Y at %I:%M %p') if hasattr(interview.scheduled_at, 'strftime') else str(interview.scheduled_at)
    cand_name = candidate.get("name", "Candidate")
    
    if candidate.get("user_id"):
        create_notification(
            title=f"Interview Scheduled: Round {interview.round}",
            message=f"Your Round {interview.round} interview is scheduled for {time_str}.",
            recipient_user_id=str(candidate.get("user_id")),
            notification_type="interview",
            link_section="interviews"
        )
    
    create_notification(
        title=f"Interview Scheduled: {cand_name}",
        message=f"{cand_name} scheduled for Round {interview.round} on {time_str} (Evaluator: {interviewer_name}).",
        recipient_role="admin",
        notification_type="interview",
        link_section="interviews"
    )
    
    # Notify specific assigned evaluator
    if interviewer_id_to_store:
        create_notification(
            title=f"Interview Assigned: Round {interview.round}",
            message=f"You are assigned to evaluate {cand_name} for Round {interview.round} on {time_str}.",
            recipient_user_id=interviewer_id_to_store,
            recipient_role="recruiter",
            notification_type="interview",
            link_section="interviews"
        )
    else:
        create_notification(
            title=f"Interview Scheduled: {cand_name}",
            message=f"{cand_name} scheduled for Round {interview.round} on {time_str} (Evaluator: {interviewer_name}).",
            recipient_role="recruiter",
            notification_type="interview",
            link_section="interviews"
        )

    new_doc["interviewer_name"] = interviewer_name
    new_doc["has_feedback"] = False
    return serialize_doc(new_doc)

@router.get("/my-interviews", response_model=List[schemas.InterviewOut])
def get_my_interviews(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Candidate self-service endpoint: retrieves only interviews scheduled for the authenticated candidate.
    Enriched with interviewer_name and has_feedback boolean.
    """
    candidates_col = get_candidates_collection()
    user_id = str(current_user.get("id"))
    cand = candidates_col.find_one({"user_id": user_id})
    if not cand:
        cand = candidates_col.find_one({"email": current_user.get("email")})
    if not cand:
        return []
    
    interviews_col = get_interviews_collection()
    users_col = get_users_collection()
    feedback_col = get_feedback_collection()
    
    cand_id_str = str(cand["_id"])
    interviews = list(interviews_col.find({
        "$or": [{"candidate_id": cand_id_str}, {"candidate_id": str(cand.get("id"))}]
    }).sort("scheduled_at", 1))

    user_cache = {}
    enriched = []
    for i in interviews:
        inv_id = str(i["_id"])
        interviewer_id = i.get("interviewer_id")
        if interviewer_id:
            if interviewer_id not in user_cache:
                u = users_col.find_one(build_id_query(interviewer_id))
                user_cache[interviewer_id] = (u.get("username") or u.get("name") or "Assigned Recruiter") if u else "Assigned Recruiter"
            i["interviewer_name"] = user_cache[interviewer_id]
        else:
            i["interviewer_name"] = "Assigned Recruiter"

        fb = feedback_col.find_one({"$or": [{"interview_id": inv_id}, {"interview_id": str(i.get("id"))}]})
        i["has_feedback"] = bool(fb)
        enriched.append(serialize_doc(i))

    return enriched

@router.get("/", response_model=List[schemas.InterviewOut])
def list_interviews(skip: int = 0, limit: int = 100, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    interviews_col = get_interviews_collection()
    query: Dict[str, Any] = {}
    if user_role in (models.UserRole.recruiter.value, "recruiter"):
        rec_id = str(current_user.get("id"))
        candidates_col = get_candidates_collection()
        assigned_cands = list(candidates_col.find({"$or": [{"assigned_recruiter_id": rec_id}, {"recruiter_id": rec_id}]}))
        cand_ids = [str(c["_id"]) for c in assigned_cands] + [str(c.get("id")) for c in assigned_cands if c.get("id")]
        query = {
            "$or": [
                {"interviewer_id": rec_id},
                {"evaluator_id": rec_id},
                {"candidate_id": {"$in": cand_ids}}
            ]
        }
    
    interviews = list(interviews_col.find(query).sort("scheduled_at", -1).skip(skip).limit(limit))
    return [serialize_doc(i) for i in interviews]

@router.get("/{interview_id}", response_model=schemas.InterviewOut)
def get_interview(interview_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    interviews_col = get_interviews_collection()
    query = build_id_query(interview_id)
    interview = interviews_col.find_one(query)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    
    user_role = current_user.get("role")
    if user_role in (models.UserRole.recruiter.value, "recruiter"):
        rec_id = str(current_user.get("id"))
        int_interviewer = str(interview.get("interviewer_id") or interview.get("evaluator_id") or "")
        candidates_col = get_candidates_collection()
        cand = candidates_col.find_one(build_id_query(interview.get("candidate_id")))
        cand_rec = str(cand.get("assigned_recruiter_id") or cand.get("recruiter_id") or "") if cand else ""
        if int_interviewer != rec_id and cand_rec != rec_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. This interview is not assigned to you.")
    elif user_role not in (models.UserRole.admin.value, "admin"):
        # Check if this candidate owns the interview
        candidates_col = get_candidates_collection()
        user_id = str(current_user.get("id"))
        cand = candidates_col.find_one({"user_id": user_id})
        if not cand or str(cand["_id"]) != str(interview.get("candidate_id")):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            
    return serialize_doc(interview)

@router.put("/{interview_id}", response_model=schemas.InterviewOut)
def update_interview(interview_id: str, payload: schemas.InterviewUpdate, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    
    interviews_col = get_interviews_collection()
    query = build_id_query(interview_id)
    
    existing = interviews_col.find_one(query)
    if not existing:
        raise HTTPException(status_code=404, detail="Interview not found")

    is_admin = user_role in (models.UserRole.admin.value, "admin")
    if not is_admin:
        rec_id = str(current_user.get("id"))
        int_interviewer = str(existing.get("interviewer_id") or existing.get("evaluator_id") or "")
        candidates_col = get_candidates_collection()
        cand = candidates_col.find_one(build_id_query(existing.get("candidate_id")))
        cand_rec = str(cand.get("assigned_recruiter_id") or cand.get("recruiter_id") or "") if cand else ""
        if int_interviewer != rec_id and cand_rec != rec_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You can only update interviews assigned to you.")
    
    update_data = payload.model_dump(exclude_unset=True)
    now = datetime.now(timezone.utc)
    update_data["updated_at"] = now
    
    old_status = existing.get("status", "scheduled")
    new_status = update_data.get("status")
    old_time = existing.get("scheduled_at")
    new_time = update_data.get("scheduled_at")
    
    interviews_col.update_one({"_id": existing["_id"]}, {"$set": update_data})
    updated = interviews_col.find_one({"_id": existing["_id"]})
    
    # Handle rescheduling event
    if new_time and str(new_time) != str(old_time):
        candidates_col = get_candidates_collection()
        candidate = candidates_col.find_one(build_id_query(existing.get("candidate_id")))
        cand_name = candidate.get("name") if candidate else "Candidate"
        round_name = f"Round {existing.get('round', 1)}"
        new_time_str = new_time.strftime('%b %d, %Y at %I:%M %p') if hasattr(new_time, 'strftime') else str(new_time)
        
        if candidate and candidate.get("user_id"):
            create_notification(
                title=f"Interview Rescheduled: {round_name}",
                message=f"Your {round_name} interview has been rescheduled to {new_time_str}.",
                recipient_user_id=str(candidate.get("user_id")),
                notification_type="interview",
                link_section="interviews"
            )
        evaluator_id = existing.get("evaluator_id") or existing.get("interviewer_id")
        if evaluator_id:
            create_notification(
                title=f"Interview Rescheduled: {cand_name}",
                message=f"{round_name} for {cand_name} has been rescheduled to {new_time_str}.",
                recipient_user_id=str(evaluator_id),
                recipient_role="recruiter",
                notification_type="interview",
                link_section="interviews"
            )
        create_notification(
            title=f"Interview Rescheduled: {cand_name}",
            message=f"{round_name} for {cand_name} rescheduled to {new_time_str} by {current_user.get('username')}.",
            recipient_role="admin",
            notification_type="interview",
            link_section="interviews"
        )
    
    interviews_col.update_one({"_id": existing["_id"]}, {"$set": update_data})
    updated = interviews_col.find_one({"_id": existing["_id"]})
    
    # Handle status change events
    if new_status and new_status != old_status:
        candidates_col = get_candidates_collection()
        candidate = candidates_col.find_one(build_id_query(existing.get("candidate_id")))
        cand_name = candidate.get("name") if candidate else "Candidate"
        round_name = f"Round {existing.get('round', 1)}"

        if new_status == "completed":
            # Check remaining scheduled interviews for this candidate
            remaining_scheduled = interviews_col.count_documents({
                "candidate_id": str(existing.get("candidate_id")),
                "_id": {"$ne": existing["_id"]},
                "status": "scheduled"
            })
            
            # If all rounds are completed, and candidate is still in "scheduled", update candidate to "interviewed"
            if candidate and remaining_scheduled == 0 and candidate.get("status") == "scheduled":
                history_item = {
                    "status": "interviewed",
                    "new_status": "interviewed",
                    "previous_status": "scheduled",
                    "updated_by": current_user.get("username", "recruiter"),
                    "timestamp": now,
                    "remarks": f"Interview {round_name} marked as completed. All scheduled interview sessions concluded."
                }
                candidates_col.update_one(
                    {"_id": candidate["_id"]},
                    {
                        "$set": {"status": "interviewed", "updated_at": now},
                        "$push": {"status_history": history_item}
                    }
                )
            
            # Notifications
            if candidate and candidate.get("user_id"):
                create_notification(
                    title=f"Interview Completed: {round_name}",
                    message=f"Your {round_name} session has concluded. Feedback evaluation is being processed.",
                    recipient_user_id=str(candidate.get("user_id")),
                    notification_type="interview",
                    link_section="interviews"
                )
            create_notification(
                title=f"Interview Completed: {cand_name}",
                message=f"{round_name} for {cand_name} marked as completed by {current_user.get('username')}.",
                recipient_role="admin",
                notification_type="interview",
                link_section="interviews"
            )

        elif new_status == "cancelled":
            if candidate and candidate.get("user_id"):
                create_notification(
                    title=f"Interview Cancelled: {round_name}",
                    message=f"Your {round_name} session has been cancelled. Our team will contact you regarding rescheduling.",
                    recipient_user_id=str(candidate.get("user_id")),
                    notification_type="interview",
                    link_section="interviews"
                )
            create_notification(
                title=f"Interview Cancelled: {cand_name}",
                message=f"{round_name} for {cand_name} was cancelled by {current_user.get('username')}.",
                recipient_role="admin",
                notification_type="interview",
                link_section="interviews"
            )

    # Enrich response
    users_col = get_users_collection()
    feedback_col = get_feedback_collection()
    interviewer_id = updated.get("interviewer_id")
    if interviewer_id:
        u = users_col.find_one(build_id_query(interviewer_id))
        updated["interviewer_name"] = (u.get("username") or u.get("name") or "Assigned Recruiter") if u else "Assigned Recruiter"
    else:
        updated["interviewer_name"] = "Assigned Recruiter"
        
    fb = feedback_col.find_one({"$or": [{"interview_id": str(updated["_id"])}, {"interview_id": str(updated.get("id"))}]})
    updated["has_feedback"] = bool(fb)
    
    return serialize_doc(updated)

@router.delete("/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview(interview_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")
    
    interviews_col = get_interviews_collection()
    query = build_id_query(interview_id)
    
    result = interviews_col.delete_one(query)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Interview not found")
    return None
