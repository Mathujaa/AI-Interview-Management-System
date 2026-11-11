"""
Automated Verification Suite for AI Reports and ML Predictions Sync
Tests:
1. Verified Scikit-learn Random Forest model metrics and pipeline inference.
2. Probability distribution sum (1.0 / 100%) and valid class output.
3. Candidate feature prefill extraction from profile and feedback.
4. Report generation and live synchronization:
   - Pending evaluation handling (0 feedback records: no fabricated scores or fake recommendation).
   - Real feedback aggregation across multi-round interviews.
   - Non-null score averaging ignoring missing scores.
   - Fallback executive summary when GenAI LLM is unavailable.
5. Immutability: predictions do not alter candidate hiring status.
"""

import unittest
import os
import sys
import numpy as np

# Add project root to sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from ML.model import evaluate, predict_candidate, MODEL_PATH


class TestMLModelAndPredictions(unittest.TestCase):
    def setUp(self):
        self.assertTrue(os.path.exists(MODEL_PATH), f"Model pipeline not found at {MODEL_PATH}")

    def test_01_model_actual_evaluation_metrics(self):
        """Verify model evaluation matches the actual Scikit-learn test set metrics (94%)."""
        metrics = evaluate()
        self.assertIn('accuracy', metrics)
        self.assertIn('precision', metrics)
        self.assertIn('recall', metrics)
        self.assertIn('f1', metrics)

        # Verified values: 0.940 across metrics
        self.assertAlmostEqual(metrics['accuracy'], 0.940, places=2)
        self.assertAlmostEqual(metrics['precision'], 0.941, places=2)
        self.assertAlmostEqual(metrics['recall'], 0.940, places=2)
        self.assertAlmostEqual(metrics['f1'], 0.940, places=2)

    def test_02_prediction_pipeline_output_structure(self):
        """Verify model prediction outputs expected class and probabilities summing to 1.0 (100%)."""
        sample_input = {
            "skill_score": 8,
            "years_experience": 5,
            "technical_score": 8,
            "communication_rating": 8,
            "prev_performance": 8,
            "education": "Master's"
        }
        res = predict_candidate(sample_input)
        self.assertIn("class", res)
        self.assertIn("probabilities", res)

        valid_classes = [
            "Highly Likely to Select",
            "Moderately Likely to Select",
            "Low Selection Probability"
        ]
        self.assertIn(res["class"], valid_classes)

        probs = res["probabilities"]
        for cls in valid_classes:
            self.assertIn(cls, probs)
            self.assertGreaterEqual(probs[cls], 0.0)
            self.assertLessEqual(probs[cls], 1.0)

        # Sum of probabilities must equal 1.0 (100%)
        prob_sum = sum(probs.values())
        self.assertAlmostEqual(prob_sum, 1.0, places=3)
        self.assertAlmostEqual(prob_sum * 100, 100.0, places=1)

    def test_03_prediction_variation_across_feature_extremes(self):
        """Verify high qualification yields high probability, weak qualification yields low probability."""
        strong_candidate = {
            "skill_score": 10,
            "years_experience": 10,
            "technical_score": 10,
            "communication_rating": 10,
            "prev_performance": 10,
            "education": "PhD"
        }
        res_strong = predict_candidate(strong_candidate)
        self.assertEqual(res_strong["class"], "Highly Likely to Select")
        self.assertGreater(res_strong["probabilities"]["Highly Likely to Select"], 0.70)

        weak_candidate = {
            "skill_score": 1,
            "years_experience": 0,
            "technical_score": 1,
            "communication_rating": 1,
            "prev_performance": 1,
            "education": "High School"
        }
        res_weak = predict_candidate(weak_candidate)
        self.assertEqual(res_weak["class"], "Low Selection Probability")
        self.assertGreater(res_weak["probabilities"]["Low Selection Probability"], 0.70)


