"""
test_recruiter_portal.py - Unit tests for Recruiter Portal RBAC & Candidate Assignment
Verifies:
1. Admin candidate assignment (Admin only, recruiter notification, 403 for non-admins).
2. Candidate directory isolation (Recruiters query only candidates assigned to them).
3. Candidate access control (Recruiters cannot view, update, or delete unassigned candidates).
4. Interview scheduling isolation (Recruiters can only schedule for assigned candidates; interviewer forced to current recruiter).
5. Feedback access control (Recruiters can only submit feedback for their assigned interviews/candidates).
6. Recruiter dashboard stats (Portfolio-scoped counts for recruiter).
"""

import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone
from bson import ObjectId
from fastapi import HTTPException

from Backend.app import models, schemas
from Backend.app.routers import candidates, interviews, feedback, dashboard


class TestRecruiterPortalRBAC(unittest.TestCase):

    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.admin_user = {"id": str(ObjectId()), "username": "admin_user", "role": "admin"}
        self.recruiter1_user = {"id": str(ObjectId()), "username": "recruiter1", "role": "recruiter"}
        self.recruiter2_user = {"id": str(ObjectId()), "username": "recruiter2", "role": "recruiter"}
        self.candidate_user = {"id": str(ObjectId()), "username": "cand_user", "role": "candidate"}

    # -------------------------------------------------------------------------
    # 1. CANDIDATE ASSIGNMENT RBAC
    # -------------------------------------------------------------------------
    @patch("Backend.app.routers.candidates.create_notification")
    @patch("Backend.app.routers.candidates.get_users_collection")
    @patch("Backend.app.routers.candidates.get_candidates_collection")
    def test_admin_can_assign_candidate_to_recruiter(self, mock_cand_col, mock_users_col, mock_notif):
        cand_id = str(ObjectId())
        mock_cand_col.return_value.find_one.side_effect = [
            # First find_one before update
            {
                "_id": ObjectId(cand_id),
                "name": "Jane Doe",
                "email": "jane@example.com",
                "status": "applied",
                "assigned_recruiter_id": None,
                "status_history": []
            },
            # Second find_one after update
            {
                "_id": ObjectId(cand_id),
                "name": "Jane Doe",
                "email": "jane@example.com",
                "status": "applied",
                "assigned_recruiter_id": self.recruiter1_user["id"],
                "assigned_recruiter_name": "recruiter1",
                "status_history": []
            }
        ]
        mock_users_col.return_value.find_one.return_value = {
            "_id": ObjectId(self.recruiter1_user["id"]),
            "username": "recruiter1",
            "role": "recruiter"
        }
        mock_cand_col.return_value.update_one.return_value = MagicMock(modified_count=1)

        payload = schemas.AssignRecruiterInput(recruiter_id=self.recruiter1_user["id"])
        res = candidates.assign_candidate_recruiter(cand_id, payload, current_user=self.admin_user)

        self.assertEqual(res["assigned_recruiter_id"], self.recruiter1_user["id"])
        mock_notif.assert_called_once()

    def test_recruiter_cannot_assign_recruiter(self):
        cand_id = str(ObjectId())
        payload = schemas.AssignRecruiterInput(recruiter_id=self.recruiter1_user["id"])
        with self.assertRaises(HTTPException) as ctx:
            candidates.assign_candidate_recruiter(cand_id, payload, current_user=self.recruiter1_user)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_candidate_cannot_assign_recruiter(self):
        cand_id = str(ObjectId())
        payload = schemas.AssignRecruiterInput(recruiter_id=self.recruiter1_user["id"])
        with self.assertRaises(HTTPException) as ctx:
            candidates.assign_candidate_recruiter(cand_id, payload, current_user=self.candidate_user)
        self.assertEqual(ctx.exception.status_code, 403)

    # -------------------------------------------------------------------------
    # 2. CANDIDATE DIRECTORY & ACCESS ISOLATION
    # -------------------------------------------------------------------------
    @patch("Backend.app.routers.candidates.get_candidates_collection")
    def test_recruiter_list_candidates_queries_assigned_only(self, mock_cand_col):
        mock_cand_col.return_value.find.return_value.sort.return_value.skip.return_value.limit.return_value = [
            {
                "_id": ObjectId(),
                "name": "Assigned Cand",
                "email": "a@example.com",
                "status": "applied",
                "assigned_recruiter_id": self.recruiter1_user["id"],
                "created_at": datetime.now(timezone.utc)
            }
        ]

        res = candidates.list_candidates(current_user=self.recruiter1_user)
        self.assertEqual(len(res), 1)
        args, kwargs = mock_cand_col.return_value.find.call_args
        query = args[0]
        self.assertIn("$or", query)
        self.assertTrue(any("assigned_recruiter_id" in item for item in query["$or"]))

    @patch("Backend.app.routers.candidates.get_candidates_collection")
    def test_recruiter_cannot_view_unassigned_candidate(self, mock_cand_col):
        cand_id = str(ObjectId())
        mock_cand_col.return_value.find_one.return_value = {
            "_id": ObjectId(cand_id),
            "name": "Other Cand",
            "email": "other@example.com",
            "status": "applied",
            "assigned_recruiter_id": self.recruiter2_user["id"]
        }

        with self.assertRaises(HTTPException) as ctx:
            candidates.get_candidate(cand_id, current_user=self.recruiter1_user)
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("Backend.app.routers.candidates.get_candidates_collection")
    def test_recruiter_cannot_update_unassigned_candidate(self, mock_cand_col):
        cand_id = str(ObjectId())
        mock_cand_col.return_value.find_one.return_value = {
            "_id": ObjectId(cand_id),
            "name": "Other Cand",
            "email": "other@example.com",
            "status": "applied",
            "assigned_recruiter_id": self.recruiter2_user["id"]
        }

        payload = schemas.CandidateUpdate(name="Hacked Name")
        with self.assertRaises(HTTPException) as ctx:
            candidates.update_candidate(cand_id, payload, current_user=self.recruiter1_user)
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("Backend.app.routers.candidates.get_candidates_collection")
    def test_recruiter_cannot_delete_candidate(self, mock_cand_col):
        cand_id = str(ObjectId())
        with self.assertRaises(HTTPException) as ctx:
            candidates.delete_candidate(cand_id, current_user=self.recruiter1_user)
        self.assertEqual(ctx.exception.status_code, 403)

    # -------------------------------------------------------------------------
    # 3. INTERVIEW SCHEDULING & ISOLATION
    # -------------------------------------------------------------------------
    @patch("Backend.app.routers.interviews.get_candidates_collection")
    def test_recruiter_cannot_schedule_for_unassigned_candidate(self, mock_cand_col):
        cand_id = str(ObjectId())
        mock_cand_col.return_value.find_one.return_value = {
            "_id": ObjectId(cand_id),
            "name": "Other Cand",
            "email": "other@example.com",
            "status": "applied",
            "assigned_recruiter_id": self.recruiter2_user["id"]
        }

        payload = schemas.InterviewCreate(
            candidate_id=cand_id,
            interviewer_id=self.recruiter1_user["id"],
            scheduled_at=self.now,
            round=1
        )
        with self.assertRaises(HTTPException) as ctx:
            interviews.schedule_interview(payload, current_user=self.recruiter1_user)
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("Backend.app.routers.interviews.create_notification")
    @patch("Backend.app.routers.interviews.get_users_collection")
    @patch("Backend.app.routers.interviews.get_interviews_collection")
    @patch("Backend.app.routers.interviews.get_candidates_collection")
    def test_recruiter_schedule_enforces_evaluator_identity(self, mock_cand_col, mock_inv_col, mock_usr_col, mock_notif):
        cand_id = str(ObjectId())
        mock_cand_col.return_value.find_one.return_value = {
            "_id": ObjectId(cand_id),
            "name": "My Cand",
            "email": "my@example.com",
            "status": "shortlisted",
            "user_id": None,
            "assigned_recruiter_id": self.recruiter1_user["id"]
        }
        mock_usr_col.return_value.find_one.return_value = {
            "_id": ObjectId(self.recruiter1_user["id"]),
            "username": "recruiter1",
            "role": "recruiter"
        }
        mock_inv_col.return_value.find_one.return_value = None
        mock_inv_col.return_value.insert_one.return_value = MagicMock(inserted_id=ObjectId())

        # Attempt to pass recruiter2_id as interviewer
        payload = schemas.InterviewCreate(
            candidate_id=cand_id,
            interviewer_id=self.recruiter2_user["id"],
            scheduled_at=self.now,
            round=1
        )
        res = interviews.schedule_interview(payload, current_user=self.recruiter1_user)

        # Enforced to recruiter1
        self.assertEqual(res["interviewer_id"], self.recruiter1_user["id"])
        self.assertEqual(res["interviewer_name"], "recruiter1")

    @patch("Backend.app.routers.interviews.get_interviews_collection")
    def test_recruiter_cannot_delete_interview(self, mock_inv_col):
        inv_id = str(ObjectId())
        with self.assertRaises(HTTPException) as ctx:
            interviews.delete_interview(inv_id, current_user=self.recruiter1_user)
        self.assertEqual(ctx.exception.status_code, 403)

    # -------------------------------------------------------------------------
    # 4. FEEDBACK ACCESS CONTROL
    # -------------------------------------------------------------------------
    @patch("Backend.app.routers.feedback.get_interviews_collection")
    @patch("Backend.app.routers.feedback.get_candidates_collection")
    def test_recruiter_cannot_submit_feedback_for_unassigned_candidate(self, mock_cand_col, mock_inv_col):
        cand_id = str(ObjectId())
        inv_id = str(ObjectId())
        mock_inv_col.return_value.find_one.return_value = {
            "_id": ObjectId(inv_id),
            "candidate_id": cand_id,
            "round": 1,
            "status": "scheduled",
            "interviewer_id": self.recruiter2_user["id"]
        }
        mock_cand_col.return_value.find_one.return_value = {
            "_id": ObjectId(cand_id),
            "name": "Cand B",
            "assigned_recruiter_id": self.recruiter2_user["id"]
        }

        payload = schemas.FeedbackCreate(
            interview_id=inv_id,
            technical_score=8,
            communication_score=8,
            problem_solving_score=8,
            strengths="Great",
            weaknesses="None",
            comments="Good job"
        )
        with self.assertRaises(HTTPException) as ctx:
            feedback.submit_feedback(payload, current_user=self.recruiter1_user)
        self.assertEqual(ctx.exception.status_code, 403)

    # -------------------------------------------------------------------------
    # 5. DASHBOARD STATS SCOPING
    # -------------------------------------------------------------------------
    @patch("Backend.app.routers.dashboard.get_feedback_collection")
    @patch("Backend.app.routers.dashboard.get_interviews_collection")
    @patch("Backend.app.routers.dashboard.get_candidates_collection")
    def test_recruiter_dashboard_stats_are_scoped(self, mock_cand_col, mock_inv_col, mock_fb_col):
        mock_cand_col.return_value.find.return_value = [
            {"_id": ObjectId(), "status": "shortlisted", "assigned_recruiter_id": self.recruiter1_user["id"]},
            {"_id": ObjectId(), "status": "applied", "assigned_recruiter_id": self.recruiter1_user["id"]}
        ]
        mock_inv_col.return_value.find.return_value = [
            {"_id": ObjectId(), "status": "scheduled", "scheduled_at": "2026-05-01T00:00:00"}
        ]
        mock_fb_col.return_value.find.return_value = []

        stats = dashboard.get_dashboard_stats(current_user=self.recruiter1_user)
        self.assertEqual(stats.total_candidates, 2)
        self.assertEqual(stats.shortlisted_candidates, 1)
        self.assertEqual(stats.upcoming_interviews, 1)
        self.assertEqual(stats.completed_interviews, 0)


if __name__ == "__main__":
    unittest.main()
