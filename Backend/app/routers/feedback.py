from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any
from datetime import datetime, timezone

from ..database import (
    get_feedback_collection,
    get_interviews_collection,
    get_candidates_collection,
    get_users_collection,
    serialize_doc,
    to_object_id,
    build_id_query,
)
from .. import models, schemas
from ..auth import get_current_user
from .notifications import create_notification

router = APIRouter()

@router.post("/", response_model=schemas.FeedbackOut, status_code=status.HTTP_201_CREATED)
def submit_feedback(feedback: schemas.FeedbackCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter", "interviewer"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    
    is_admin = user_role in (models.UserRole.admin.value, "admin")
    if is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin accounts cannot submit interview feedback. Feedback submission is strictly restricted to assigned recruiters."
        )

    interviews_col = get_interviews_collection()
    inv_query = build_id_query(feedback.interview_id)
    interview = interviews_col.find_one(inv_query)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    # Recruiter verification
    user_id_str = str(current_user.get("id"))
    evaluator_id_str = str(interview.get("evaluator_id") or interview.get("interviewer_id") or "")
    candidates_col = get_candidates_collection()
    cand = candidates_col.find_one(build_id_query(interview.get("candidate_id")))
    cand_rec = str(cand.get("assigned_recruiter_id") or cand.get("recruiter_id") or "") if cand else ""
    if evaluator_id_str != user_id_str and cand_rec != user_id_str:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only the assigned evaluator may submit feedback for this interview."
        )
    
    feedback_col = get_feedback_collection()
    norm_inv_id = str(interview["_id"])
    existing = feedback_col.find_one({"interview_id": norm_inv_id})
    if existing:
        raise HTTPException(status_code=400, detail="Feedback already submitted for this interview")
    
    now = datetime.now(timezone.utc)
    new_doc = {
        "interview_id": norm_inv_id,
        "candidate_id": str(interview.get("candidate_id") or ""),
        "evaluator_id": user_id_str,
        "technical_score": feedback.technical_score,
        "communication_score": feedback.communication_score,
        "problem_solving_score": feedback.problem_solving_score,
        "strengths": feedback.strengths,
        "weaknesses": feedback.weaknesses,
        "comments": feedback.comments,
        "created_at": now,
        "updated_at": now,
    }
    result = feedback_col.insert_one(new_doc)
    new_doc["_id"] = result.inserted_id

    # Automatically mark interview as completed
    interviews_col.update_one(
        {"_id": interview["_id"]},
        {"$set": {"status": "completed", "updated_at": now}}
    )

    # Synchronize candidate status to "interviewed" if all scheduled rounds are complete
    cand_id = interview.get("candidate_id")
    if cand_id:
        candidates_col = get_candidates_collection()
        candidate = candidates_col.find_one(build_id_query(cand_id))
        
        remaining_scheduled = interviews_col.count_documents({
            "candidate_id": str(interview["candidate_id"]),
            "_id": {"$ne": interview["_id"]},
            "status": "scheduled"
        })
        
        if candidate and candidate.get("status") not in ("selected", "rejected", "hired"):
            old_cand_status = candidate.get("status", "scheduled")
            round_label = f"Round {interview.get('round', 1)}"
            
            if remaining_scheduled == 0:
                # All rounds finished -> candidate is now fully interviewed
                history_item = {
                    "status": "interviewed",
                    "new_status": "interviewed",
                    "previous_status": old_cand_status,
                    "updated_by": current_user.get("username", "recruiter"),
                    "timestamp": now,
                    "remarks": f"Interview {round_label} feedback recorded. All scheduled rounds concluded."
                }
                candidates_col.update_one(
                    {"_id": candidate["_id"]},
                    {
                        "$set": {"status": "interviewed", "updated_at": now},
                        "$push": {"status_history": history_item}
                    }
                )
                if candidate.get("user_id"):
                    create_notification(
                        title=f"Interview Evaluated: {round_label}",
                        message=f"Evaluation feedback for {round_label} has been recorded. Application status updated to 'Interviewed'.",
                        recipient_user_id=str(candidate.get("user_id")),
                        notification_type="feedback",
                        link_section="feedback"
                    )
            else:
                # More rounds remain scheduled -> record history but do not advance lifecycle prematurely
                history_item = {
                    "status": old_cand_status,
                    "new_status": old_cand_status,
                    "previous_status": old_cand_status,
                    "updated_by": current_user.get("username", "recruiter"),
                    "timestamp": now,
                    "remarks": f"Interview {round_label} feedback recorded. {remaining_scheduled} additional round(s) pending."
                }
                candidates_col.update_one(
                    {"_id": candidate["_id"]},
                    {
                        "$set": {"updated_at": now},
                        "$push": {"status_history": history_item}
                    }
                )
                if candidate.get("user_id"):
                    create_notification(
                        title=f"Feedback Recorded: {round_label}",
                        message=f"Evaluation feedback for {round_label} has been recorded.",
                        recipient_user_id=str(candidate.get("user_id")),
                        notification_type="feedback",
                        link_section="feedback"
                    )

            # Notify Admin
            create_notification(
                title=f"Feedback Submitted: {candidate.get('name')}",
                message=f"Feedback for {round_label} recorded for {candidate.get('name')} by {current_user.get('username')}.",
                recipient_role="admin",
                notification_type="feedback",
                link_section="feedback"
            )

    return serialize_doc(new_doc)

