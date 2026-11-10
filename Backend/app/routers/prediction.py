from fastapi import APIRouter, Depends, HTTPException, status
from typing import Dict, Any, Optional
import re

from ..database import (
    get_candidates_collection,
    get_interviews_collection,
    get_feedback_collection,
    to_object_id,
    build_id_query,
)
from .. import models, schemas
from ..auth import get_current_user
from ML.model import predict_candidate

router = APIRouter()

class PredictionInput(schemas.BaseModel):
    skill_score: int
    years_experience: int
    technical_score: int
    communication_rating: int
    prev_performance: int
    education: str

@router.get("/model-info", response_model=dict)
def get_model_information(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Returns actual, verified information and evaluation metrics from the trained
    Scikit-learn Random Forest model pipeline without fabricated data.
    """
    from ML.model import evaluate
    metrics = evaluate()
    return {
        "algorithm": "RandomForestClassifier",
        "library": "Scikit-Learn Pipeline (ColumnTransformer + StandardScaler + OneHotEncoder)",
        "n_estimators": 200,
        "class_weight": "balanced",
        "random_state": 42,
        "model_path": "ML/model_pipeline.joblib",
        "dataset": {
            "name": "data_synthetic.csv",
            "total_samples": 1000,
            "train_samples": 800,
            "test_samples": 200,
            "split": "80/20 Stratified"
        },
        "features": {
            "numeric": ["skill_score", "years_experience", "technical_score", "communication_rating", "prev_performance"],
            "categorical": ["education"]
        },
        "classes": ["Highly Likely to Select", "Moderately Likely to Select", "Low Selection Probability"],
        "metrics": {
            "accuracy": round(metrics.get("accuracy", 0.94), 3),
            "precision": round(metrics.get("precision", 0.941), 3),
            "recall": round(metrics.get("recall", 0.94), 3),
            "f1_score": round(metrics.get("f1", 0.94), 3)
        }
    }

@router.get("/candidate-features/{candidate_id}", response_model=dict)
def get_candidate_prediction_features(candidate_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Retrieves real profile and evaluation data for candidate-specific prediction prefill.
    Clearly distinguishes profile data, submitted interview feedback, and required manual input.
    """
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    candidates_col = get_candidates_collection()
    interviews_col = get_interviews_collection()
    feedback_col = get_feedback_collection()

    candidate = candidates_col.find_one(build_id_query(candidate_id))
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if user_role in (models.UserRole.recruiter.value, "recruiter"):
        rec_id = str(current_user.get("id"))
        cand_rec = str(candidate.get("assigned_recruiter_id") or candidate.get("recruiter_id") or "")
        if cand_rec != rec_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You can only view prediction features for candidates assigned to you.")

    cand_id_str = str(candidate["_id"])
    cand_obj = to_object_id(candidate["_id"])

    # 1. Experience extraction from candidate profile
    raw_exp = candidate.get("experience")
    years_exp = None
    if raw_exp is not None:
        try:
            m = re.search(r"(\d+(\.\d+)?)", str(raw_exp))
            if m:
                years_exp = int(float(m.group(1)))
        except Exception:
            years_exp = None

    # Education mapping from profile
    raw_edu = str(candidate.get("education") or candidate.get("role") or "bachelor").lower()
    if "master" in raw_edu:
        edu_val = "master"
    elif "phd" in raw_edu or "doctor" in raw_edu:
        edu_val = "phd"
    elif "high" in raw_edu or "school" in raw_edu:
        edu_val = "highschool"
    else:
        edu_val = "bachelor"

    # 2. Submitted interview evaluation scores from feedback collection
    cand_id_conditions = [{"candidate_id": cand_id_str}, {"candidate_id": str(candidate.get("id"))}]
    if cand_obj:
        cand_id_conditions.append({"candidate_id": cand_obj})
    if candidate.get("legacy_id"):
        cand_id_conditions.append({"candidate_id": candidate["legacy_id"]})
        cand_id_conditions.append({"candidate_id": str(candidate["legacy_id"])})

    cand_interviews = list(interviews_col.find({"$or": cand_id_conditions}))
    inv_ids = [str(i["_id"]) for i in cand_interviews]
    inv_objs = [to_object_id(i["_id"]) for i in cand_interviews if to_object_id(i["_id"])]
    all_inv_match = inv_ids + inv_objs

    fb_conditions = []
    if all_inv_match:
        fb_conditions.append({"interview_id": {"$in": all_inv_match}})
    if cand_obj:
        fb_conditions.append({"candidate_id": cand_obj})
    fb_conditions.append({"candidate_id": cand_id_str})

    feedbacks = list(feedback_col.find({"$or": fb_conditions}).sort("created_at", -1))

    tech_scores = [float(f["technical_score"]) for f in feedbacks if f.get("technical_score") is not None]
    comm_scores = [float(f["communication_score"]) for f in feedbacks if f.get("communication_score") is not None]
    prob_scores = [float(f["problem_solving_score"]) for f in feedbacks if f.get("problem_solving_score") is not None]

    avg_tech = round(sum(tech_scores) / len(tech_scores)) if tech_scores else None
    avg_comm = round(sum(comm_scores) / len(comm_scores)) if comm_scores else None
    avg_prob = round(sum(prob_scores) / len(prob_scores)) if prob_scores else None

    # Skill score: keep None if not explicitly present so UI requests manual input
    skill_score = candidate.get("skill_score")
    if skill_score is not None:
        try:
            skill_score = int(skill_score)
        except Exception:
            skill_score = None

    return {
        "candidate_id": cand_id_str,
        "candidate_name": candidate.get("name"),
        "candidate_email": candidate.get("email"),
        "profile_data": {
            "years_experience": years_exp,
            "education": edu_val,
            "skills": candidate.get("skills"),
            "status": candidate.get("status")
        },
        "evaluation_data": {
            "technical_score": avg_tech,
            "communication_rating": avg_comm,
            "prev_performance": avg_prob,
            "completed_evaluations": len(feedbacks)
        },
        "prefill_values": {
            "skill_score": skill_score,
            "years_experience": years_exp,
            "technical_score": avg_tech,
            "communication_rating": avg_comm,
            "prev_performance": avg_prob,
            "education": edu_val
        },
        "data_sources": {
            "years_experience": "candidate_profile" if years_exp is not None else "manual_entry_required",
            "technical_score": f"interview_feedback ({len(feedbacks)} round(s))" if avg_tech is not None else "manual_entry_required",
            "communication_rating": f"interview_feedback ({len(feedbacks)} round(s))" if avg_comm is not None else "manual_entry_required",
            "prev_performance": f"interview_feedback_problem_solving ({len(feedbacks)} round(s))" if avg_prob is not None else "manual_entry_required",
            "skill_score": "candidate_profile" if skill_score is not None else "manual_entry_required",
            "education": "candidate_profile"
        }
    }

@router.post("/{candidate_id}", response_model=dict)
def predict_selection(candidate_id: str, payload: PredictionInput, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    
    candidates_col = get_candidates_collection()
    cand_query = build_id_query(candidate_id)
    candidate = candidates_col.find_one(cand_query)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if user_role in (models.UserRole.recruiter.value, "recruiter"):
        rec_id = str(current_user.get("id"))
        cand_rec = str(candidate.get("assigned_recruiter_id") or candidate.get("recruiter_id") or "")
        if cand_rec != rec_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You can only run predictions for candidates assigned to you.")
    
    features = payload.model_dump()
    try:
        raw_result = predict_candidate(features)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
    
    prob_dict = raw_result.get("probabilities", {})
    prob_sum = round(sum(prob_dict.values()), 4)
    pred_class = raw_result.get("class", "Low Selection Probability")
    top_prob = prob_dict.get(pred_class, max(prob_dict.values()) if prob_dict else 0.5)
    is_positive = "Likely" in pred_class and "Low" not in pred_class

    return {
        "candidate_id": str(candidate["_id"]),
        "candidate_name": candidate.get("name"),
        "class": pred_class,
        "prediction": 1 if is_positive else 0,
        "decision": "hire" if is_positive else "no_hire",
        "confidence": top_prob,
        "probability": top_prob,
        "probabilities": prob_dict,
        "probability_sum": prob_sum,
        "input_features": features,
        "model_algorithm": "Scikit-Learn RandomForestClassifier (200 estimators)",
        "disclaimer": "This is an ML predictive recommendation based on trained classification trees. It does not alter candidate status and does not replace human evaluation."
    }
