"""
MongoDB Document Schemas and Role Definitions
Defines MongoDB document structures and user roles for PyMongo.
"""

import enum
from typing import Optional, Dict, Any, List
from datetime import datetime

class UserRole(str, enum.Enum):
    admin = "admin"
    recruiter = "recruiter"
    candidate = "candidate"

# Document type reference helpers
class User:
    """Document representation for 'users' collection."""
    def __init__(self, username: str, password_hash: str, role: str = UserRole.candidate.value, _id: Any = None):
        self.id = str(_id) if _id else None
        self.username = username
        self.password_hash = password_hash
        self.role = role

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "username": self.username,
            "password_hash": self.password_hash,
            "role": self.role,
        }
        return data

class Candidate:
    """Document representation for 'candidates' collection."""
    def __init__(self, name: str, email: str, phone: Optional[str] = None, status: str = "applied", user_id: Optional[str] = None, recruiter_id: Optional[str] = None):
        self.name = name
        self.email = email
        self.phone = phone
        self.status = status
        self.user_id = user_id
        self.recruiter_id = recruiter_id
        self.status_history = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "email": self.email,
            "phone": self.phone,
            "status": self.status,
            "user_id": self.user_id,
            "recruiter_id": self.recruiter_id,
            "status_history": self.status_history,
        }
