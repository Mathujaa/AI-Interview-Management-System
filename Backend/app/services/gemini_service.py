"""
Google Gemini LLM Integration Service
Provides structured candidate evaluation synthesis using the Google Gemini REST API.
Enforces ground-truth score preservation and automatic fallback on API error or missing credentials.
"""

import os
import re
import json
import logging
from typing import Dict, Any, List, Optional
import requests

from ..config import settings

logger = logging.getLogger("gemini_service")

# Default canonical recommendations based on recruitment score brackets
VALID_RECOMMENDATIONS = {"Strong Hire", "Recommended", "Under Review", "Needs Improvement"}


def is_gemini_configured() -> bool:
    """Returns True if a non-empty GEMINI_API_KEY is configured."""
    key = settings.GEMINI_API_KEY or ""
    return bool(key and key.strip())


def sanitize_error(text: str) -> str:
    """Masks API keys and sensitive tokens from error messages and logs."""
    if not text:
        return ""
    return re.sub(r'key=[^&\s"\']+', 'key=****', str(text))


def build_gemini_evaluation_prompt(
    candidate: Dict[str, Any],
    interviews: List[Dict[str, Any]],
    feedbacks: List[Dict[str, Any]],
    ground_truth: Dict[str, Any]
) -> str:
    """
    Constructs a grounded, instruction-dense prompt for Gemini.
    The LLM is provided with factual recruiter observations and scores,
    and is strictly constrained to synthesize a structured JSON narrative without inventing facts.
    """
    cand_name = candidate.get("name", "Candidate")
    cand_email = candidate.get("email", "N/A")
    cand_status = candidate.get("status", "applied")

    avg_tech = ground_truth.get("avg_tech", "N/A")
    avg_comm = ground_truth.get("avg_comm", "N/A")
    avg_prob = ground_truth.get("avg_prob", "N/A")
    overall_avg = ground_truth.get("overall_avg", "N/A")
    overall_pct = ground_truth.get("overall_pct", "N/A")
    baseline_rec = ground_truth.get("recommendation", "Recommended")

    # Format interview rounds
    inv_lines = []
    for idx, inv in enumerate(interviews, start=1):
        round_num = inv.get("round", idx)
        status_val = inv.get("status", "completed")
        sched = inv.get("scheduled_at", "N/A")
        inv_lines.append(f"  - Round {round_num}: Scheduled at {sched} (Status: {status_val})")
    inv_section = "\n".join(inv_lines) if inv_lines else "  - No interview schedule metadata available."

    # Format recruiter feedback observations
    fb_lines = []
    all_strengths = []
    all_weaknesses = []
    all_comments = []

    for idx, fb in enumerate(feedbacks, start=1):
        t = fb.get("technical_score", "N/A")
        c = fb.get("communication_score", "N/A")
        p = fb.get("problem_solving_score", "N/A")
        s = fb.get("strengths") or ""
        w = fb.get("weaknesses") or ""
        comm = fb.get("comments") or ""

        if s:
            all_strengths.append(s)
        if w:
            all_weaknesses.append(w)
        if comm:
            all_comments.append(comm)

        fb_lines.append(
            f"  - Evaluation #{idx}: Technical Score={t}/10, Communication Score={c}/10, Problem Solving Score={p}/10\n"
            f"    Recorded Strengths: {s if s else 'None specified'}\n"
            f"    Areas for Growth: {w if w else 'None specified'}\n"
            f"    Evaluator Remarks: {comm if comm else 'None specified'}"
        )
    fb_section = "\n".join(fb_lines) if fb_lines else "  - No feedback records available."

    prompt = f"""You are an executive talent assessment and technical recruitment evaluator for an enterprise hiring system.
Synthesize an objective, professional, and holistic interview evaluation report for the following candidate based strictly on the verified interviewer records provided below.

GROUND-TRUTH INTERVIEW EVALUATION DATA:
Candidate: {cand_name} (Email: {cand_email}, Status: {cand_status})
Completed Interview Rounds: {len(feedbacks)} of {len(interviews)}

VERIFIED COMPETENCY SCORES (Pre-calculated by scoring system):
- Technical Competence Average: {avg_tech} / 10
- Communication & Clarity Average: {avg_comm} / 10
- Problem Solving & Logic Average: {avg_prob} / 10
- Overall Competency Composite: {overall_avg} / 10 ({overall_pct}%)
- System Baseline Recommendation: {baseline_rec}

INTERVIEW SESSIONS:
{inv_section}

INTERVIEWER EVALUATION OBSERVATIONS & SCORECARDS:
{fb_section}

STRICT CONSTRAINTS & INSTRUCTIONS:
1. Ground all observations strictly in the recruiter scorecards and remarks above.
2. DO NOT fabricate or assume technologies, projects, previous companies, or qualifications not mentioned in the remarks.
3. DO NOT recalculate or modify the numerical scores.
4. Provide a professional, executive-level narrative synthesis.
5. Return ONLY a valid JSON object matching the exact schema below.

REQUIRED JSON SCHEMA:
{{
  "executive_summary": "Comprehensive 2-3 paragraph professional narrative analyzing the candidate's demonstrated technical proficiency, communication effectiveness, problem-solving methodology, and overall team/culture alignment based on the interview rounds.",
  "strengths": [
    "Key concrete strength 1 observed during interviews",
    "Key concrete strength 2 observed during interviews",
    "Key concrete strength 3 observed during interviews"
  ],
  "growth_areas": [
    "Constructive development area 1 identified by evaluators",
    "Constructive development area 2 identified by evaluators"
  ],
  "recommendation": "{baseline_rec}"
}}
"""
    return prompt.strip()


