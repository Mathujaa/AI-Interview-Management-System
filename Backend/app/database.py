"""
Centralized MongoDB Atlas connection and collection management module using PyMongo.
"""

import certifi
from typing import Optional, Dict, Any
from bson import ObjectId
from bson.errors import InvalidId
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.server_api import ServerApi
from .config import settings

_mongo_client: Optional[MongoClient] = None

def get_mongo_client() -> MongoClient:
    """
    Returns a singleton MongoClient configured for MongoDB Atlas.
    """
    global _mongo_client
    if _mongo_client is None:
        uri = settings.MONGODB_URI
        if not uri:
            raise ValueError(
                "MONGODB_URI is not set. Please configure MONGODB_URI in your .env file."
            )
        
        # Configure MongoClient with TLS CA certificates and sensible timeouts
        client_options: Dict[str, Any] = {
            "serverSelectionTimeoutMS": 5000,
            "connectTimeoutMS": 5000,
            "socketTimeoutMS": 10000,
        }
        
        # Use certifi for TLS verification on Atlas SRV connections
        if uri.startswith("mongodb+srv://") or "ssl=true" in uri.lower() or "tls=true" in uri.lower():
            client_options["tlsCAFile"] = certifi.where()

        _mongo_client = MongoClient(uri, **client_options)
    
    return _mongo_client

def get_database() -> Database:
    """
    Returns the target MongoDB database instance.
    """
    client = get_mongo_client()
    db_name = settings.MONGODB_DATABASE or "ai_interview_db"
    return client[db_name]

# Collection Accessors
def get_users_collection() -> Collection:
    return get_database()["users"]

def get_candidates_collection() -> Collection:
    return get_database()["candidates"]

def get_interviews_collection() -> Collection:
    return get_database()["interviews"]

def get_feedback_collection() -> Collection:
    return get_database()["feedback"]

def get_reports_collection() -> Collection:
    return get_database()["reports"]

def get_notifications_collection() -> Collection:
    return get_database()["notifications"]

def to_object_id(val: Any) -> Optional[ObjectId]:
    """
    Safely convert string or ObjectId into ObjectId. Returns None if invalid.
    """
    if val is None:
        return None
    if isinstance(val, ObjectId):
        return val
    try:
        return ObjectId(str(val))
    except (InvalidId, TypeError, ValueError):
        return None

def build_id_query(id_val: Any, id_field: str = "_id") -> dict:
    """
    Builds a flexible MongoDB query matching by ObjectId, string ID, or integer legacy_id.
    """
    if id_val is None:
        return {id_field: None}
    
    conditions = []
    obj_id = to_object_id(id_val)
    if obj_id:
        conditions.append({id_field: obj_id})
    
    s = str(id_val)
    conditions.append({id_field: s})
    conditions.append({"id": s})
    if s.isdigit():
        conditions.append({"legacy_id": int(s)})
    
    seen = set()
    unique_conditions = []
    for c in conditions:
        key = list(c.items())[0]
        if key not in seen:
            seen.add(key)
            unique_conditions.append(c)
            
    if len(unique_conditions) == 1:
        return unique_conditions[0]
    return {"$or": unique_conditions}

def serialize_doc(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Converts MongoDB BSON document to a JSON-serializable dictionary with string IDs.
    """
    if doc is None:
        return None
    
    data = dict(doc)
    if "_id" in data:
        data["id"] = str(data["_id"])
        data["_id"] = str(data["_id"])

    # Ensure foreign reference IDs are strings
    for field in ["candidate_id", "interviewer_id", "interview_id", "user_id", "recruiter_id", "recipient_user_id"]:
        if field in data and data[field] is not None:
            data[field] = str(data[field])

    return data

def check_database_readiness(timeout_ms: int = 3000) -> Dict[str, Any]:
    """
    Executes a real MongoDB ping command to check database reachability and readiness.
    Safely sanitizes any sensitive credentials from error messages.
    """
    import time
    import re
    start = time.time()
    try:
        client = get_mongo_client()
        res = client.admin.command("ping")
        elapsed_ms = round((time.time() - start) * 1000, 2)
        return {
            "ready": bool(res.get("ok", 1.0) == 1.0),
            "ping_ms": elapsed_ms,
            "error": None
        }
    except Exception as e:
        sanitized = re.sub(r':([^@/:]+)@', ':****@', str(e))
        return {
            "ready": False,
            "ping_ms": None,
            "error": f"MongoDB Atlas unreachable: {sanitized}"
        }

def init_db() -> bool:
    """
    Verifies connection to MongoDB Atlas and creates required indexes.
    """
    try:
        client = get_mongo_client()
        # Ping the server to test authentication and network connectivity
        client.admin.command("ping")
        db = get_database()

        # 1. Users collection indexes
        users = db["users"]
        users.create_index([("username", ASCENDING)], unique=True)

        # 2. Candidates collection indexes
        candidates = db["candidates"]
        candidates.create_index([("email", ASCENDING)], unique=True)
        candidates.create_index([("status", ASCENDING)])
        candidates.create_index([("created_at", DESCENDING)])

        # 3. Interviews collection indexes
        interviews = db["interviews"]
        interviews.create_index([("candidate_id", ASCENDING)])
        interviews.create_index([("interviewer_id", ASCENDING)])
        interviews.create_index([("scheduled_at", ASCENDING)])
        interviews.create_index([("status", ASCENDING)])

        # 4. Feedback collection indexes
        feedback = db["feedback"]
        feedback.create_index([("interview_id", ASCENDING)])

        # 5. Reports collection indexes
        reports = db["reports"]
        reports.create_index([("candidate_id", ASCENDING)])
        reports.create_index([("created_at", DESCENDING)])

        # 6. Notifications collection indexes
        notifications = db["notifications"]
        notifications.create_index([("recipient_user_id", ASCENDING)])
        notifications.create_index([("recipient_role", ASCENDING)])
        notifications.create_index([("created_at", DESCENDING)])
        notifications.create_index([("is_read", ASCENDING)])

        return True
    except Exception as e:
        print(f"MongoDB connection/index initialization warning: {e}")
        return False