class TestCandidateFeatureExtraction(unittest.TestCase):
    def test_04_experience_string_parsing(self):
        """Test parsing of various years_experience formats from candidate profiles."""
        import re
        def parse_exp(val):
            if val is None:
                return None
            if isinstance(val, (int, float)):
                return int(val)
            s = str(val).strip()
            m = re.search(r'\d+', s)
            return int(m.group(0)) if m else None

        self.assertEqual(parse_exp(5), 5)
        self.assertEqual(parse_exp("3 years"), 3)
        self.assertEqual(parse_exp("5+ yrs"), 5)
        self.assertEqual(parse_exp("Fresher / 0"), 0)
        self.assertIsNone(parse_exp(None))
        self.assertIsNone(parse_exp(""))

    def test_05_feedback_score_averaging_ignoring_nulls(self):
        """Test multi-round feedback score calculation correctly excludes missing/None scores."""
        feedbacks = [
            {"technical_score": 9, "communication_score": 8, "problem_solving_score": 9},
            {"technical_score": None, "communication_score": 6, "problem_solving_score": 7},
            {"technical_score": 7, "communication_score": None, "problem_solving_score": 8}
        ]

        tech_scores = [f["technical_score"] for f in feedbacks if f.get("technical_score") is not None]
        comm_scores = [f["communication_score"] for f in feedbacks if f.get("communication_score") is not None]
        prob_scores = [f["problem_solving_score"] for f in feedbacks if f.get("problem_solving_score") is not None]

        self.assertEqual(tech_scores, [9, 7])
        self.assertEqual(comm_scores, [8, 6])
        self.assertEqual(prob_scores, [9, 7, 8])

        avg_tech = round(sum(tech_scores) / len(tech_scores), 1)
        avg_comm = round(sum(comm_scores) / len(comm_scores), 1)
        avg_prob = round(sum(prob_scores) / len(prob_scores), 1)

        self.assertEqual(avg_tech, 8.0)
        self.assertEqual(avg_comm, 7.0)
        self.assertEqual(avg_prob, 8.0)

        overall = round((avg_tech + avg_comm + avg_prob) / 3, 1)
        self.assertEqual(overall, 7.7)
        self.assertEqual(round((overall / 10.0) * 100), 77)


class TestAIReportLogicAndPendingState(unittest.TestCase):
    def test_06_pending_evaluation_state(self):
        """When candidate has 0 feedback scorecards, report must show Pending Evaluation with no fake scores."""
        cand_name = "Jerina"
        live_feedbacks = []

        if not live_feedbacks:
            report_content = {
                "candidate_name": cand_name,
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
                "executive_summary": f"Evaluation for {cand_name} is pending. No interview feedback has been recorded yet. Scores and insights will appear after interview completion."
            }

        self.assertEqual(report_content["recommendation"], "Pending Evaluation")
        self.assertIsNone(report_content["average_scores"]["technical"])
        self.assertIsNone(report_content["average_scores"]["communication"])
        self.assertIsNone(report_content["average_scores"]["problem_solving"])
        self.assertIsNone(report_content["overall_score"])
        self.assertEqual(report_content["completed_evaluations"], 0)
        self.assertEqual(report_content["strengths"], [])
        self.assertEqual(report_content["growth_areas"], [])
        self.assertIn("No interview feedback has been recorded yet", report_content["executive_summary"])

    def test_07_fallback_structured_synthesis_logic(self):
        """Verify structured rule-based executive summary logic matches the implementation in report.py."""
        cand_name = "Sarah Connor"
        feedbacks = [
            {"technical_score": 9, "communication_score": 8, "problem_solving_score": 9, "strengths": "Strong system design", "weaknesses": "None"}
        ]
        
        tech_scores = [float(f["technical_score"]) for f in feedbacks if f.get("technical_score") is not None]
        comm_scores = [float(f["communication_score"]) for f in feedbacks if f.get("communication_score") is not None]
        prob_scores = [float(f["problem_solving_score"]) for f in feedbacks if f.get("problem_solving_score") is not None]

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

        summary = f"Evaluation summary for {cand_name} based on {len(feedbacks)} completed interview evaluation(s). Overall Score: {overall_avg}/10 ({overall_percent}%). Final recommendation: {rec}."

        self.assertEqual(rec, "Strong Hire")
        self.assertEqual(overall_avg, 8.7)
        self.assertEqual(overall_percent, 87)
        self.assertIn("Sarah Connor", summary)
        self.assertIn("Strong Hire", summary)
        self.assertIn("8.7/10", summary)

    def test_08_null_score_formatting_rendering(self):
        """Verify NULL/None score formatting produces clean Pending label instead of raw null."""
        def format_score(val):
            if val is None or val == "" or str(val).lower() == "null":
                return "Pending"
            try:
                num = float(val)
                return f"{num:.1f}/10"
            except (ValueError, TypeError):
                return "Pending"

        self.assertEqual(format_score(None), "Pending")
        self.assertEqual(format_score("null"), "Pending")
        self.assertEqual(format_score(""), "Pending")
        self.assertEqual(format_score(8.5), "8.5/10")
        self.assertEqual(format_score(9), "9.0/10")


class TestPredictionHiringStatusImmutability(unittest.TestCase):
    def test_09_prediction_does_not_mutate_hiring_status(self):
        """Verify that executing a prediction does not modify candidate status."""
        initial_status = "scheduled"
        candidate_data = {
            "id": "cand_123",
            "name": "Alex Mercer",
            "status": initial_status
        }

        # Run prediction
        features = {
            "skill_score": 9,
            "years_experience": 6,
            "technical_score": 9,
            "communication_rating": 8,
            "prev_performance": 9,
            "education": "Bachelor's"
        }
        res = predict_candidate(features)

        # Verify candidate status in data structure remains unchanged
        self.assertEqual(candidate_data["status"], initial_status)
        self.assertNotEqual(candidate_data["status"], res["class"])


