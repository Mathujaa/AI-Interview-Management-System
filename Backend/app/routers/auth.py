from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from ..database import (
    get_users_collection,
    get_candidates_collection,
    serialize_doc,
    to_object_id,
    build_id_query
)
from .. import models, schemas
from ..auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    get_current_user,
    admin_required,
    recruiter_or_admin_required,
)
from .notifications import create_notification

from pymongo.errors import PyMongoError

router = APIRouter()

@router.post("/register-candidate", status_code=status.HTTP_201_CREATED)
def register_candidate(payload: schemas.CandidateRegister):
    """
    Public candidate self-registration: creates user credentials and candidate record.
    """
    users_col = get_users_collection()
    candidates_col = get_candidates_collection()

    clean_username = payload.username.strip()
    clean_email = payload.email.strip().lower()

    try:
        if users_col.find_one({"username": clean_username}):
            raise HTTPException(status_code=400, detail="Username is already taken. Please choose another.")

        if candidates_col.find_one({"email": clean_email}):
            raise HTTPException(status_code=400, detail="A candidate profile with this email already exists.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MongoDB connection failure: Unable to reach MongoDB Atlas database. Please ensure your current IP address is whitelisted in MongoDB Atlas Network Access."
        )

    now = datetime.now(timezone.utc)
    hashed_pwd = get_password_hash(payload.password)

    # 1. Create User account with role 'candidate'
    user_doc = {
        "username": clean_username,
        "password_hash": hashed_pwd,
        "role": models.UserRole.candidate.value,
        "created_at": now
    }
    user_res = users_col.insert_one(user_doc)
    user_id_str = str(user_res.inserted_id)

    # 2. Create Candidate profile in 'candidates' collection
    init_status_entry = {
        "previous_status": None,
        "new_status": "applied",
        "updated_by": f"Candidate ({clean_username})",
        "timestamp": now,
        "remarks": "Self-registered via Candidate Portal"
    }

    cand_doc = {
        "name": payload.name.strip(),
        "email": clean_email,
        "phone": payload.phone.strip() if payload.phone else None,
        "status": "applied",
        "user_id": user_id_str,
        "recruiter_id": None,
        "status_history": [init_status_entry],
        "created_at": now,
        "updated_at": now
    }
    cand_res = candidates_col.insert_one(cand_doc)
    cand_id_str = str(cand_res.inserted_id)

    # 3. Create Notifications
    # Welcome to Candidate
    create_notification(
        title="Welcome to AI Interview System",
        message="Your candidate registration was successful! You can track your application and interview schedule here.",
        recipient_user_id=user_id_str,
        recipient_role="candidate",
        notification_type="registration_welcome",
        link_section="profile"
    )
    # Alert to Admin and Recruiters
    create_notification(
        title="New Candidate Registered",
        message=f"Candidate {payload.name} ({clean_email}) has self-registered into the talent pipeline.",
        recipient_role="admin",
        notification_type="candidate_registered",
        link_section="candidates"
    )
    create_notification(
        title="New Candidate Registered",
        message=f"Candidate {payload.name} ({clean_email}) has self-registered into the talent pipeline.",
        recipient_role="recruiter",
        notification_type="candidate_registered",
        link_section="candidates"
    )

    # 4. Issue JWT access token
    access_token = create_access_token(data={"sub": clean_username, "role": models.UserRole.candidate.value})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user_id_str,
            "username": clean_username,
            "role": models.UserRole.candidate.value,
            "candidate_id": cand_id_str,
            "name": payload.name
        }
    }

