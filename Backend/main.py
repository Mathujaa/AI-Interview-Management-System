from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import PyMongoError, ConnectionFailure, ServerSelectionTimeoutError

from .app import config, models
from .app.database import init_db, check_database_readiness
from .app.routers import (
    auth,
    candidates,
    interviews,
    feedback,
    dashboard,
    prediction,
    report,
    notifications,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize MongoDB connection and indexes on startup if URI is configured
    if config.settings.MONGODB_URI:
        init_db()
    yield

# Initialize FastAPI app with title and description
app = FastAPI(
    title="AI Interview Management API",
    description="FastAPI backend for AI Interview Management System (MongoDB Atlas)",
    version="1.0.0",
    lifespan=lifespan,
)

# Global PyMongo / MongoDB Atlas connection exception handler
@app.exception_handler(PyMongoError)
async def pymongo_exception_handler(request: Request, exc: PyMongoError):
    if isinstance(exc, ConnectionFailure):
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "detail": "MongoDB connection failure: Unable to establish TLS connection with MongoDB Atlas. Please ensure that your public IP address is active in MongoDB Atlas Network Access."
            },
        )
    import re
    sanitized = re.sub(r':([^@/:]+)@', ':****@', str(exc))
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": f"Database operation error: {sanitized}"}
    )

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(candidates.router, prefix="/candidates", tags=["Candidate Management"])
app.include_router(interviews.router, prefix="/interviews", tags=["Interview Management"])
app.include_router(feedback.router, prefix="/feedback", tags=["Feedback Management"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
app.include_router(prediction.router, prefix="/prediction", tags=["Prediction"])
app.include_router(report.router, prefix="/report", tags=["Reports"])
app.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])

# Health check endpoint (application process health)
@app.get("/health", tags=["Utility"])
async def health_check():
    return {
        "status": "ok",
        "service": "AI Interview Management API",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# Readiness check endpoint (application and MongoDB Atlas readiness)
@app.get("/health/ready", tags=["Utility"])
async def readiness_check():
    db_status = check_database_readiness()
    if not db_status.get("ready"):
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "unavailable",
                "database": "disconnected",
                "detail": db_status.get("error", "Database connection failure"),
            }
        )
    return {
        "status": "ready",
        "database": "connected",
        "ping_ms": db_status.get("ping_ms")
    }
