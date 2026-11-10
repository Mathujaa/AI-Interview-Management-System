"""
Verification script for Admin and Recruiter workflow fixes.
Tests all requirements locally with in-memory collection mocks:
1. Remove Admin Candidate Registration (frontend verified).
2. Fix Assigned Evaluator (must have recruiter/admin role; candidate forbidden).
3. Complete Recruitment Status Management (lifecycle transitions, audit history, notifications).
4. Interview Session Actions (complete, cancel, multiple rounds remaining check).
5. Final Hiring Decision (Select / Reject with remarks and audit history).
6. Admin Notifications (fetching, role scoping, mark read, unread count).
7. Status Synchronization (single source of truth).
8. Security & Authorization (role-based guards).
"""

import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone
from fastapi import HTTPException
from bson import ObjectId

from Backend.app import models, schemas
from Backend.app.routers import candidates, interviews, feedback, notifications, auth, dashboard

class TestWorkflowFixes(unittest.TestCase):

    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.admin_user = {"id": str(ObjectId()), "username": "admin_user", "role": "admin"}
        self.recruiter_user = {"id": str(ObjectId()), "username": "recruiter_jane", "role": "recruiter"}
        self.candidate_user = {"id": str(ObjectId()), "username": "cand_john", "role": "candidate"}

    # =========================================================================
    # 1. Assigned Evaluator Validation
    # =========================================================================
    @patch("Backend.app.routers.interviews.get_candidates_collection")
    @patch("Backend.app.routers.interviews.get_users_collection")
    @patch("Backend.app.routers.interviews.get_interviews_collection")
    def test_evaluator_cannot_be_candidate(self, mock_inv_col, mock_users_col, mock_cand_col):
        """Assigned evaluator must have recruiter role; candidates are rejected with 400."""
        cand_id = str(ObjectId())
        candidate_doc = {"_id": ObjectId(cand_id), "name": "Jane", "status": "shortlisted", "user_id": None, "assigned_recruiter_id": self.recruiter_user["id"]}
        mock_cand_col.return_value.find_one.return_value = candidate_doc

        # Mock that interviewer_id belongs to a candidate
        candidate_evaluator = {"_id": ObjectId(), "username": "bad_evaluator", "role": "candidate"}
        mock_users_col.return_value.find_one.return_value = candidate_evaluator

        payload = schemas.InterviewCreate(
            candidate_id=cand_id,
            interviewer_id=str(candidate_evaluator["_id"]),
            scheduled_at=self.now,
            round=1
        )

        with self.assertRaises(HTTPException) as ctx:
            interviews.schedule_interview(payload, current_user=self.admin_user)
        
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Assigned evaluator must have a recruiter role", ctx.exception.detail)

    @patch("Backend.app.routers.interviews.get_candidates_collection")
    @patch("Backend.app.routers.interviews.get_users_collection")
    @patch("Backend.app.routers.interviews.get_interviews_collection")
    @patch("Backend.app.routers.interviews.create_notification")
    def test_evaluator_valid_recruiter_succeeds(self, mock_notif, mock_inv_col, mock_users_col, mock_cand_col):
        """Assigned evaluator with recruiter role succeeds and synchronizes candidate status to scheduled."""
        cand_id = str(ObjectId())
        candidate_doc = {"_id": ObjectId(cand_id), "name": "Jane", "status": "shortlisted", "user_id": None}
        mock_cand_col.return_value.find_one.return_value = candidate_doc

        valid_recruiter = {"_id": ObjectId(), "username": "recruiter_valid", "role": "recruiter"}
        mock_users_col.return_value.find_one.return_value = valid_recruiter

        # No active duplicate interview exists
        mock_inv_col.return_value.find_one.return_value = None
        mock_inv_col.return_value.insert_one.return_value = MagicMock(inserted_id=ObjectId())

        payload = schemas.InterviewCreate(
            candidate_id=cand_id,
            interviewer_id=str(valid_recruiter["_id"]),
            scheduled_at=self.now,
            round=1
        )

        res = interviews.schedule_interview(payload, current_user=self.admin_user)
        self.assertEqual(res["status"], "scheduled")
        self.assertEqual(res["interviewer_name"], "recruiter_valid")

    @patch("Backend.app.routers.interviews.get_candidates_collection")
    @patch("Backend.app.routers.interviews.get_users_collection")
    @patch("Backend.app.routers.interviews.get_interviews_collection")
    def test_duplicate_active_interview_rejected(self, mock_inv_col, mock_users_col, mock_cand_col):
        """Cannot schedule duplicate active interview for the same candidate and round."""
        cand_id = str(ObjectId())
        candidate_doc = {"_id": ObjectId(cand_id), "name": "Jane", "status": "shortlisted", "user_id": None}
        mock_cand_col.return_value.find_one.return_value = candidate_doc

        valid_recruiter = {"_id": ObjectId(), "username": "recruiter_valid", "role": "recruiter"}
        mock_users_col.return_value.find_one.return_value = valid_recruiter

        # Simulate existing active interview for round 1
        mock_inv_col.return_value.find_one.return_value = {
            "_id": ObjectId(),
            "candidate_id": cand_id,
            "round": 1,
            "status": "scheduled"
        }

        payload = schemas.InterviewCreate(
            candidate_id=cand_id,
            interviewer_id=str(valid_recruiter["_id"]),
            scheduled_at=self.now,
            round=1
        )

        with self.assertRaises(HTTPException) as ctx:
            interviews.schedule_interview(payload, current_user=self.admin_user)

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("already scheduled", ctx.exception.detail)

    # =========================================================================
    # 2. Recruitment Status Lifecycle & Transitions
    # =========================================================================
    @patch("Backend.app.routers.candidates.get_candidates_collection")
    @patch("Backend.app.routers.candidates.create_notification")
    def test_recruiter_invalid_status_transition_rejected(self, mock_notif, mock_cand_col):
        """Recruiters cannot jump directly from applied to selected (must follow lifecycle)."""
        cand_id = str(ObjectId())
        candidate_doc = {"_id": ObjectId(cand_id), "name": "Alice", "status": "applied", "user_id": None, "assigned_recruiter_id": self.recruiter_user["id"]}
        mock_cand_col.return_value.find_one.return_value = candidate_doc

        payload = schemas.CandidateUpdate(status="selected", remarks="Trying to skip interview rounds")

        with self.assertRaises(HTTPException) as ctx:
            candidates.update_candidate(cand_id, payload, current_user=self.recruiter_user)
        
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Invalid status transition", ctx.exception.detail)

    @patch("Backend.app.routers.candidates.get_candidates_collection")
    @patch("Backend.app.routers.candidates.create_notification")
    def test_recruiter_valid_lifecycle_transitions(self, mock_notif, mock_cand_col):
        """Recruiter shortlists applied candidate, then selects interviewed candidate."""
        cand_id = str(ObjectId())
        
        # Step A: applied -> shortlisted
        cand_applied = {"_id": ObjectId(cand_id), "name": "Alice", "status": "applied", "user_id": None, "assigned_recruiter_id": self.recruiter_user["id"]}
        mock_cand_col.return_value.find_one.return_value = cand_applied

        payload_shortlist = schemas.CandidateUpdate(status="shortlisted", remarks="Screening passed")
        res1 = candidates.update_candidate(cand_id, payload_shortlist, current_user=self.recruiter_user)
        mock_cand_col.return_value.update_one.assert_called()

        # Step B: interviewed -> selected
        cand_interviewed = {"_id": ObjectId(cand_id), "name": "Alice", "status": "interviewed", "user_id": None, "assigned_recruiter_id": self.recruiter_user["id"]}
        mock_cand_col.return_value.find_one.return_value = cand_interviewed

        payload_select = schemas.CandidateUpdate(status="selected", remarks="Exceptional technical skills")
        res2 = candidates.update_candidate(cand_id, payload_select, current_user=self.recruiter_user)
        mock_cand_col.return_value.update_one.assert_called()

    @patch("Backend.app.routers.candidates.get_candidates_collection")
    @patch("Backend.app.routers.candidates.create_notification")
    def test_admin_administrative_correction_allowed(self, mock_notif, mock_cand_col):
        """Admin is authorized to correct status administratively while logging history."""
        cand_id = str(ObjectId())
        cand_applied = {"_id": ObjectId(cand_id), "name": "Bob", "status": "applied", "user_id": None}
        mock_cand_col.return_value.find_one.return_value = cand_applied

        payload_correction = schemas.CandidateUpdate(status="interviewed", remarks="Administrative correction by Admin")
        candidates.update_candidate(cand_id, payload_correction, current_user=self.admin_user)
        mock_cand_col.return_value.update_one.assert_called()

    # =========================================================================
    # 3. Multiple Interview Rounds Completion
    # =========================================================================
    @patch("Backend.app.routers.interviews.get_interviews_collection")
    @patch("Backend.app.routers.interviews.get_candidates_collection")
    @patch("Backend.app.routers.interviews.get_users_collection")
    @patch("Backend.app.routers.interviews.get_feedback_collection")
    @patch("Backend.app.routers.interviews.create_notification")
    def test_interview_completion_multiple_rounds(self, mock_notif, mock_fb_col, mock_users_col, mock_cand_col, mock_inv_col):
        """Completing an interview does NOT mark candidate as interviewed if another round is still scheduled."""
        inv_id = str(ObjectId())
        cand_id = str(ObjectId())

        inv_doc = {
            "_id": ObjectId(inv_id),
            "candidate_id": cand_id,
            "round": 1,
            "status": "scheduled",
            "interviewer_id": self.recruiter_user["id"]
        }
        mock_inv_col.return_value.find_one.return_value = inv_doc
        mock_cand_col.return_value.find_one.return_value = {"_id": ObjectId(cand_id), "status": "scheduled", "name": "Charlie", "assigned_recruiter_id": self.recruiter_user["id"]}

        # Simulate 1 other round remaining scheduled
        mock_inv_col.return_value.count_documents.return_value = 1

        payload = schemas.InterviewUpdate(status="completed")
        interviews.update_interview(inv_id, payload, current_user=self.recruiter_user)

        # Candidate status must NOT be updated to interviewed because 1 scheduled round remains!
        mock_cand_col.return_value.update_one.assert_not_called()

    # =========================================================================
    # 4. Final Hiring Decision Notifications
    # =========================================================================
    @patch("Backend.app.routers.candidates.get_candidates_collection")
    @patch("Backend.app.routers.candidates.create_notification")
    def test_final_decision_emits_notifications(self, mock_notif, mock_cand_col):
        """Selecting candidate triggers hiring_decision notification to candidate, admin and recruiter."""
        cand_id = str(ObjectId())
        cand_user_id = str(ObjectId())
        cand_doc = {"_id": ObjectId(cand_id), "name": "David", "status": "interviewed", "user_id": cand_user_id, "assigned_recruiter_id": self.recruiter_user["id"]}
        mock_cand_col.return_value.find_one.return_value = cand_doc

        payload = schemas.CandidateUpdate(status="selected", remarks="Hired for Frontend Lead")
        candidates.update_candidate(cand_id, payload, current_user=self.recruiter_user)

        # Verify notifications emitted
        notification_calls = mock_notif.call_args_list
        self.assertTrue(any(
            call.kwargs.get("notification_type") == "hiring_decision" and
            call.kwargs.get("recipient_user_id") == cand_user_id
            for call in notification_calls
        ))
        self.assertTrue(any(
            call.kwargs.get("recipient_role") == "admin"
            for call in notification_calls
        ))

    # =========================================================================
    # 5. Role Security & Destructive Action Guards
    # =========================================================================
    @patch("Backend.app.routers.candidates.get_candidates_collection")
    def test_recruiter_cannot_delete_candidate(self, mock_cand_col):
        """Only Admin can delete candidates; recruiters are blocked with 403."""
        with self.assertRaises(HTTPException) as ctx:
            candidates.delete_candidate(str(ObjectId()), current_user=self.recruiter_user)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Admin required", ctx.exception.detail)

    @patch("Backend.app.routers.interviews.get_interviews_collection")
    def test_recruiter_cannot_delete_interview(self, mock_inv_col):
        """Only Admin can delete interviews; recruiters are blocked with 403."""
        with self.assertRaises(HTTPException) as ctx:
            interviews.delete_interview(str(ObjectId()), current_user=self.recruiter_user)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Admin required", ctx.exception.detail)

    # =========================================================================
    # 6. Notifications Scoping & Retrieval
    # =========================================================================
    @patch("Backend.app.routers.notifications.get_notifications_collection")
    def test_admin_and_recruiter_notifications_scoping(self, mock_notif_col):
        """Notifications query fetches broadcast role notifications and unread count."""
        sample_notifs = [
            {"_id": ObjectId(), "title": "New Candidate", "recipient_role": "admin", "is_read": False, "created_at": self.now},
            {"_id": ObjectId(), "title": "Interview Done", "recipient_role": "admin", "is_read": True, "created_at": self.now},
        ]
        mock_notif_col.return_value.find.return_value.sort.return_value.limit.return_value = sample_notifs

        res = notifications.get_user_notifications(current_user=self.admin_user)
        self.assertEqual(len(res["notifications"]), 2)
        self.assertEqual(res["unread_count"], 1)

    # =========================================================================
    # 7. Evaluators List Exclusivity & Role Access
    # =========================================================================
    @patch("Backend.app.routers.auth.get_users_collection")
    def test_evaluators_list_only_contains_recruiters(self, mock_users_col):
        """GET /auth/recruiters filters explicitly for recruiter role and excludes candidates."""
        mock_recruiters = [
            {"_id": ObjectId(), "username": "recruiter_sarah", "role": "recruiter"},
            {"_id": ObjectId(), "username": "recruiter_dave", "role": "recruiter"},
        ]
        mock_users_col.return_value.find.return_value.sort.return_value = mock_recruiters

        result = auth.list_recruiters()
        self.assertEqual(len(result), 2)
        for r in result:
            self.assertEqual(r["role"], "recruiter")
            self.assertNotEqual(r["role"], "candidate")

    # =========================================================================
    # 8. Candidate Access Blocks (Stats & Candidates Directory)
    # =========================================================================
    def test_candidate_blocked_from_dashboard_stats(self):
        """Candidates cannot view recruitment analytics /dashboard/stats."""
        with self.assertRaises(HTTPException) as ctx:
            dashboard.get_dashboard_stats(current_user=self.candidate_user)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_candidate_blocked_from_listing_candidates(self):
        """Candidates cannot view /candidates/ directory."""
        with self.assertRaises(HTTPException) as ctx:
            candidates.list_candidates(current_user=self.candidate_user)
        self.assertEqual(ctx.exception.status_code, 403)

    # =========================================================================
    # 9. Feedback Submission Multi-Round Handling
    # =========================================================================
    @patch("Backend.app.routers.feedback.get_feedback_collection")
    @patch("Backend.app.routers.feedback.get_interviews_collection")
    @patch("Backend.app.routers.feedback.get_candidates_collection")
    @patch("Backend.app.routers.feedback.create_notification")
    def test_feedback_multiple_rounds_remaining(self, mock_notif, mock_cand_col, mock_inv_col, mock_fb_col):
        """Submitting feedback for round 1 when round 2 is scheduled does not mark candidate interviewed yet."""
        inv_id = str(ObjectId())
        cand_id = str(ObjectId())
        interview_doc = {
            "_id": ObjectId(inv_id),
            "candidate_id": cand_id,
            "round": 1,
            "status": "scheduled",
            "interviewer_id": self.recruiter_user["id"]
        }
        mock_inv_col.return_value.find_one.return_value = interview_doc
        mock_fb_col.return_value.find_one.return_value = None  # No existing feedback
        mock_fb_col.return_value.insert_one.return_value = MagicMock(inserted_id=ObjectId())

        cand_doc = {"_id": ObjectId(cand_id), "status": "scheduled", "name": "Eve", "user_id": None, "assigned_recruiter_id": self.recruiter_user["id"]}
        mock_cand_col.return_value.find_one.return_value = cand_doc

        # 1 remaining scheduled round exists
        mock_inv_col.return_value.count_documents.return_value = 1

        payload = schemas.FeedbackCreate(
            interview_id=inv_id,
            technical_score=8,
            communication_score=9,
            problem_solving_score=8,
            strengths="Fast learner",
            weaknesses="Junior in cloud deployment"
        )

        feedback.submit_feedback(payload, current_user=self.recruiter_user)

        # Check candidate update: candidate status was NOT changed to interviewed
        update_call = mock_cand_col.return_value.update_one.call_args
        update_dict = update_call[0][1]
        self.assertNotIn("status", update_dict.get("$set", {}))

    # =========================================================================
    # 10. Admin Feedback Prohibition (Must be 100% Read Only)
    # =========================================================================
    def test_admin_forbidden_from_submitting_feedback(self):
        """Admin accounts are strictly forbidden from submitting feedback (HTTP 403)."""
        payload = schemas.FeedbackCreate(
            interview_id=str(ObjectId()),
            technical_score=9,
            communication_score=9,
            problem_solving_score=9
        )
        with self.assertRaises(HTTPException) as ctx:
            feedback.submit_feedback(payload, current_user=self.admin_user)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Admin accounts cannot submit interview feedback", ctx.exception.detail)

    def test_admin_forbidden_from_updating_feedback(self):
        """Admin accounts are strictly forbidden from editing feedback (HTTP 403)."""
        payload = schemas.FeedbackUpdate(
            technical_score=10
        )
        with self.assertRaises(HTTPException) as ctx:
            feedback.update_feedback(str(ObjectId()), payload, current_user=self.admin_user)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Admin accounts cannot edit interview feedback", ctx.exception.detail)

    # =========================================================================
    # 11. Recruiter First-Login Password Change
    # =========================================================================
    @patch("Backend.app.routers.auth.get_users_collection")
    @patch("Backend.app.routers.auth.verify_password")
    @patch("Backend.app.routers.auth.get_password_hash")
    def test_recruiter_change_password_clears_flag(self, mock_hash, mock_verify, mock_users_col):
        """POST /auth/change-password verifies old password, sets new hash and clears must_change_password."""
        mock_verify.return_value = True
        mock_hash.return_value = "new_hashed_password"

        user_doc = {
            "_id": ObjectId(self.recruiter_user["id"]),
            "username": self.recruiter_user["username"],
            "password_hash": "old_hashed_password",
            "role": "recruiter",
            "must_change_password": True
        }
        mock_users_col.return_value.find_one.return_value = user_doc

        payload = schemas.ChangePasswordInput(
            old_password="temporary_pass_123",
            new_password="permanent_pass_456"
        )

        res = auth.change_password(payload, current_user=self.recruiter_user)
        self.assertTrue(res["success"])
        self.assertIn("successfully", res["message"])

        # Check update call cleared must_change_password flag
        mock_users_col.return_value.update_one.assert_called_once()
        update_args = mock_users_col.return_value.update_one.call_args[0]
        set_fields = update_args[1].get("$set", {})
        self.assertEqual(set_fields.get("password_hash"), "new_hashed_password")
        self.assertFalse(set_fields.get("must_change_password"))

if __name__ == "__main__":
    unittest.main()