@router.post("/login", response_model=Dict[str, Any])
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    users_col = get_users_collection()
    try:
        user = users_col.find_one({"username": form_data.username.strip()})
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MongoDB Atlas connection failure: TLS handshake failed or cluster unreachable. Please ensure your public IP address is active in MongoDB Atlas Network Access."
        )

    if not user or not verify_password(form_data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password. Please verify your credentials.")

    role = user.get("role", "candidate")
    user_id_str = str(user["_id"])

    # If user is a candidate, retrieve their candidate document ID
    candidate_id = None
    candidate_name = None
    if role == "candidate":
        candidates_col = get_candidates_collection()
        cand = candidates_col.find_one({"$or": [{"user_id": user_id_str}, {"email": user["username"]}]})
        if cand:
            candidate_id = str(cand["_id"])
            candidate_name = cand.get("name")

    access_token = create_access_token(data={"sub": user["username"], "role": role})
    must_change = bool(user.get("must_change_password", False))

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "must_change_password": must_change,
        "user": {
            "id": user_id_str,
            "username": user["username"],
            "role": role,
            "candidate_id": candidate_id,
            "name": candidate_name or user["username"],
            "must_change_password": must_change
        }
    }

@router.post("/change-password", response_model=Dict[str, Any])
def change_password(payload: schemas.ChangePasswordInput, current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Allows an authenticated user to change their password. Clears must_change_password flag upon success.
    """
    users_col = get_users_collection()
    user = users_col.find_one(build_id_query(current_user["id"]))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(payload.old_password, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Incorrect current temporary password")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    
    users_col.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "password_hash": get_password_hash(payload.new_password),
            "must_change_password": False,
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    return {"status": "success", "success": True, "message": "Password changed successfully"}

@router.post("/refresh", response_model=Dict[str, Any])
def refresh_token(current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Issues a fresh access token for an authenticated user with an active session.
    """
    role = current_user.get("role", "candidate")
    access_token = create_access_token(data={"sub": current_user["username"], "role": role})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": str(current_user.get("id")),
            "username": current_user["username"],
            "role": role
        }
    }

@router.post("/users", response_model=Dict[str, Any], dependencies=[Depends(admin_required)])
def create_user(user_in: schemas.UserCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Admin-only: provision recruiter or admin accounts.
    """
    users_col = get_users_collection()
    clean_username = user_in.username.strip()
    if users_col.find_one({"username": clean_username}):
        raise HTTPException(status_code=400, detail="Username already exists")

    hashed = get_password_hash(user_in.password)
    now = datetime.now(timezone.utc)
    is_recruiter = str(user_in.role).lower() == "recruiter"
    user_doc = {
        "username": clean_username,
        "password_hash": hashed,
        "role": user_in.role,
        "must_change_password": is_recruiter,
        "created_at": now
    }
    result = users_col.insert_one(user_doc)
    user_id_str = str(result.inserted_id)

    # Notification to admin
    create_notification(
        title="Recruiter Account Created" if is_recruiter else "User Account Created",
        message=f"Account '{clean_username}' with role '{user_in.role}' was created by {current_user.get('username')}.",
        recipient_role="admin",
        notification_type="account_created",
        link_section="recruiters"
    )

    return {
        "id": user_id_str,
        "username": clean_username,
        "role": user_in.role,
        "must_change_password": is_recruiter
    }

@router.get("/recruiters", response_model=List[schemas.UserOut], dependencies=[Depends(recruiter_or_admin_required)])
def list_recruiters():
    """
    List all active recruiter accounts for interview assignment.
    Accessible to Admin and Recruiter roles. Candidates are never returned.
    """
    users_col = get_users_collection()
    recruiters = list(users_col.find({"role": {"$in": [models.UserRole.recruiter.value, "recruiter", "RECRUITER"]}}).sort("created_at", -1))
    return [serialize_doc(u) for u in recruiters]

@router.get("/users", response_model=List[schemas.UserOut], dependencies=[Depends(admin_required)])
def list_users():
    """
    Admin-only: list all system users.
    """
    users_col = get_users_collection()
    users = list(users_col.find({}))
    return [serialize_doc(u) for u in users]

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(admin_required)])
def delete_user(user_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    """
    Admin-only: remove a user account. Admins cannot delete their own account.
    """
    if str(current_user.get("id")) == str(user_id):
        raise HTTPException(status_code=400, detail="Cannot delete your own active admin account")

    users_col = get_users_collection()
    query = build_id_query(user_id)
    user = users_col.find_one(query)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    users_col.delete_one({"_id": user["_id"]})
    return None
