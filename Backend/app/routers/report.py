import os
import json
import requests
from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta

from ..database import (
    get_reports_collection,
    get_candidates_collection,
    get_interviews_collection,
    get_feedback_collection,
    serialize_doc,
    to_object_id,
    build_id_query,
)
from .. import models, schemas
from ..auth import get_current_user
from ..config import settings
from .notifications import create_notification
from ..services import gemini_service

router = APIRouter()

@router.post("/generate-report/{candidate_id}", response_model=schemas.ReportOut, status_code=status.HTTP_201_CREATED)
def generate_report(candidate_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
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
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You can only generate reports for candidates assigned to you.")
    
    norm_cand_id = str(candidate["_id"])

    # Fetch interviews and feedback for this candidate
    interviews_col = get_interviews_collection()
    feedback_col = get_feedback_collection()

    interviews = list(interviews_col.find({
        "$or": [{"candidate_id": norm_cand_id}, {"candidate_id": str(candidate_id)}]
    }))

    feedbacks = []
    for inv in interviews:
        inv_id_str = str(inv["_id"])
        fb = feedback_col.find_one({
            "$or": [{"interview_id": inv_id_str}, {"interview_id": str(inv.get("id"))}]
        })
        if fb:
            feedbacks.append(fb)

    # Also search by candidate_id if no feedback found through interviews
    if not feedbacks:
        cand_fb_query = [{"candidate_id": norm_cand_id}, {"candidate_id": str(candidate_id)}]
        if candidate.get("legacy_id"):
            cand_fb_query.append({"candidate_id": candidate["legacy_id"]})
            cand_fb_query.append({"candidate_id": str(candidate["legacy_id"])})
        try:
            direct_fbs = list(feedback_col.find({"$or": cand_fb_query}))
            if direct_fbs:
                feedbacks.extend(direct_fbs)
        except Exception:
            pass

    if not feedbacks:
        # When no feedback scorecards exist: do not call Gemini to avoid hallucination.
        # Synthesize clean Pending Evaluation report with null scores, no fake strengths/weaknesses.
        report_content = {
            "candidate_name": candidate.get("name"),
            "candidate_email": candidate.get("email"),
            "overall_status": candidate.get("status", "applied"),
            "interviews_evaluated": len(interviews),
            "completed_evaluations": 0,
            "average_scores": {
                "technical": None,
                "communication": None,
                "problem_solving": None
            },
            "overall_score": None,
            "overall_percentage": None,
            "strengths": [],
            "growth_areas": [],
            "recommendation": "Pending Evaluation",
            "executive_summary": f"Evaluation for {candidate.get('name')} is pending. No interview feedback has been recorded yet. Scores and insights will appear after interview completion.",
            "ai_provider": "Deterministic System Synthesis (Local Fallback)"
        }
    else:
        # Calculate ground-truth numerical score averages strictly from verified MongoDB feedback records
        tech_scores = [float(f["technical_score"]) for f in feedbacks if f.get("technical_score") is not None]
        comm_scores = [float(f["communication_score"]) for f in feedbacks if f.get("communication_score") is not None]
        prob_scores = [float(f["problem_solving_score"]) for f in feedbacks if f.get("problem_solving_score") is not None]

        avg_tech = round(sum(tech_scores) / len(tech_scores), 1) if tech_scores else None
        avg_comm = round(sum(comm_scores) / len(comm_scores), 1) if comm_scores else None
        avg_prob = round(sum(prob_scores) / len(prob_scores), 1) if prob_scores else None

        valid_avgs = [a for a in [avg_tech, avg_comm, avg_prob] if a is not None]
        overall_avg = round(sum(valid_avgs) / len(valid_avgs), 1) if valid_avgs else None
        overall_percent = round((overall_avg / 10.0) * 100) if overall_avg is not None else None

        # Determine objective recommendation bracket based strictly on actual scores
        if overall_avg is None:
            baseline_rec = "Pending Evaluation"
        elif overall_avg >= 8.0 and (avg_tech is None or avg_tech >= 7.5):
            baseline_rec = "Strong Hire"
        elif overall_avg >= 6.0:
            baseline_rec = "Recommended"
        elif overall_avg >= 4.0:
            baseline_rec = "Under Review"
        else:
            baseline_rec = "Needs Improvement"

        ground_truth = {
            "avg_tech": avg_tech,
            "avg_comm": avg_comm,
            "avg_prob": avg_prob,
            "overall_avg": overall_avg,
            "overall_pct": overall_percent,
            "recommendation": baseline_rec
        }

        # Attempt Google Gemini LLM synthesis
        gemini_result = None
        try:
            gemini_result = gemini_service.generate_candidate_evaluation_report(
                candidate, interviews, feedbacks, ground_truth
            )
        except Exception as e:
            gemini_result = None

        if gemini_result:
            report_content = {
                "candidate_name": candidate.get("name"),
                "candidate_email": candidate.get("email"),
                "overall_status": candidate.get("status", "applied"),
                "interviews_evaluated": len(interviews),
                "completed_evaluations": len(feedbacks),
                "average_scores": {
                    "technical": avg_tech,
                    "communication": avg_comm,
                    "problem_solving": avg_prob
                },
                "overall_score": overall_avg,
                "overall_percentage": overall_percent,
                "strengths": gemini_result.get("strengths", []),
                "growth_areas": gemini_result.get("growth_areas", []),
                "recommendation": gemini_result.get("recommendation", baseline_rec),
                "executive_summary": gemini_result.get("executive_summary", ""),
                "ai_provider": gemini_result.get("ai_provider", f"Google Gemini ({settings.GEMINI_MODEL})")
            }
        else:
            # Seamless deterministic local fallback
            strengths_list = [f.get("strengths") for f in feedbacks if f.get("strengths")]
            weaknesses_list = [f.get("weaknesses") for f in feedbacks if f.get("weaknesses")]

            report_content = {
                "candidate_name": candidate.get("name"),
                "candidate_email": candidate.get("email"),
                "overall_status": candidate.get("status", "applied"),
                "interviews_evaluated": len(interviews),
                "completed_evaluations": len(feedbacks),
                "average_scores": {
                    "technical": avg_tech,
                    "communication": avg_comm,
                    "problem_solving": avg_prob
                },
                "overall_score": overall_avg,
                "overall_percentage": overall_percent,
                "strengths": strengths_list if strengths_list else ["Demonstrated core competence and domain understanding across interview rounds."],
                "growth_areas": weaknesses_list if weaknesses_list else ["Continue expanding domain depth and advanced problem exploration."],
                "recommendation": baseline_rec,
                "executive_summary": f"Evaluation summary for {candidate.get('name')} based on {len(feedbacks)} completed interview evaluation(s). Overall Score: {overall_avg if overall_avg is not None else 'Pending'}/10 ({overall_percent if overall_percent is not None else 0}%). Final recommendation: {baseline_rec}.",
                "ai_provider": "Deterministic System Synthesis (Local Fallback)"
            }

    now = datetime.now(timezone.utc)
    reports_col = get_reports_collection()
    report_doc = {
        "candidate_id": norm_cand_id,
        "content": report_content,
        "created_at": now,
    }
    result = reports_col.insert_one(report_doc)
    report_doc["_id"] = result.inserted_id

    # Send Notification to Candidate
    if candidate.get("user_id"):
        create_notification(
            title="Interview Report Generated",
            message=f"Your recruitment evaluation report is ready. Recommendation: {report_content.get('recommendation') if isinstance(report_content, dict) else 'Generated'}.",
            recipient_user_id=str(candidate.get("user_id")),
            notification_type="report",
            link_section="feedback"
        )

    # Send Notification to Admin
    create_notification(
        title=f"AI Report Generated: {candidate.get('name')}",
        message=f"Evaluation report generated for {candidate.get('name')}.",
        recipient_role="admin",
        notification_type="report",
        link_section="reports"
    )

    # Send Notification to Assigned Recruiter
    if candidate.get("assigned_recruiter_id"):
        create_notification(
            title=f"AI Report Generated: {candidate.get('name')}",
            message=f"Evaluation report generated for {candidate.get('name')}.",
            recipient_user_id=str(candidate["assigned_recruiter_id"]),
            recipient_role="recruiter",
            notification_type="report",
            link_section="candidates"
        )

    return serialize_doc(report_doc)

@router.get("/my-report", response_model=Dict[str, Any])
def get_my_report(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Candidate self-service endpoint: retrieves candidate's interview evaluation report.
    Reconciles with real feedback records to guarantee score and recommendation consistency.
    """
    candidates_col = get_candidates_collection()
    user_id = str(current_user.get("id"))
    user_obj_id = to_object_id(user_id)
    
    cand_query = [{"user_id": user_id}, {"email": current_user.get("email")}]
    if user_obj_id:
        cand_query.append({"user_id": user_obj_id})

    cand = candidates_col.find_one({"$or": cand_query})
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate record not found")
    
    reports_col = get_reports_collection()
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

    report = reports_col.find_one({"$or": cand_id_conditions}, sort=[("created_at", -1)])
    
    # Query live candidate interviews & feedback to reconcile consistency
    cand_interviews = list(interviews_col.find({"$or": cand_id_conditions}))
    inv_ids = [str(i["_id"]) for i in cand_interviews]
    inv_objs = [to_object_id(i["_id"]) for i in cand_interviews if to_object_id(i["_id"])]
    all_inv_match = inv_ids + inv_objs
    
    fb_conditions = []
    if all_inv_match:
        fb_conditions.append({"interview_id": {"$in": all_inv_match}})
    if cand_obj_id:
        fb_conditions.append({"candidate_id": cand_obj_id})
    fb_conditions.append({"candidate_id": cand_id_str})
    
    live_feedbacks = list(feedback_col.find({"$or": fb_conditions}).sort("created_at", -1))
    
    if report:
        s_report = serialize_doc(report)
        content = s_report.get("content")
        # If report exists but has inconsistent scores vs live feedbacks, synchronize content
        if isinstance(content, dict):
            if not live_feedbacks:
                # No feedback exists: do not display fabricated scores or positive recommendation
                content["average_scores"] = {"technical": None, "communication": None, "problem_solving": None}
                content["overall_score"] = None
                content["overall_percentage"] = None
                content["recommendation"] = "Pending Evaluation"
                content["completed_evaluations"] = 0
                content["executive_summary"] = f"Evaluation for {cand.get('name')} is pending. No interview feedback has been submitted yet."
            else:
                # Synchronize with real feedback scores
                tech_scores = [float(f["technical_score"]) for f in live_feedbacks if f.get("technical_score") is not None]
                comm_scores = [float(f["communication_score"]) for f in live_feedbacks if f.get("communication_score") is not None]
                prob_scores = [float(f["problem_solving_score"]) for f in live_feedbacks if f.get("problem_solving_score") is not None]

                avg_tech = round(sum(tech_scores) / len(tech_scores), 1) if tech_scores else None
                avg_comm = round(sum(comm_scores) / len(comm_scores), 1) if comm_scores else None
                avg_prob = round(sum(prob_scores) / len(prob_scores), 1) if prob_scores else None

                valid_avgs = [a for a in [avg_tech, avg_comm, avg_prob] if a is not None]
                overall_avg = round(sum(valid_avgs) / len(valid_avgs), 1) if valid_avgs else None
                overall_percent = round((overall_avg / 10.0) * 100) if overall_avg is not None else None

                content["average_scores"] = {
                    "technical": avg_tech,
                    "communication": avg_comm,
                    "problem_solving": avg_prob
                }
                content["overall_score"] = overall_avg
                content["overall_percentage"] = overall_percent
                content["completed_evaluations"] = len(live_feedbacks)

                if overall_avg is None:
                    content["recommendation"] = "Pending Evaluation"
                elif overall_avg >= 8.0 and (avg_tech is None or avg_tech >= 7.5):
                    content["recommendation"] = "Strong Hire"
                elif overall_avg >= 6.0:
                    content["recommendation"] = "Recommended"
                elif overall_avg >= 4.0:
                    content["recommendation"] = "Under Review"
                else:
                    content["recommendation"] = "Needs Improvement"

            s_report["content"] = content
        return s_report
    
    # If no report document exists yet, synthesize dynamic report if live feedbacks exist
    if live_feedbacks:
        tech_scores = [float(f["technical_score"]) for f in live_feedbacks if f.get("technical_score") is not None]
        comm_scores = [float(f["communication_score"]) for f in live_feedbacks if f.get("communication_score") is not None]
        prob_scores = [float(f["problem_solving_score"]) for f in live_feedbacks if f.get("problem_solving_score") is not None]

        avg_tech = round(sum(tech_scores) / len(tech_scores), 1) if tech_scores else None
        avg_comm = round(sum(comm_scores) / len(comm_scores), 1) if comm_scores else None
        avg_prob = round(sum(prob_scores) / len(prob_scores), 1) if prob_scores else None

        valid_avgs = [a for a in [avg_tech, avg_comm, avg_prob] if a is not None]
        overall_avg = round(sum(valid_avgs) / len(valid_avgs), 1) if valid_avgs else None
        overall_percent = round((overall_avg / 10.0) * 100) if overall_avg is not None else None

        if overall_avg is None:
            rec = "Pending Evaluation"
        elif overall_avg >= 8.0 and (avg_tech is None or avg_tech >= 7.5):
            rec = "Strong Hire"
        elif overall_avg >= 6.0:
            rec = "Recommended"
        elif overall_avg >= 4.0:
            rec = "Under Review"
        else:
            rec = "Needs Improvement"

        strengths_list = [f.get("strengths") for f in live_feedbacks if f.get("strengths")]
        weaknesses_list = [f.get("weaknesses") for f in live_feedbacks if f.get("weaknesses")]

        dynamic_report = {
            "id": f"dyn_{cand_id_str}",
            "candidate_id": cand_id_str,
            "created_at": datetime.now(timezone.utc),
            "content": {
                "candidate_name": cand.get("name"),
                "candidate_email": cand.get("email"),
                "overall_status": cand.get("status", "applied"),
                "interviews_evaluated": len(cand_interviews),
                "completed_evaluations": len(live_feedbacks),
                "average_scores": {
                    "technical": avg_tech,
                    "communication": avg_comm,
                    "problem_solving": avg_prob
                },
                "overall_score": overall_avg,
                "overall_percentage": overall_percent,
                "strengths": strengths_list if strengths_list else ["Demonstrated core competence across interview evaluation."],
                "growth_areas": weaknesses_list if weaknesses_list else ["Continue developing advanced system architecture and scalability."],
                "recommendation": rec,
                "executive_summary": f"Evaluation summary synthesized from {len(live_feedbacks)} completed interview evaluation(s). Overall Score: {overall_avg}/10 ({overall_percent}%). Recommendation: {rec}."
            }
        }
        return dynamic_report

    raise HTTPException(status_code=404, detail="No evaluation feedback or report submitted yet for your profile.")

@router.get("/export-data", response_model=Dict[str, Any])
def get_export_data(
    date_range: str = Query("30", description="Days filter ('30', '90', 'all')"),
    status: str = Query("all", description="Status filter ('all', 'applied', 'shortlisted', 'scheduled', 'interviewed', 'selected', 'rejected')"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Returns consolidated recruitment data across candidates, interviews, and feedback for CSV export and printable reports.
    """
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    candidates_col = get_candidates_collection()
    interviews_col = get_interviews_collection()
    feedback_col = get_feedback_collection()
    reports_col = get_reports_collection()

    filter_query: Dict[str, Any] = {}
    if status and status != "all":
        filter_query["status"] = status.lower()

    if date_range and date_range != "all":
        try:
            days = int(date_range)
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            filter_query["created_at"] = {"$gte": cutoff}
        except ValueError:
            pass

    candidates = list(candidates_col.find(filter_query).sort("created_at", -1))
    
    # Pre-fetch all interviews, feedbacks, reports for performance
    all_interviews = list(interviews_col.find())
    all_feedbacks = list(feedback_col.find())
    all_reports = list(reports_col.find().sort("created_at", -1))

    # Map interviews by candidate_id
    interviews_by_cand: Dict[str, List[Any]] = {}
    for inv in all_interviews:
        cid = str(inv.get("candidate_id"))
        interviews_by_cand.setdefault(cid, []).append(inv)

    # Map feedback by interview_id
    feedback_by_inv: Dict[str, Any] = {}
    for fb in all_feedbacks:
        iid = str(fb.get("interview_id"))
        feedback_by_inv[iid] = fb

    # Map latest report by candidate_id
    report_by_cand: Dict[str, Any] = {}
    for rep in all_reports:
        cid = str(rep.get("candidate_id"))
        if cid not in report_by_cand:
            report_by_cand[cid] = rep

    rows = []
    for cand in candidates:
        cid_str = str(cand["_id"])
        cand_invs = interviews_by_cand.get(cid_str, [])
        
        # Calculate scores
        cand_feedbacks = []
        for inv in cand_invs:
            fb = feedback_by_inv.get(str(inv["_id"]))
            if fb:
                cand_feedbacks.append(fb)

        avg_tech = round(sum(f.get("technical_score", 0) for f in cand_feedbacks) / len(cand_feedbacks), 1) if cand_feedbacks else "N/A"
        avg_comm = round(sum(f.get("communication_score", 0) for f in cand_feedbacks) / len(cand_feedbacks), 1) if cand_feedbacks else "N/A"
        avg_prob = round(sum(f.get("problem_solving_score", 0) for f in cand_feedbacks) / len(cand_feedbacks), 1) if cand_feedbacks else "N/A"
        
        overall_score = "N/A"
        if cand_feedbacks:
            overall_score = round((sum(f.get("technical_score", 0) for f in cand_feedbacks) + 
                                   sum(f.get("communication_score", 0) for f in cand_feedbacks) + 
                                   sum(f.get("problem_solving_score", 0) for f in cand_feedbacks)) / (3 * len(cand_feedbacks)), 1)

        rep = report_by_cand.get(cid_str)
        rec = "Pending"
        if rep and isinstance(rep.get("content"), dict):
            rec = rep["content"].get("recommendation", "Evaluated")
        elif cand.get("status") == "selected":
            rec = "Selected"
        elif cand.get("status") == "rejected":
            rec = "Rejected"

        created_str = cand.get("created_at").strftime("%Y-%m-%d") if hasattr(cand.get("created_at"), "strftime") else str(cand.get("created_at", ""))[:10]

        rows.append({
            "candidate_id": cid_str,
            "name": cand.get("name", ""),
            "email": cand.get("email", ""),
            "phone": cand.get("phone", ""),
            "status": cand.get("status", "applied").title(),
            "interviews_total": len(cand_invs),
            "interviews_completed": sum(1 for i in cand_invs if i.get("status") == "completed"),
            "technical_score": avg_tech,
            "communication_score": avg_comm,
            "problem_solving_score": avg_prob,
            "overall_score": overall_score,
            "recommendation": rec,
            "created_date": created_str,
        })

    summary = {
        "total_records": len(rows),
        "selected": sum(1 for r in rows if r["status"].lower() == "selected"),
        "rejected": sum(1 for r in rows if r["status"].lower() == "rejected"),
        "interviewed": sum(1 for r in rows if r["status"].lower() == "interviewed"),
        "scheduled": sum(1 for r in rows if r["status"].lower() == "scheduled"),
        "applied": sum(1 for r in rows if r["status"].lower() == "applied"),
    }

    return {
        "filters": {"date_range": date_range, "status": status},
        "summary": summary,
        "records": rows
    }

@router.get("/reports/{candidate_id}", response_model=schemas.ReportOut)
def get_report(candidate_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role not in (models.UserRole.admin.value, models.UserRole.recruiter.value, "admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    reports_col = get_reports_collection()
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
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You can only view reports for candidates assigned to you.")

    cand_id_str = str(candidate["_id"])
    cand_obj_id = to_object_id(candidate["_id"]) if candidate else to_object_id(candidate_id)

    cand_ids = [cand_id_str, str(candidate_id)]
    if cand_obj_id:
        cand_ids.append(cand_obj_id)
    if candidate:
        if candidate.get("legacy_id"):
            cand_ids.append(candidate["legacy_id"])
            cand_ids.append(str(candidate["legacy_id"]))

    report = reports_col.find_one({"candidate_id": {"$in": cand_ids}}, sort=[("created_at", -1)])

    # Query live candidate interviews & feedback to reconcile consistency
    cand_interviews = list(interviews_col.find({"candidate_id": {"$in": cand_ids}}))
    inv_ids = [str(i["_id"]) for i in cand_interviews]
    inv_objs = [to_object_id(i["_id"]) for i in cand_interviews if to_object_id(i["_id"])]
    all_inv_match = inv_ids + inv_objs

    fb_conditions = []
    if all_inv_match:
        fb_conditions.append({"interview_id": {"$in": all_inv_match}})
    fb_conditions.append({"candidate_id": {"$in": cand_ids}})

    live_feedbacks = list(feedback_col.find({"$or": fb_conditions}).sort("created_at", -1))

    if report:
        s_report = serialize_doc(report)
        content = s_report.get("content")
        if isinstance(content, dict):
            if not live_feedbacks:
                # No feedback exists: hide scores and recommendation, display Pending Evaluation
                content["average_scores"] = {"technical": None, "communication": None, "problem_solving": None}
                content["overall_score"] = None
                content["overall_percentage"] = None
                content["recommendation"] = "Pending Evaluation"
                content["completed_evaluations"] = 0
                cand_name = candidate.get("name") if candidate else "Candidate"
                content["executive_summary"] = f"Evaluation for {cand_name} is pending. No interview feedback has been submitted yet."
                content["strengths"] = []
                content["growth_areas"] = []
            else:
                # Synchronize with real feedback scores
                tech_scores = [float(f["technical_score"]) for f in live_feedbacks if f.get("technical_score") is not None]
                comm_scores = [float(f["communication_score"]) for f in live_feedbacks if f.get("communication_score") is not None]
                prob_scores = [float(f["problem_solving_score"]) for f in live_feedbacks if f.get("problem_solving_score") is not None]

                avg_tech = round(sum(tech_scores) / len(tech_scores), 1) if tech_scores else None
                avg_comm = round(sum(comm_scores) / len(comm_scores), 1) if comm_scores else None
                avg_prob = round(sum(prob_scores) / len(prob_scores), 1) if prob_scores else None

                valid_avgs = [a for a in [avg_tech, avg_comm, avg_prob] if a is not None]
                overall_avg = round(sum(valid_avgs) / len(valid_avgs), 1) if valid_avgs else None
                overall_percent = round((overall_avg / 10.0) * 100) if overall_avg is not None else None

                content["average_scores"] = {
                    "technical": avg_tech,
                    "communication": avg_comm,
                    "problem_solving": avg_prob
                }
                content["overall_score"] = overall_avg
                content["overall_percentage"] = overall_percent
                content["completed_evaluations"] = len(live_feedbacks)

                if overall_avg is None:
                    content["recommendation"] = "Pending Evaluation"
                elif overall_avg >= 8.0 and (avg_tech is None or avg_tech >= 7.5):
                    content["recommendation"] = "Strong Hire"
                elif overall_avg >= 6.0:
                    content["recommendation"] = "Recommended"
                elif overall_avg >= 4.0:
                    content["recommendation"] = "Under Review"
                else:
                    content["recommendation"] = "Needs Improvement"

            s_report["content"] = content
        return s_report

    # If no stored report document exists yet, dynamically synthesize if feedback is available
    if live_feedbacks:
        tech_scores = [float(f["technical_score"]) for f in live_feedbacks if f.get("technical_score") is not None]
        comm_scores = [float(f["communication_score"]) for f in live_feedbacks if f.get("communication_score") is not None]
        prob_scores = [float(f["problem_solving_score"]) for f in live_feedbacks if f.get("problem_solving_score") is not None]

        avg_tech = round(sum(tech_scores) / len(tech_scores), 1) if tech_scores else None
        avg_comm = round(sum(comm_scores) / len(comm_scores), 1) if comm_scores else None
        avg_prob = round(sum(prob_scores) / len(prob_scores), 1) if prob_scores else None

        valid_avgs = [a for a in [avg_tech, avg_comm, avg_prob] if a is not None]
        overall_avg = round(sum(valid_avgs) / len(valid_avgs), 1) if valid_avgs else None
        overall_percent = round((overall_avg / 10.0) * 100) if overall_avg is not None else None

        if overall_avg is None:
            rec = "Pending Evaluation"
        elif overall_avg >= 8.0 and (avg_tech is None or avg_tech >= 7.5):
            rec = "Strong Hire"
        elif overall_avg >= 6.0:
            rec = "Recommended"
        elif overall_avg >= 4.0:
            rec = "Under Review"
        else:
            rec = "Needs Improvement"

        cand_name = candidate.get("name") if candidate else f"Candidate #{cand_id_str}"
        strengths_list = [f.get("strengths") for f in live_feedbacks if f.get("strengths")]
        weaknesses_list = [f.get("weaknesses") for f in live_feedbacks if f.get("weaknesses")]

        dynamic_report = {
            "id": f"dyn_{cand_id_str}",
            "candidate_id": cand_id_str,
            "created_at": datetime.now(timezone.utc),
            "content": {
                "candidate_name": cand_name,
                "candidate_email": candidate.get("email") if candidate else "",
                "overall_status": candidate.get("status", "applied") if candidate else "applied",
                "interviews_evaluated": len(cand_interviews),
                "completed_evaluations": len(live_feedbacks),
                "average_scores": {
                    "technical": avg_tech,
                    "communication": avg_comm,
                    "problem_solving": avg_prob
                },
                "overall_score": overall_avg,
                "overall_percentage": overall_percent,
                "strengths": strengths_list if strengths_list else ["Demonstrated core competence across evaluations."],
                "growth_areas": weaknesses_list if weaknesses_list else ["Continue developing depth in distributed systems."],
                "recommendation": rec,
                "executive_summary": f"Evaluation summary synthesized from {len(live_feedbacks)} completed interview evaluation(s). Overall Score: {overall_avg}/10 ({overall_percent}%). Recommendation: {rec}."
            }
        }
        return dynamic_report

    raise HTTPException(status_code=404, detail="No evaluation feedback or report found for this candidate.")