@router.get("/my-feedback", response_model=List[Dict[str, Any]])
def get_my_feedback(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Candidate self-service endpoint: retrieves all submitted interview feedback records
    for the authenticated candidate across all interview rounds.
    """
    candidates_col = get_candidates_collection()
    user_id = str(current_user.get("id"))
    user_obj_id = to_object_id(user_id)
    
    cand_user_query = [{"user_id": user_id}, {"email": current_user.get("email")}]
    if user_obj_id:
        cand_user_query.append({"user_id": user_obj_id})

    cand = candidates_col.find_one({"$or": cand_user_query})
    if not cand:
        return []
    
    interviews_col = get_interviews_collection()
    feedback_col = get_feedback_collection()
    
    cand_id_str = str(cand["_id"])
    cand_obj_id = to_object_id(cand["_id"])
    
    cand_id_conditions = [{"candidate_id": cand_id_str}, {"candidate_id": str(cand.get("id"))}]
    if cand_obj_id:
        cand_id_conditions.append({"candidate_id": cand_obj_id})
    if cand.get("legacy_id"):
        cand_id_conditions.append({"candidate_id": cand["legacy_id"]})
        cand_id_conditions.append({"candidate_id": str(cand["legacy_id"])})

    cand_interviews = list(interviews_col.find({"$or": cand_id_conditions}))
    
    inv_ids = [str(i["_id"]) for i in cand_interviews]
    inv_objs = [to_object_id(i["_id"]) for i in cand_interviews if to_object_id(i["_id"])]
    all_inv_match = inv_ids + inv_objs
    
    round_map = {}
    for i in cand_interviews:
        r_val = i.get("round", 1)
        round_map[str(i["_id"])] = r_val
        if to_object_id(i["_id"]):
            round_map[str(to_object_id(i["_id"]))] = r_val

    fb_conditions = []
    if all_inv_match:
        fb_conditions.append({"interview_id": {"$in": all_inv_match}})
    # Also match if feedback record directly contains candidate_id
    if cand_obj_id:
        fb_conditions.append({"candidate_id": cand_obj_id})
    fb_conditions.append({"candidate_id": cand_id_str})

    feedbacks = list(feedback_col.find({"$or": fb_conditions}).sort("created_at", -1))
    results = []
    for f in feedbacks:
        s = serialize_doc(f)
        s_inv_id = str(s.get("interview_id", ""))
        s["round"] = round_map.get(s_inv_id, s.get("round", 1))
        # Ensure scores are cleanly cast to numbers if present
        for score_key in ["technical_score", "communication_score", "problem_solving_score"]:
            if score_key in s and s[score_key] is not None:
                try:
                    s[score_key] = float(s[score_key]) if "." in str(s[score_key]) else int(s[score_key])
                except (ValueError, TypeError):
                    pass
        results.append(s)
    return results

@router.get("/interview/{interview_id}", response_model=schemas.FeedbackOut)
def get_feedback(interview_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    feedback_col = get_feedback_collection()
    interviews_col = get_interviews_collection()
    interview = interviews_col.find_one(build_id_query(interview_id))
    
    inv_ids = [str(interview_id)]
    if interview:
        inv_ids.append(str(interview["_id"]))
        
    feedback = feedback_col.find_one({"interview_id": {"$in": inv_ids}})
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    
    # Candidate check
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter", "interviewer"):
        candidates_col = get_candidates_collection()
        user_id = str(current_user.get("id"))
        cand = candidates_col.find_one({"user_id": user_id})
        if not cand or not interview or str(cand["_id"]) != str(interview.get("candidate_id")):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            
    return serialize_doc(feedback)

@router.get("/", response_model=List[schemas.FeedbackOut])
def list_feedback(skip: int = 0, limit: int = 100, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter", "interviewer"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    feedback_col = get_feedback_collection()
    interviews_col = get_interviews_collection()
    candidates_col = get_candidates_collection()
    users_col = get_users_collection()

    query: Dict[str, Any] = {}
    if user_role in (models.UserRole.recruiter.value, "recruiter"):
        rec_id = str(current_user.get("id"))
        assigned_cands = list(candidates_col.find({"$or": [{"assigned_recruiter_id": rec_id}, {"recruiter_id": rec_id}]}))
        cand_ids = [str(c["_id"]) for c in assigned_cands] + [str(c.get("id")) for c in assigned_cands if c.get("id")]
        rec_ints = list(interviews_col.find({"$or": [{"interviewer_id": rec_id}, {"evaluator_id": rec_id}, {"candidate_id": {"$in": cand_ids}}]}))
        inv_ids = [str(i["_id"]) for i in rec_ints] + [str(i.get("id")) for i in rec_ints if i.get("id")]
        rec_conditions = [{"evaluator_id": rec_id}]
        if inv_ids:
            rec_conditions.append({"interview_id": {"$in": inv_ids}})
        query = {"$or": rec_conditions}

    feedbacks = list(feedback_col.find(query).sort("created_at", -1).skip(skip).limit(limit))
    
    interview_cache = {}
    candidate_cache = {}
    user_cache = {}
    enriched = []

    for f in feedbacks:
        inv_id = str(f.get("interview_id"))
        if inv_id and inv_id not in interview_cache:
            interview_cache[inv_id] = interviews_col.find_one(build_id_query(inv_id))
        inv = interview_cache.get(inv_id)

        cand_name = "Candidate"
        cand_email = "—"
        round_num = 1
        evaluator_name = "Recruiter"

        if inv:
            round_num = inv.get("round", 1)
            cand_id = str(inv.get("candidate_id"))
            if cand_id and cand_id not in candidate_cache:
                candidate_cache[cand_id] = candidates_col.find_one(build_id_query(cand_id))
            cand = candidate_cache.get(cand_id)
            if cand:
                cand_name = cand.get("name", "Candidate")
                cand_email = cand.get("email", "—")

            eval_id = str(inv.get("evaluator_id") or inv.get("interviewer_id") or "")
            if eval_id and eval_id not in user_cache:
                user_cache[eval_id] = users_col.find_one(build_id_query(eval_id))
            usr = user_cache.get(eval_id)
            if usr:
                evaluator_name = usr.get("username") or usr.get("name") or "Recruiter"

        f["candidate_name"] = cand_name
        f["candidate_email"] = cand_email
        f["round"] = round_num
        f["evaluator_name"] = evaluator_name
        enriched.append(serialize_doc(f))

    return enriched

@router.put("/{feedback_id}", response_model=schemas.FeedbackOut)
def update_feedback(feedback_id: str, payload: schemas.FeedbackUpdate, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter", "interviewer"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    is_admin = user_role in (models.UserRole.admin.value, "admin")
    if is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin accounts cannot edit interview feedback. Feedback editing is strictly restricted to the assigned recruiter."
        )

    feedback_col = get_feedback_collection()
    query = build_id_query(feedback_id)
    fb = feedback_col.find_one(query)
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback not found")

    interviews_col = get_interviews_collection()
    interview = interviews_col.find_one(build_id_query(fb.get("interview_id")))
    if not interview:
        raise HTTPException(status_code=404, detail="Associated interview not found")

    user_id_str = str(current_user.get("id"))
    evaluator_id_str = str(interview.get("evaluator_id") or interview.get("interviewer_id") or "")

    candidates_col = get_candidates_collection()
    cand = candidates_col.find_one(build_id_query(interview.get("candidate_id")))
    cand_rec = str(cand.get("assigned_recruiter_id") or cand.get("recruiter_id") or "") if cand else ""
    if evaluator_id_str != user_id_str and cand_rec != user_id_str:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only the assigned evaluator may edit feedback for this interview."
        )

    update_data = payload.model_dump(exclude_unset=True)
    update_data["updated_at"] = datetime.now(timezone.utc)
    feedback_col.update_one({"_id": fb["_id"]}, {"$set": update_data})
    updated = feedback_col.find_one({"_id": fb["_id"]})
    return serialize_doc(updated)