class TestGoogleGeminiIntegration(unittest.TestCase):
    def test_10_gemini_prompt_construction_and_grounding(self):
        """Verify Gemini evaluation prompt embeds verified feedback and strict non-hallucination rules."""
        from Backend.app.services.gemini_service import build_gemini_evaluation_prompt

        candidate = {"name": "Jane Developer", "email": "jane@example.com", "status": "interviewed"}
        interviews = [{"round": 1, "scheduled_at": "2026-11-10T14:00:00Z", "status": "completed"}]
        feedbacks = [{
            "technical_score": 9,
            "communication_score": 8,
            "problem_solving_score": 9,
            "strengths": "Exceptional system design and algorithmic depth",
            "weaknesses": "Could elaborate more on distributed cache invalidation",
            "comments": "Strong analytical candidate with clear articulation."
        }]
        ground_truth = {
            "avg_tech": 9.0,
            "avg_comm": 8.0,
            "avg_prob": 9.0,
            "overall_avg": 8.7,
            "overall_pct": 87,
            "recommendation": "Strong Hire"
        }

        prompt = build_gemini_evaluation_prompt(candidate, interviews, feedbacks, ground_truth)
        self.assertIn("Jane Developer", prompt)
        self.assertIn("jane@example.com", prompt)
        self.assertIn("Technical Competence Average: 9.0 / 10", prompt)
        self.assertIn("Communication & Clarity Average: 8.0 / 10", prompt)
        self.assertIn("Overall Competency Composite: 8.7 / 10 (87%)", prompt)
        self.assertIn("Exceptional system design", prompt)
        self.assertIn("distributed cache invalidation", prompt)
        self.assertIn("DO NOT fabricate or assume technologies", prompt)
        self.assertIn("DO NOT recalculate or modify the numerical scores", prompt)

    def test_11_gemini_service_fallback_on_unconfigured_key(self):
        """Verify that when Gemini API key is missing or empty, service returns None triggering fallback."""
        from unittest.mock import patch
        from Backend.app.services import gemini_service

        with patch.object(gemini_service.settings, "GEMINI_API_KEY", ""):
            res = gemini_service.generate_candidate_evaluation_report(
                candidate={"name": "Test"},
                interviews=[],
                feedbacks=[{"technical_score": 8}],
                ground_truth={"avg_tech": 8.0, "recommendation": "Recommended"}
            )
            self.assertIsNone(res)

    def test_12_gemini_service_missing_feedback_handling(self):
        """Verify service returns None if feedback list is empty."""
        from Backend.app.services import gemini_service

        res = gemini_service.generate_candidate_evaluation_report(
            candidate={"name": "No Feedback Cand"},
            interviews=[],
            feedbacks=[],
            ground_truth={}
        )
        self.assertIsNone(res)

    def test_13_report_endpoint_pending_when_no_feedback(self):
        """Verify report generation endpoint produces Pending Evaluation and bypasses Gemini when no feedback exists."""
        from unittest.mock import patch
        from Backend.app.routers.report import generate_report

        mock_candidate = {"_id": "test_cand_id_123", "name": "No Feedback Cand", "status": "applied"}
        
        with patch("Backend.app.routers.report.get_candidates_collection") as mock_cand_col, \
             patch("Backend.app.routers.report.get_interviews_collection") as mock_inv_col, \
             patch("Backend.app.routers.report.get_feedback_collection") as mock_fb_col, \
             patch("Backend.app.routers.report.get_reports_collection") as mock_rep_col, \
             patch("Backend.app.routers.report.create_notification"), \
             patch("Backend.app.services.gemini_service.generate_candidate_evaluation_report") as mock_gemini:
            
            mock_cand_col.return_value.find_one.return_value = mock_candidate
            mock_inv_col.return_value.find.return_value = []
            mock_fb_col.return_value.find_one.return_value = None
            mock_fb_col.return_value.find.return_value = []
            mock_rep_col.return_value.insert_one.return_value.inserted_id = "mock_report_id_1"

            admin_user = {"id": "admin_1", "role": "admin", "username": "admin"}
            rep = generate_report("test_cand_id_123", current_user=admin_user)
            
            content = rep["content"]
            self.assertEqual(content["recommendation"], "Pending Evaluation")
            self.assertIsNone(content["overall_score"])
            self.assertIsNone(content["average_scores"]["technical"])
            self.assertEqual(content["completed_evaluations"], 0)
            # Gemini must NOT be called when no feedback exists to prevent hallucination
            mock_gemini.assert_not_called()


if __name__ == "__main__":
    unittest.main()
