from fastapi import APIRouter, Depends, HTTPException, status
from typing import Dict, Any

from ..database import get_candidates_collection, get_interviews_collection, get_feedback_collection, get_users_collection
from .. import schemas, models
from ..auth import get_current_user

router = APIRouter()

@router.get("/stats", response_model=schemas.DashboardStats)
def get_dashboard_stats(current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. Admin or Recruiter required.")

    candidates_col = get_candidates_collection()
    interviews_col = get_interviews_collection()
    feedback_col = get_feedback_collection()
    users_col = get_users_collection()

    if user_role in (models.UserRole.recruiter.value, "recruiter"):
        rec_id = str(current_user.get("id"))
        
        assigned_cands = list(candidates_col.find({"$or": [{"assigned_recruiter_id": rec_id}, {"recruiter_id": rec_id}]}))
        cand_ids = [str(c["_id"]) for c in assigned_cands] + [str(c.get("id")) for c in assigned_cands if c.get("id")]
        
        total_candidates = len(assigned_cands)
        applied_candidates = sum(1 for c in assigned_cands if (c.get("status") or "").lower() == "applied")
        shortlisted_candidates = sum(1 for c in assigned_cands if (c.get("status") or "").lower() == "shortlisted")
        selected_candidates = sum(1 for c in assigned_cands if (c.get("status") or "").lower() in ["selected", "hired"])
        rejected_candidates = sum(1 for c in assigned_cands if (c.get("status") or "").lower() == "rejected")
        
        rec_ints = list(interviews_col.find({"$or": [{"interviewer_id": rec_id}, {"evaluator_id": rec_id}, {"candidate_id": {"$in": cand_ids}}]}))
        scheduled_interviews = sum(1 for i in rec_ints if (i.get("status") or "").lower() == "scheduled")
        completed_interviews = sum(1 for i in rec_ints if (i.get("status") or "").lower() == "completed")
        
        completed_inv_ids = [str(i["_id"]) for i in rec_ints if (i.get("status") or "").lower() == "completed"]
        feedback_docs = list(feedback_col.find({"interview_id": {"$in": completed_inv_ids}}))
        evaluated_inv_ids = set(str(f.get("interview_id")) for f in feedback_docs)
        pending_feedback = len(completed_inv_ids) - len(evaluated_inv_ids)
        
        return schemas.DashboardStats(
            total_candidates=total_candidates,
            applied_candidates=applied_candidates,
            scheduled_interviews=scheduled_interviews,
            completed_interviews=completed_interviews,
            selected_candidates=selected_candidates,
            rejected_candidates=rejected_candidates,
            total_recruiters=1,
            upcoming_interviews=scheduled_interviews,
            pending_feedback=max(0, pending_feedback),
            shortlisted_candidates=shortlisted_candidates
        )

    # Admin system-wide statistics
    total_candidates = candidates_col.count_documents({})
    applied_candidates = candidates_col.count_documents({"status": "applied"})
    shortlisted_candidates = candidates_col.count_documents({"status": "shortlisted"})
    scheduled_interviews = interviews_col.count_documents({"status": "scheduled"})
    completed_interviews = interviews_col.count_documents({"status": "completed"})
    selected_candidates = candidates_col.count_documents({"status": {"$in": ["selected", "hired"]}})
    rejected_candidates = candidates_col.count_documents({"status": "rejected"})
    total_recruiters = users_col.count_documents({"role": {"$in": ["recruiter", "RECRUITER", "Recruiter"]}})

    completed_invs = list(interviews_col.find({"status": "completed"}))
    completed_ids = [str(i["_id"]) for i in completed_invs]
    fb_docs = list(feedback_col.find({"interview_id": {"$in": completed_ids}}))
    evaluated_ids = set(str(f.get("interview_id")) for f in fb_docs)
    pending_fb = max(0, len(completed_ids) - len(evaluated_ids))

    return schemas.DashboardStats(
        total_candidates=total_candidates,
        applied_candidates=applied_candidates,
        shortlisted_candidates=shortlisted_candidates,
        scheduled_interviews=scheduled_interviews,
        completed_interviews=completed_interviews,
        selected_candidates=selected_candidates,
        rejected_candidates=rejected_candidates,
        total_recruiters=total_recruiters,
        upcoming_interviews=scheduled_interviews,
        pending_feedback=pending_fb,
    )