def call_gemini_api(prompt: str, model: Optional[str] = None, timeout: int = 15) -> Optional[Dict[str, Any]]:
    """
    Executes a direct HTTPS request to the official Google Gemini generateContent REST endpoint.
    Configures JSON output mode (responseMimeType: application/json) and low temperature for determinism.
    Returns parsed JSON dictionary or None on failure (ensuring safe fallback).
    """
    api_key = settings.GEMINI_API_KEY or ""
    if not api_key or not api_key.strip():
        logger.info("Gemini API key is not configured. Falling back to deterministic synthesis.")
        return None

    target_model = model or getattr(settings, "GEMINI_MODEL", "gemini-3.8-flash") or "gemini-3.8-flash"
    # Ensure model has no leading 'models/' in endpoint path
    if target_model.startswith("models/"):
        target_model = target_model.replace("models/", "")

    endpoint_url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={api_key.strip()}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json"
        }
    }

    try:
        response = requests.post(
            endpoint_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=timeout
        )

        if response.status_code != 200:
            safe_err = sanitize_error(response.text[:300])
            logger.warning(f"Google Gemini API error HTTP {response.status_code}: {safe_err}")
            return None

        result_data = response.json()
        candidates = result_data.get("candidates", [])
        if not candidates:
            logger.warning("Gemini response contained no candidates.")
            return None

        first_part = candidates[0].get("content", {}).get("parts", [{}])[0]
        raw_text = first_part.get("text", "").strip()

        if not raw_text:
            logger.warning("Gemini returned empty text in candidate part.")
            return None

        # Parse generated JSON
        parsed_json = json.loads(raw_text)
        if not isinstance(parsed_json, dict):
            logger.warning("Gemini returned non-dictionary JSON.")
            return None

        return parsed_json

    except requests.exceptions.Timeout:
        logger.warning(f"Google Gemini API timed out after {timeout} seconds. Falling back to local synthesis.")
        return None
    except requests.exceptions.RequestException as e:
        safe_msg = sanitize_error(str(e))
        logger.warning(f"Network error calling Google Gemini: {safe_msg}. Falling back to local synthesis.")
        return None
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse Gemini output as JSON: {e}. Falling back to local synthesis.")
        return None
    except Exception as e:
        safe_msg = sanitize_error(str(e))
        logger.warning(f"Unexpected error in Gemini service: {safe_msg}. Falling back to local synthesis.")
        return None


def generate_candidate_evaluation_report(
    candidate: Dict[str, Any],
    interviews: List[Dict[str, Any]],
    feedbacks: List[Dict[str, Any]],
    ground_truth: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Coordinates prompt construction and Gemini API invocation.
    Validates and normalizes the qualitative output, then returns a dictionary
    containing 'executive_summary', 'strengths', 'growth_areas', and 'recommendation'.
    Returns None if Gemini is disabled or fails, prompting local fallback.
    """
    if not is_gemini_configured():
        return None

    if not feedbacks:
        return None

    prompt = build_gemini_evaluation_prompt(candidate, interviews, feedbacks, ground_truth)
    model_name = getattr(settings, "GEMINI_MODEL", "gemini-3.8-flash")
    gemini_output = call_gemini_api(prompt, model=model_name)

    if not gemini_output or not isinstance(gemini_output, dict):
        return None

    # Validate output structure
    summary = gemini_output.get("executive_summary") or gemini_output.get("summary")
    if not summary or not isinstance(summary, str) or len(summary.strip()) < 20:
        return None

    strengths = gemini_output.get("strengths")
    if not isinstance(strengths, list) or len(strengths) == 0:
        strengths = [s for s in [f.get("strengths") for f in feedbacks if f.get("strengths")] if s]
        if not strengths:
            strengths = ["Demonstrated core competence across evaluated interview rounds."]

    growth_areas = gemini_output.get("growth_areas") or gemini_output.get("weaknesses")
    if not isinstance(growth_areas, list) or len(growth_areas) == 0:
        growth_areas = [w for w in [f.get("weaknesses") for f in feedbacks if f.get("weaknesses")] if w]
        if not growth_areas:
            growth_areas = ["Continue expanding technical depth and exploring advanced architectural patterns."]

    # Validate recommendation
    rec = gemini_output.get("recommendation", ground_truth.get("recommendation", "Recommended"))
    if rec not in VALID_RECOMMENDATIONS:
        # Align recommendation with baseline ground truth if unrecognized
        rec = ground_truth.get("recommendation", "Recommended")

    return {
        "executive_summary": summary.strip(),
        "strengths": [str(s).strip() for s in strengths if str(s).strip()],
        "growth_areas": [str(g).strip() for g in growth_areas if str(g).strip()],
        "recommendation": rec,
        "ai_provider": f"Google Gemini ({model_name})"
    }
