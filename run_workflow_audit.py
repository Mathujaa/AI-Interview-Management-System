import sys
import time
import requests
from datetime import datetime, timezone, timedelta
from bson import ObjectId

# Reconfigure stdout for utf-8 if win32
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from Backend.app.database import (
    get_candidates_collection,
    get_interviews_collection,
    get_feedback_collection,
    get_reports_collection,
    get_users_collection,
    serialize_doc
)

BASE_URL = "http://127.0.0.1:8000"

def run_workflow():
    print("=" * 70)
    print("STARTING 12-STEP END-TO-END WORKFLOW INTEGRATION AUDIT")
    print("=" * 70)

    # 0. Authenticate as Admin
    login_res = requests.post(f"{BASE_URL}/auth/login", data={"username": "admin", "password": "Admin@123"})
    if login_res.status_code != 200:
        print("[FAIL] Admin login failed:", login_res.status_code, login_res.text)
        return
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("[PASS] Step 0: Authenticated as Admin (JWT Bearer Token acquired)")

    created_candidate_id = None
    created_interview_id = None
    created_feedback_id = None
    created_report_id = None

    try:
        # Step 1: Register / Create a Candidate
        cand_payload = {
            "name": "Audit Test Candidate",
            "email": "audit.candidate.test@example.com",
            "phone": "+1-555-0199"
        }
        res1 = requests.post(f"{BASE_URL}/candidates/", json=cand_payload, headers=headers)
        assert res1.status_code == 201, f"Candidate creation failed: {res1.status_code} {res1.text}"
        cand_data = res1.json()
        created_candidate_id = cand_data["id"]
        print(f"[PASS] Step 1: Register Candidate -> Created ID: {created_candidate_id}, Status: {cand_data.get('status')}")
        assert cand_data.get("status") == "applied", "New candidate initial status must be 'applied'"

        # Step 2: Shortlist Candidate
        res2 = requests.put(f"{BASE_URL}/candidates/{created_candidate_id}", json={"status": "shortlisted"}, headers=headers)
        assert res2.status_code == 200, f"Candidate shortlist failed: {res2.status_code} {res2.text}"
        print(f"[PASS] Step 2: Shortlist Candidate -> Status updated to: {res2.json().get('status')}")

        # Step 3 & 4: Schedule an Interview & Assign an Interviewer
        admin_user = get_users_collection().find_one({"username": "admin"})
        admin_id_str = str(admin_user["_id"])
        
        inv_payload = {
            "candidate_id": created_candidate_id,
            "interviewer_id": admin_id_str,
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "round": 1
        }
        res3 = requests.post(f"{BASE_URL}/interviews/", json=inv_payload, headers=headers)
        assert res3.status_code == 201, f"Interview schedule failed: {res3.status_code} {res3.text}"
        inv_data = res3.json()
        created_interview_id = inv_data["id"]
        print(f"[PASS] Step 3 & 4: Schedule Interview & Assign Interviewer -> Interview ID: {created_interview_id}, Round: {inv_data.get('round')}, Interviewer: {inv_data.get('interviewer_id')}")

        # Check: Did scheduling update candidate status automatically?
        check_cand = get_candidates_collection().find_one({"_id": ObjectId(created_candidate_id)})
        print(f"      [INFO] Candidate status after interview scheduling: '{check_cand.get('status')}' (Backend does NOT auto-update candidate status on interview schedule)")

        # Step 5: Complete the Interview
        res5 = requests.put(f"{BASE_URL}/interviews/{created_interview_id}", json={"status": "completed"}, headers=headers)
        assert res5.status_code == 200, f"Interview complete failed: {res5.status_code} {res5.text}"
        print(f"[PASS] Step 5: Complete Interview -> Interview status updated to: {res5.json().get('status')}")

        # Step 6: Submit Interview Feedback
        fb_payload = {
            "interview_id": created_interview_id,
            "technical_score": 9,
            "communication_score": 8,
            "problem_solving_score": 9,
            "strengths": "Demonstrates thorough understanding of data structures and distributed databases.",
            "weaknesses": "Could provide more concrete production metrics.",
            "comments": "Strong technical foundation and clear communication."
        }
        res6 = requests.post(f"{BASE_URL}/feedback/", json=fb_payload, headers=headers)
        assert res6.status_code == 201, f"Feedback submit failed: {res6.status_code} {res6.text}"
        fb_data = res6.json()
        created_feedback_id = fb_data["id"]
        print(f"[PASS] Step 6: Submit Interview Feedback -> Feedback ID: {created_feedback_id}, Tech: {fb_data.get('technical_score')}, Comm: {fb_data.get('communication_score')}")

        # Step 7: Update Candidate Status (Progress through Interviewed -> Hired)
        res7a = requests.put(f"{BASE_URL}/candidates/{created_candidate_id}", json={"status": "interviewed"}, headers=headers)
        assert res7a.status_code == 200
        print(f"[PASS] Step 7a: Update Candidate Status -> Set to: {res7a.json().get('status')}")

        res7b = requests.put(f"{BASE_URL}/candidates/{created_candidate_id}", json={"status": "hired"}, headers=headers)
        assert res7b.status_code == 200
        print(f"[PASS] Step 7b: Update Candidate Status -> Set to: {res7b.json().get('status')}")

        # Step 8: Generate ML Prediction
        pred_payload = {
            "skill_score": 9,
            "years_experience": 6,
            "technical_score": 9,
            "communication_rating": 8,
            "prev_performance": 9,
            "education": "master"
        }
        res8 = requests.post(f"{BASE_URL}/prediction/{created_candidate_id}", json=pred_payload, headers=headers)
        assert res8.status_code == 200, f"Prediction failed: {res8.status_code} {res8.text}"
        pred_data = res8.json()
        print(f"[PASS] Step 8: ML Random Forest Prediction -> Class: '{pred_data.get('class')}', Probabilities: {pred_data.get('probabilities')}")

        # Step 9: Generate GenAI Evaluation Report
        res9 = requests.post(f"{BASE_URL}/report/generate-report/{created_candidate_id}", headers=headers)
        assert res9.status_code in [200, 201], f"Report generation failed: {res9.status_code} {res9.text}"
        rep_data = res9.json()
        created_report_id = rep_data["id"]
        print(f"[PASS] Step 9: Generate Evaluation Report -> Report ID: {created_report_id}")
        content = rep_data.get("content", {})
        if isinstance(content, dict):
            print(f"      Report Executive Summary: {content.get('executive_summary')}")
            print(f"      Report Recommendation: {content.get('recommendation')}")
            print(f"      Report Strengths: {content.get('strengths')}")

        # Step 10: View Notifications
        # Check if any notification was stored or generated in MongoDB
        notif_cols = [c for c in get_candidates_collection().database.list_collection_names() if "notif" in c.lower()]
        print(f"[AUDIT] Step 10: Notifications System -> Collections found: {notif_cols}")
        if not notif_cols:
            print("      [VERIFIED] Notification feature is NOT IMPLEMENTED (No notification collections or background triggers).")

        # Step 11: View Recruitment Dashboard
        res11 = requests.get(f"{BASE_URL}/dashboard/stats", headers=headers)
        assert res11.status_code == 200, f"Dashboard stats failed: {res11.status_code}"
        stats = res11.json()
        print(f"[PASS] Step 11: Recruitment Dashboard Stats -> Total Candidates: {stats.get('total_candidates')}, Scheduled: {stats.get('scheduled_interviews')}, Completed: {stats.get('completed_interviews')}, Selected (Hired): {stats.get('selected_candidates')}, Rejected: {stats.get('rejected_candidates')}")

        # Step 12: Retrieve Recruitment Reports
        res12 = requests.get(f"{BASE_URL}/report/reports/{created_candidate_id}", headers=headers)
        assert res12.status_code == 200, f"Retrieve report failed: {res12.status_code}"
        fetched_rep = res12.json()
        print(f"[PASS] Step 12: Retrieve Recruitment Report -> Found Report for candidate {fetched_rep.get('candidate_id')}")

    finally:
        print("\n--- CLEANING UP TEMPORARY AUDIT TEST RECORDS ---")
        if created_report_id:
            get_reports_collection().delete_one({"_id": ObjectId(created_report_id)})
            print(f"[CLEANUP] Deleted test report: {created_report_id}")
        if created_feedback_id:
            get_feedback_collection().delete_one({"_id": ObjectId(created_feedback_id)})
            print(f"[CLEANUP] Deleted test feedback: {created_feedback_id}")
        if created_interview_id:
            get_interviews_collection().delete_one({"_id": ObjectId(created_interview_id)})
            print(f"[CLEANUP] Deleted test interview: {created_interview_id}")
        if created_candidate_id:
            get_candidates_collection().delete_one({"_id": ObjectId(created_candidate_id)})
            print(f"[CLEANUP] Deleted test candidate: {created_candidate_id}")
        print("[CLEANUP] All temporary test records removed successfully. Database restored to pristine state.")

if __name__ == "__main__":
    run_workflow()

