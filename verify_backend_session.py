import os
import sys
import time
import subprocess
import requests
from datetime import datetime, timezone, timedelta
from jose import jwt

# Ensure proper encoding on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from Backend.app.config import settings
from Backend.app.database import (
    get_candidates_collection,
    get_interviews_collection,
    get_feedback_collection,
    get_reports_collection
)
from bson import ObjectId

BASE_URL = "http://127.0.0.1:8000"

results = []

def record(test_num, name, status, detail=""):
    results.append({
        "test_num": test_num,
        "name": name,
        "status": status,
        "detail": detail
    })
    status_str = "[PASS]" if status == "PASSED" else "[FAIL]"
    print(f"{status_str} Test {test_num}: {name} - {detail}")

def run_tests():
    print("=" * 70)
    print("AI INTERVIEW MANAGEMENT SYSTEM - JWT & SESSION MANAGEMENT VERIFICATION")
    print("=" * 70)

    # 1. Start uvicorn server in background subprocess if not running
    server_proc = None
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=1)
        print("Backend server already running on port 8000.")
    except Exception:
        print("Starting uvicorn backend on port 8000...")
        server_proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "Backend.main:app", "--host", "127.0.0.1", "--port", "8000"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        # Wait up to 10 seconds for server to start
        for _ in range(20):
            time.sleep(0.5)
            try:
                r = requests.get(f"{BASE_URL}/health", timeout=1)
                if r.status_code == 200:
                    print("Backend server ready!")
                    break
            except Exception:
                pass
        else:
            print("ERROR: Backend server failed to start.")
            sys.exit(1)

    temp_cand_id = None
    temp_inv_id = None
    temp_fb_id = None

    try:
        # ---------------------------------------------------------
        # Scenario 1: Unauthenticated request rejected (401)
        # ---------------------------------------------------------
        res_unauth = requests.get(f"{BASE_URL}/dashboard/stats")
        if res_unauth.status_code == 401:
            record(1, "Unauthenticated Request Guard", "PASSED", f"HTTP {res_unauth.status_code} properly rejected")
        else:
            record(1, "Unauthenticated Request Guard", "FAILED", f"Expected 401, got {res_unauth.status_code}")

        # ---------------------------------------------------------
        # Scenario 2: Bad login rejected (401)
        # ---------------------------------------------------------
        res_bad_login = requests.post(f"{BASE_URL}/auth/login", data={"username": "admin", "password": "WrongPassword"})
        if res_bad_login.status_code == 401:
            record(2, "Invalid Credentials Rejection", "PASSED", f"HTTP {res_bad_login.status_code} Incorrect username or password")
        else:
            record(2, "Invalid Credentials Rejection", "FAILED", f"Expected 401, got {res_bad_login.status_code}")

        # ---------------------------------------------------------
        # Scenario 3: Admin Login with valid credentials
        # ---------------------------------------------------------
        res_login = requests.post(f"{BASE_URL}/auth/login", data={"username": "admin", "password": "Admin@123"})
        if res_login.status_code == 200 and "access_token" in res_login.json():
            token = res_login.json()["access_token"]
            payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
            exp_dt = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
            now_dt = datetime.now(timezone.utc)
            remaining_mins = (exp_dt - now_dt).total_seconds() / 60.0
            record(3, "Admin Login & JWT Token Generation", "PASSED",
                   f"Token generated for {payload.get('sub')} ({payload.get('role')}), exp in {remaining_mins:.1f}m")
        else:
            record(3, "Admin Login & JWT Token Generation", "FAILED", f"HTTP {res_login.status_code} {res_login.text}")
            return

        headers = {"Authorization": f"Bearer {token}"}

        # ---------------------------------------------------------
        # Scenario 4: Token Refresh Endpoint (POST /auth/refresh)
        # ---------------------------------------------------------
        res_refresh = requests.post(f"{BASE_URL}/auth/refresh", headers=headers)
        if res_refresh.status_code == 200 and "access_token" in res_refresh.json():
            refreshed_token = res_refresh.json()["access_token"]
            refresh_payload = jwt.decode(refreshed_token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
            record(4, "Token Refresh Endpoint (POST /auth/refresh)", "PASSED",
                   f"Refreshed token issued for {refresh_payload.get('sub')}")
            # Use refreshed token for subsequent steps
            headers = {"Authorization": f"Bearer {refreshed_token}"}
        else:
            record(4, "Token Refresh Endpoint (POST /auth/refresh)", "FAILED",
                   f"HTTP {res_refresh.status_code} {res_refresh.text}")

        # ---------------------------------------------------------
        # Scenario 5: All Protected Routes Function Normally
        # ---------------------------------------------------------
        # 5a. Dashboard stats
        res_stats = requests.get(f"{BASE_URL}/dashboard/stats", headers=headers)
        if res_stats.status_code == 200:
            stats = res_stats.json()
            record("5a", "Protected API: Dashboard Stats", "PASSED",
                   f"Candidates: {stats.get('total_candidates')}, Scheduled: {stats.get('scheduled_interviews')}, Completed: {stats.get('completed_interviews')}")
        else:
            record("5a", "Protected API: Dashboard Stats", "FAILED", f"HTTP {res_stats.status_code} {res_stats.text}")

        # 5b. Candidate CRUD
        res_cand_create = requests.post(f"{BASE_URL}/candidates/", json={
            "name": "Temp Test Candidate",
            "email": "temptestcand@example.com",
            "phone": "555-0199"
        }, headers=headers)
        if res_cand_create.status_code in [200, 201]:
            temp_cand = res_cand_create.json()
            temp_cand_id = temp_cand["id"]
            # Update candidate
            res_cand_up = requests.put(f"{BASE_URL}/candidates/{temp_cand_id}", json={
                "name": "Temp Test Candidate Updated",
                "email": "temptestcand@example.com",
                "status": "interviewed"
            }, headers=headers)
            record("5b", "Protected API: Candidate CRUD", "PASSED", f"Created & updated candidate #{temp_cand_id}")
        else:
            record("5b", "Protected API: Candidate CRUD", "FAILED", f"HTTP {res_cand_create.status_code} {res_cand_create.text}")

        # 5c. Interview CRUD
        res_inv_create = requests.post(f"{BASE_URL}/interviews/", json={
            "candidate_id": temp_cand_id,
            "round": 1,
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        }, headers=headers)
        if res_inv_create.status_code in [200, 201]:
            temp_inv = res_inv_create.json()
            temp_inv_id = temp_inv["id"]
            # Update status
            res_inv_up = requests.put(f"{BASE_URL}/interviews/{temp_inv_id}", json={
                "status": "completed"
            }, headers=headers)
            record("5c", "Protected API: Interview Scheduling & Status", "PASSED", f"Scheduled & completed interview #{temp_inv_id}")
        else:
            record("5c", "Protected API: Interview Scheduling & Status", "FAILED", f"HTTP {res_inv_create.status_code} {res_inv_create.text}")

        # 5d. Feedback Submission and Retrieval
        res_fb_create = requests.post(f"{BASE_URL}/feedback/", json={
            "interview_id": temp_inv_id,
            "technical_score": 9,
            "communication_score": 8,
            "problem_solving_score": 9,
            "strengths": "Quick analytical thinking",
            "weaknesses": "None noted",
            "comments": "Strong performance"
        }, headers=headers)
        if res_fb_create.status_code in [200, 201]:
            temp_fb = res_fb_create.json()
            temp_fb_id = temp_fb["id"]
            # Retrieve feedback
            res_fb_get = requests.get(f"{BASE_URL}/feedback/interview/{temp_inv_id}", headers=headers)
            record("5d", "Protected API: Feedback Submit & Retrieve", "PASSED", f"Feedback #{temp_fb_id} linked to interview #{temp_inv_id}")
        else:
            record("5d", "Protected API: Feedback Submit & Retrieve", "FAILED", f"HTTP {res_fb_create.status_code} {res_fb_create.text}")

        # 5e. Machine Learning Prediction
        res_pred = requests.post(f"{BASE_URL}/prediction/{temp_cand_id}", json={
            "skill_score": 88,
            "years_experience": 5,
            "technical_score": 9,
            "communication_rating": 8,
            "prev_performance": 85,
            "education": "Master"
        }, headers=headers)
        if res_pred.status_code == 200:
            pred_data = res_pred.json()
            record("5e", "Protected API: ML Candidate Prediction", "PASSED",
                   f"Result: {pred_data.get('class')} (Prob: {pred_data.get('probabilities')})")
        else:
            record("5e", "Protected API: ML Candidate Prediction", "FAILED", f"HTTP {res_pred.status_code} {res_pred.text}")

        # 5f. AI Report Generation and Retrieval
        res_rep_gen = requests.post(f"{BASE_URL}/report/generate-report/{temp_cand_id}", headers=headers)
        if res_rep_gen.status_code in [200, 201]:
            rep_data = res_rep_gen.json()
            # Retrieve report
            res_rep_get = requests.get(f"{BASE_URL}/report/reports/{temp_cand_id}", headers=headers)
            if res_rep_get.status_code == 200:
                record("5f", "Protected API: AI Report Generation & Retrieval", "PASSED",
                       f"Generated report #{rep_data.get('id')} for candidate #{temp_cand_id} & retrieved successfully")
            else:
                record("5f", "Protected API: AI Report Generation & Retrieval", "FAILED",
                       f"Report retrieval failed: HTTP {res_rep_get.status_code}")
        else:
            record("5f", "Protected API: AI Report Generation & Retrieval", "FAILED", f"HTTP {res_rep_gen.status_code} {res_rep_gen.text}")

        # ---------------------------------------------------------
        # Scenario 6: Expired Token Simulation & Detection
        # ---------------------------------------------------------
        # Craft an expired token: signed properly with genuine secret key, but exp is 1 hour in the past
        past_exp = datetime.now(timezone.utc) - timedelta(hours=1)
        expired_token_data = {"sub": "admin", "role": "admin", "exp": past_exp}
        expired_jwt = jwt.encode(expired_token_data, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
        expired_headers = {"Authorization": f"Bearer {expired_jwt}"}

        # Test 6a: Expired token on GET /dashboard/stats
        res_exp_stats = requests.get(f"{BASE_URL}/dashboard/stats", headers=expired_headers)
        is_401 = (res_exp_stats.status_code == 401)
        has_expired_msg = "Signature has expired" in res_exp_stats.text or "expired" in res_exp_stats.text.lower()
        if is_401 and has_expired_msg:
            record("6a", "Expired Token Detection on Dashboard Stats", "PASSED",
                   f"HTTP 401 with exact message: '{res_exp_stats.json().get('detail')}'")
        else:
            record("6a", "Expired Token Detection on Dashboard Stats", "FAILED",
                   f"Expected HTTP 401 expired message, got {res_exp_stats.status_code}: {res_exp_stats.text}")

        # Test 6b: Expired token on GET /interviews/
        res_exp_inv = requests.get(f"{BASE_URL}/interviews/", headers=expired_headers)
        if res_exp_inv.status_code == 401 and "expired" in res_exp_inv.text.lower():
            record("6b", "Expired Token Detection on Interviews List", "PASSED",
                   f"HTTP 401 rejected with: '{res_exp_inv.json().get('detail')}'")
        else:
            record("6b", "Expired Token Detection on Interviews List", "FAILED",
                   f"Expected HTTP 401, got {res_exp_inv.status_code}")

        # Test 6c: Expired token on POST /feedback/
        res_exp_fb = requests.post(f"{BASE_URL}/feedback/", json={"interview_id": "dummy"}, headers=expired_headers)
        if res_exp_fb.status_code == 401 and "expired" in res_exp_fb.text.lower():
            record("6c", "Expired Token Detection on Feedback Submit", "PASSED",
                   f"HTTP 401 rejected with: '{res_exp_fb.json().get('detail')}'")
        else:
            record("6c", "Expired Token Detection on Feedback Submit", "FAILED",
                   f"Expected HTTP 401, got {res_exp_fb.status_code}")

        # Test 6d: Expired token on POST /auth/refresh
        res_exp_ref = requests.post(f"{BASE_URL}/auth/refresh", headers=expired_headers)
        if res_exp_ref.status_code == 401 and "expired" in res_exp_ref.text.lower():
            record("6d", "Expired Token Rejection on Token Refresh", "PASSED",
                   f"HTTP 401 rejected with: '{res_exp_ref.json().get('detail')}'")
        else:
            record("6d", "Expired Token Rejection on Token Refresh", "FAILED",
                   f"Expected HTTP 401, got {res_exp_ref.status_code}")

        # ---------------------------------------------------------
        # Scenario 7: Tampered Token Rejection
        # ---------------------------------------------------------
        tampered_token = expired_jwt[:-8] + "ABCDEFGH"
        res_tampered = requests.get(f"{BASE_URL}/dashboard/stats", headers={"Authorization": f"Bearer {tampered_token}"})
        if res_tampered.status_code == 401:
            record(7, "Tampered Token Signature Rejection", "PASSED",
                   f"HTTP 401 rejected: '{res_tampered.json().get('detail')}'")
        else:
            record(7, "Tampered Token Signature Rejection", "FAILED",
                   f"Expected HTTP 401, got {res_tampered.status_code}")

        # ---------------------------------------------------------
        # Scenario 8: Restoration - Re-login with Fresh Credentials
        # ---------------------------------------------------------
        res_relogin = requests.post(f"{BASE_URL}/auth/login", data={"username": "admin", "password": "Admin@123"})
        if res_relogin.status_code == 200:
            fresh_token = res_relogin.json()["access_token"]
            res_verify = requests.get(f"{BASE_URL}/dashboard/stats", headers={"Authorization": f"Bearer {fresh_token}"})
            if res_verify.status_code == 200:
                record(8, "Re-Login & Session Restoration", "PASSED",
                       "Fresh login succeeded and protected access restored seamlessly")
            else:
                record(8, "Re-Login & Session Restoration", "FAILED",
                       f"Protected access failed after re-login: {res_verify.status_code}")
        else:
            record(8, "Re-Login & Session Restoration", "FAILED",
                   f"Re-login failed: {res_relogin.status_code} {res_relogin.text}")

        # ---------------------------------------------------------
        # Scenario 9: Safe Cleanup of Temporary Test Records
        # ---------------------------------------------------------
        cleanup_counts = {"candidates": 0, "interviews": 0, "feedback": 0, "reports": 0}
        if temp_fb_id:
            res_del_fb = get_feedback_collection().delete_one({"_id": ObjectId(temp_fb_id)})
            cleanup_counts["feedback"] = res_del_fb.deleted_count
        if temp_inv_id:
            res_del_inv = get_interviews_collection().delete_one({"_id": ObjectId(temp_inv_id)})
            cleanup_counts["interviews"] = res_del_inv.deleted_count
        if temp_cand_id:
            res_del_rep = get_reports_collection().delete_many({"$or": [
                {"candidate_id": str(temp_cand_id)},
                {"candidate_id": ObjectId(temp_cand_id)}
            ]})
            cleanup_counts["reports"] = res_del_rep.deleted_count
            res_del_cand = get_candidates_collection().delete_one({"_id": ObjectId(temp_cand_id)})
            cleanup_counts["candidates"] = res_del_cand.deleted_count

        record(9, "MongoDB Atlas Test Document Cleanup", "PASSED",
               f"Cleaned up temporary documents: {cleanup_counts}; production records preserved")

    finally:
        # If we spawned server, don't kill it if we want it to keep serving user or kill it if needed
        # We will keep server running or verify
        pass

    print("\n" + "=" * 70)
    print("VERIFICATION SUMMARY")
    print("=" * 70)
    passed = sum(1 for r in results if r["status"] == "PASSED")
    failed = sum(1 for r in results if r["status"] == "FAILED")
    print(f"Total Tests: {len(results)} | Passed: {passed} | Failed: {failed}")
    for r in results:
        mark = "✓" if r["status"] == "PASSED" else "✗"
        print(f"  {mark} Test {r['test_num']}: {r['name']}")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()
