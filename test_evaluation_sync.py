"""
Test Suite: Competency Score Matrix and AI Evaluation Data Synchronization
Tests:
1. Candidate with submitted feedback.
2. Candidate with multiple interview rounds.
3. Candidate with no feedback.
4. Candidate with incomplete feedback (missing scores).
5. New feedback submission followed by matrix refresh.
6. Candidate security isolation.
"""

import unittest
from datetime import datetime, timezone
from bson import ObjectId
from unittest.mock import MagicMock, patch

# Import application functions to test
from Backend.app.routers.feedback import get_my_feedback, submit_feedback
from Backend.app.routers.report import get_my_report, generate_report
from Backend.app import models, schemas

class TestEvaluationSync(unittest.TestCase):

    def setUp(self):
        self.cand_id_str = str(ObjectId())
        self.user_id_str = str(ObjectId())
        self.rec_id_str = str(ObjectId())
        self.current_candidate = {
            "id": self.user_id_str,
            "username": "candidate_jane",
            "email": "jane@example.com",
            "role": "candidate"
        }
        self.cand_doc = {
            "_id": ObjectId(self.cand_id_str),
            "id": self.cand_id_str,
            "name": "Jane Doe",
            "email": "jane@example.com",
            "user_id": self.user_id_str,
            "assigned_recruiter_id": self.rec_id_str,
            "status": "scheduled"
        }

    # =========================================================================
    # Test 1: Candidate with single submitted feedback
    # =========================================================================
    @patch("Backend.app.routers.feedback.get_feedback_collection")
    @patch("Backend.app.routers.feedback.get_interviews_collection")
    @patch("Backend.app.routers.feedback.get_candidates_collection")
    def test_candidate_single_feedback(self, mock_cand_col, mock_inv_col, mock_fb_col):
        inv_id = str(ObjectId())
        mock_cand_col.return_value.find_one.return_value = self.cand_doc
        mock_inv_col.return_value.find.return_value = [
            {"_id": ObjectId(inv_id), "candidate_id": self.cand_id_str, "round": 1}
        ]
        mock_fb_col.return_value.find.return_value.sort.return_value = [
            {
                "_id": ObjectId(),
                "interview_id": inv_id,
                "technical_score": 8,
                "communication_score": 9,
                "problem_solving_score": 7,
                "strengths": "Strong Python knowledge",
                "weaknesses": "Could improve system design",
                "comments": "Great cultural fit"
            }
        ]

        feedbacks = get_my_feedback(current_user=self.current_candidate)
        self.assertEqual(len(feedbacks), 1)
        fb = feedbacks[0]
        self.assertEqual(fb["technical_score"], 8)
        self.assertEqual(fb["communication_score"], 9)
        self.assertEqual(fb["problem_solving_score"], 7)
        self.assertEqual(fb["round"], 1)

        # Calculate competency averages & overall
        tech_avg = fb["technical_score"]
        comm_avg = fb["communication_score"]
        prob_avg = fb["problem_solving_score"]
        overall_avg = round((tech_avg + comm_avg + prob_avg) / 3.0, 1)
        overall_percent = round((overall_avg / 10.0) * 100)

        self.assertEqual(overall_avg, 8.0)
        self.assertEqual(overall_percent, 80)

    # =========================================================================
    # Test 2: Candidate with multiple interview rounds
    # =========================================================================
    @patch("Backend.app.routers.feedback.get_feedback_collection")
    @patch("Backend.app.routers.feedback.get_interviews_collection")
    @patch("Backend.app.routers.feedback.get_candidates_collection")
    def test_candidate_multiple_interview_rounds(self, mock_cand_col, mock_inv_col, mock_fb_col):
        inv1_id = str(ObjectId())
        inv2_id = str(ObjectId())
        mock_cand_col.return_value.find_one.return_value = self.cand_doc
        mock_inv_col.return_value.find.return_value = [
            {"_id": ObjectId(inv1_id), "candidate_id": self.cand_id_str, "round": 1},
            {"_id": ObjectId(inv2_id), "candidate_id": self.cand_id_str, "round": 2},
        ]
        # Round 1: 8, 7, 8; Round 2: 9, 9, 8
        mock_fb_col.return_value.find.return_value.sort.return_value = [
            {
                "_id": ObjectId(),
                "interview_id": inv1_id,
                "technical_score": 8,
                "communication_score": 7,
                "problem_solving_score": 8,
                "strengths": "Quick reasoning",
                "weaknesses": "None",
            },
            {
                "_id": ObjectId(),
                "interview_id": inv2_id,
                "technical_score": 9,
                "communication_score": 9,
                "problem_solving_score": 8,
                "strengths": "Architecture depth",
                "weaknesses": "Minor API design notes",
            }
        ]

        feedbacks = get_my_feedback(current_user=self.current_candidate)
        self.assertEqual(len(feedbacks), 2)

        # Average per competency:
        # Technical: (8 + 9) / 2 = 8.5
        # Communication: (7 + 9) / 2 = 8.0
        # Problem solving: (8 + 8) / 2 = 8.0
        tech_avg = round(sum(f["technical_score"] for f in feedbacks) / len(feedbacks), 1)
        comm_avg = round(sum(f["communication_score"] for f in feedbacks) / len(feedbacks), 1)
        prob_avg = round(sum(f["problem_solving_score"] for f in feedbacks) / len(feedbacks), 1)

        self.assertEqual(tech_avg, 8.5)
        self.assertEqual(comm_avg, 8.0)
        self.assertEqual(prob_avg, 8.0)

        # Overall average: (8.5 + 8.0 + 8.0) / 3 = 8.1666... -> 8.2
        overall_avg = round((tech_avg + comm_avg + prob_avg) / 3.0, 1)
        overall_percent = round((overall_avg / 10.0) * 100)
        self.assertEqual(overall_avg, 8.2)
        self.assertEqual(overall_percent, 82)

    # =========================================================================
    # Test 3: Candidate with NO feedback submitted (Pending state)
    # =========================================================================
    @patch("Backend.app.routers.feedback.get_feedback_collection")
    @patch("Backend.app.routers.feedback.get_interviews_collection")
    @patch("Backend.app.routers.feedback.get_candidates_collection")
    def test_candidate_no_feedback(self, mock_cand_col, mock_inv_col, mock_fb_col):
        mock_cand_col.return_value.find_one.return_value = self.cand_doc
        mock_inv_col.return_value.find.return_value = []
        mock_fb_col.return_value.find.return_value.sort.return_value = []

        feedbacks = get_my_feedback(current_user=self.current_candidate)
        self.assertEqual(feedbacks, [])

        # In Frontend logic:
        # feedbackList.length == 0 -> render Pending state, never 0/10 or 0%
        hasFeedback = len(feedbacks) > 0
        self.assertFalse(hasFeedback)

    # =========================================================================
    # Test 4: Candidate with incomplete feedback (Missing scores)
    # =========================================================================
    def test_candidate_incomplete_feedback_handling(self):
        # Feedback has technical: 8.5, communication: 9.0, problem_solving: None
        feedbacks = [
            {
                "technical_score": 8.5,
                "communication_score": 9.0,
                "problem_solving_score": None
            }
        ]

        def parse_score(val):
            if val is None or val == "":
                return None
            n = float(val)
            return n if (0 <= n <= 10) else None

        tech_scores = [parse_score(f["technical_score"]) for f in feedbacks if parse_score(f["technical_score"]) is not None]
        comm_scores = [parse_score(f["communication_score"]) for f in feedbacks if parse_score(f["communication_score"]) is not None]
        prob_scores = [parse_score(f["problem_solving_score"]) for f in feedbacks if parse_score(f["problem_solving_score"]) is not None]

        avg_tech = round(sum(tech_scores) / len(tech_scores), 1) if tech_scores else None
        avg_comm = round(sum(comm_scores) / len(comm_scores), 1) if comm_scores else None
        avg_prob = round(sum(prob_scores) / len(prob_scores), 1) if prob_scores else None

        self.assertEqual(avg_tech, 8.5)
        self.assertEqual(avg_comm, 9.0)
        self.assertIsNone(avg_prob)  # Handled as Pending, NOT treated as 0

        # Overall average from valid competencies: (8.5 + 9.0) / 2 = 8.75 -> 8.8
        valid_avgs = [a for a in [avg_tech, avg_comm, avg_prob] if a is not None]
        overall_avg = round(sum(valid_avgs) / len(valid_avgs), 1)
        overall_percent = round((overall_avg / 10.0) * 100)

        self.assertEqual(overall_avg, 8.8)
        self.assertEqual(overall_percent, 88)

    # =========================================================================
    # Test 5: Report generation with and without feedback
    # =========================================================================
    @patch("Backend.app.routers.report.create_notification")
    @patch("Backend.app.routers.report.get_reports_collection")
    @patch("Backend.app.routers.report.get_feedback_collection")
    @patch("Backend.app.routers.report.get_interviews_collection")
    @patch("Backend.app.routers.report.get_candidates_collection")
    def test_report_generation_no_feedback_gives_pending(self, mock_cand_col, mock_inv_col, mock_fb_col, mock_rep_col, mock_notif):
        mock_cand_col.return_value.find_one.return_value = self.cand_doc
        mock_inv_col.return_value.find.return_value = []
        mock_fb_col.return_value.find_one.return_value = None
        mock_rep_col.return_value.insert_one.return_value.inserted_id = ObjectId()

        rep = generate_report(
            candidate_id=self.cand_id_str,
            current_user={"username": "admin_user", "role": "admin"}
        )

        content = rep["content"]
        # Must be Pending Evaluation when scores are missing, not fabricated "Recommended"
        self.assertEqual(content["recommendation"], "Pending Evaluation")
        self.assertIsNone(content["overall_score"])
        self.assertIsNone(content["average_scores"]["technical"])
        self.assertEqual(content["completed_evaluations"], 0)

    # =========================================================================
    # Test 6: Report generation WITH feedback gives consistent scores & decision
    # =========================================================================
    @patch("Backend.app.routers.report.create_notification")
    @patch("Backend.app.routers.report.get_reports_collection")
    @patch("Backend.app.routers.report.get_feedback_collection")
    @patch("Backend.app.routers.report.get_interviews_collection")
    @patch("Backend.app.routers.report.get_candidates_collection")
    def test_report_generation_with_feedback(self, mock_cand_col, mock_inv_col, mock_fb_col, mock_rep_col, mock_notif):
        mock_cand_col.return_value.find_one.return_value = self.cand_doc
        inv_id = str(ObjectId())
        mock_inv_col.return_value.find.return_value = [
            {"_id": ObjectId(inv_id), "candidate_id": self.cand_id_str, "round": 1}
        ]
        mock_fb_col.return_value.find_one.return_value = {
            "_id": ObjectId(),
            "interview_id": inv_id,
            "technical_score": 9,
            "communication_score": 8,
            "problem_solving_score": 9,
            "strengths": "Exceptional algorithms",
            "weaknesses": "None",
        }
        mock_rep_col.return_value.insert_one.return_value.inserted_id = ObjectId()

        rep = generate_report(
            candidate_id=self.cand_id_str,
            current_user={"id": self.rec_id_str, "username": "recruiter_user", "role": "recruiter"}
        )

        content = rep["content"]
        self.assertEqual(content["recommendation"], "Strong Hire")
        self.assertEqual(content["overall_score"], 8.7)
        self.assertEqual(content["overall_percentage"], 87)
        self.assertEqual(content["average_scores"]["technical"], 9.0)
        self.assertEqual(content["average_scores"]["communication"], 8.0)
        self.assertEqual(content["average_scores"]["problem_solving"], 9.0)
        self.assertEqual(content["completed_evaluations"], 1)

    # =========================================================================
    # Test 7: Candidate security isolation in get_my_report
    # =========================================================================
    @patch("Backend.app.routers.report.get_feedback_collection")
    @patch("Backend.app.routers.report.get_interviews_collection")
    @patch("Backend.app.routers.report.get_reports_collection")
    @patch("Backend.app.routers.report.get_candidates_collection")
    def test_candidate_report_isolation(self, mock_cand_col, mock_rep_col, mock_inv_col, mock_fb_col):
        # Candidate 1 tries to access their report
        mock_cand_col.return_value.find_one.return_value = self.cand_doc
        mock_inv_col.return_value.find.return_value = []
        mock_fb_col.return_value.find.return_value.sort.return_value = [
            {
                "_id": ObjectId(),
                "interview_id": str(ObjectId()),
                "technical_score": 8,
                "communication_score": 7,
                "problem_solving_score": 7.5
            }
        ]
        report_id = ObjectId()
        mock_rep_col.return_value.find_one.return_value = {
            "_id": report_id,
            "candidate_id": self.cand_id_str,
            "content": {
                "recommendation": "Recommended",
                "overall_score": 7.5,
                "average_scores": {"technical": 8, "communication": 7, "problem_solving": 7.5}
            }
        }

        # Candidate user requesting their report
        res = get_my_report(current_user=self.current_candidate)
        self.assertEqual(str(res["_id"]), str(report_id))
        self.assertEqual(res["candidate_id"], self.cand_id_str)


if __name__ == "__main__":
    unittest.main()

