from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator, model_validator
from typing import Optional, List, Union, Any
from datetime import datetime

# Authentication schemas
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = Field(..., pattern="^(admin|recruiter|candidate)$")

class CandidateRegister(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class ChangePasswordInput(BaseModel):
    old_password: str
    new_password: str

class UserOut(BaseModel):
    id: str
    username: str
    role: str

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", mode="before")
    @classmethod
    def convert_id(cls, v):
        return str(v) if v is not None else ""

# Status History Schema
class StatusHistoryItem(BaseModel):
    previous_status: Optional[str] = None
    new_status: Optional[str] = None
    status: Optional[str] = None
    updated_by: Optional[str] = "System"
    timestamp: Optional[datetime] = None
    remarks: Optional[str] = None

    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def sync_status_keys(cls, data):
        if isinstance(data, dict):
            status_val = data.get("new_status") or data.get("status") or "applied"
            data["new_status"] = status_val
            data["status"] = status_val
        return data

# Candidate schemas
class CandidateBase(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    role: Optional[str] = None
    job_role: Optional[str] = None
    experience: Optional[Union[float, int, str]] = None
    skills: Optional[Union[List[str], str]] = None
    assigned_recruiter_id: Optional[str] = None
    assigned_recruiter_name: Optional[str] = None

class CandidateCreate(CandidateBase):
    pass

class CandidateUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    remarks: Optional[str] = None
    assigned_recruiter_id: Optional[str] = None
    assigned_recruiter_name: Optional[str] = None

class AssignRecruiterInput(BaseModel):
    recruiter_id: Optional[str] = None

class CandidateOut(CandidateBase):
    id: str
    status: str
    user_id: Optional[str] = None
    recruiter_id: Optional[str] = None
    assigned_recruiter_id: Optional[str] = None
    assigned_recruiter_name: Optional[str] = None
    status_history: List[StatusHistoryItem] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", mode="before")
    @classmethod
    def convert_id(cls, v):
        return str(v) if v is not None else ""

# Notification Schema
class NotificationOut(BaseModel):
    id: str
    title: str
    message: str
    recipient_role: Optional[str] = None
    recipient_user_id: Optional[str] = None
    notification_type: str = "general"
    link_section: Optional[str] = None
    is_read: bool = False
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", mode="before")
    @classmethod
    def convert_id(cls, v):
        return str(v) if v is not None else ""

# Interview schemas
class InterviewBase(BaseModel):
    candidate_id: str
    interviewer_id: Optional[str] = None
    evaluator_id: Optional[str] = None
    created_by: Optional[str] = None
    scheduled_at: datetime
    round: int = 1

    @field_validator("candidate_id", "interviewer_id", "evaluator_id", "created_by", mode="before")
    @classmethod
    def convert_ids(cls, v):
        return str(v) if v is not None else None

class InterviewCreate(InterviewBase):
    pass

class InterviewUpdate(BaseModel):
    scheduled_at: Optional[datetime] = None
    round: Optional[int] = None
    status: Optional[str] = None

class InterviewOut(InterviewBase):
    id: str
    status: str
    created_at: Optional[datetime] = None
    interviewer_name: Optional[str] = None
    has_feedback: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", mode="before")
    @classmethod
    def convert_id(cls, v):
        return str(v) if v is not None else ""

# Feedback schemas
class FeedbackBase(BaseModel):
    interview_id: str
    technical_score: int = Field(..., ge=0, le=10)
    communication_score: int = Field(..., ge=0, le=10)
    problem_solving_score: int = Field(..., ge=0, le=10)
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    comments: Optional[str] = None

    @field_validator("interview_id", mode="before")
    @classmethod
    def convert_id(cls, v):
        return str(v) if v is not None else ""

class FeedbackCreate(FeedbackBase):
    pass

class FeedbackUpdate(BaseModel):
    technical_score: Optional[int] = Field(None, ge=0, le=10)
    communication_score: Optional[int] = Field(None, ge=0, le=10)
    problem_solving_score: Optional[int] = Field(None, ge=0, le=10)
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    comments: Optional[str] = None

class FeedbackOut(FeedbackBase):
    id: str
    created_at: Optional[datetime] = None
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    round: Optional[int] = None
    evaluator_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", mode="before")
    @classmethod
    def convert_id(cls, v):
        return str(v) if v is not None else ""

# Dashboard summary schemas
class DashboardStats(BaseModel):
    total_candidates: int
    scheduled_interviews: int
    completed_interviews: int
    selected_candidates: int
    rejected_candidates: int
    applied_candidates: Optional[int] = 0
    total_recruiters: Optional[int] = 0
    upcoming_interviews: Optional[int] = None
    pending_feedback: Optional[int] = None
    shortlisted_candidates: Optional[int] = None

# Report schemas
class ReportOut(BaseModel):
    id: str
    candidate_id: str
    content: Union[dict, str, Any]
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "candidate_id", mode="before")
    @classmethod
    def convert_id(cls, v):
        return str(v) if v is not None else ""
