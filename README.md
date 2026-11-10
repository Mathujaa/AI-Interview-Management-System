# AI-Interview-Management-System

## Overview

The **AI-Enhanced Interview Management System** is a full-stack, cloud-ready recruitment platform. It streamlines candidate management, multi-round interview scheduling, evaluation scoring, machine-learning-based selection probability prediction, and generative AI assessment reporting.

The system features a vanilla-JavaScript responsive frontend, a high-performance **FastAPI** backend, and a cloud-native **MongoDB Atlas** database powered by **PyMongo**.

---

## Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (Single-Page Dashboard Architecture)
- **Backend**: Python 3.10+, FastAPI, Uvicorn (ASGI Server)
- **Database**: MongoDB Atlas (`ai_interview_db`) using PyMongo
- **Machine Learning**: Scikit-Learn Random Forest Classifier (`model_pipeline.joblib`)
- **Generative AI**: LLM Evaluation Generator with intelligent structured synthesis fallback
- **Security & Auth**: OAuth2 Bearer Tokens (JWT via `python-jose`) with native `bcrypt` password hashing

---

## Project Structure

```text
AI-Interview-Management-System/
├── Frontend/
│   ├── index.html          # Authentication login page
│   ├── dashboard.html      # Complete Admin Dashboard
│   ├── recruiter.html      # Dedicated Recruiter Portal
│   ├── candidate.html      # Candidate Self-Service Portal
│   ├── css/style.css       # Unified enterprise design system & responsive layout
│   └── js/
│       ├── api.js          # Centralized API client service for FastAPI
│       ├── login.js        # Authentication controller & token management
│       ├── dashboard.js    # Admin Dashboard view controller & actions
│       ├── recruiter.js    # Recruiter portal view controller & evaluations
│       └── candidate.js    # Candidate portal view controller & feedback view
├── Backend/
│   ├── main.py             # FastAPI entry point & API router registration
│   └── app/
│       ├── config.py       # Pydantic Settings & environment variables
│       ├── database.py     # MongoDB Atlas client, collections & index init
│       ├── models.py       # Document definitions & UserRole enumeration
│       ├── schemas.py      # Pydantic V2 request & response schemas
│       ├── auth.py         # Password hashing (bcrypt) & JWT token handlers
│       └── routers/
│           ├── auth.py          # Login, user management & credentials
│           ├── candidates.py    # Candidate CRUD operations
│           ├── interviews.py    # Interview scheduling & status updates
│           ├── feedback.py      # Evaluation feedback & scoring
│           ├── dashboard.py     # Metric aggregates & statistics
│           ├── prediction.py    # Scikit-learn candidate selection prediction
│           ├── report.py        # GenAI evaluation report generation
│           └── notifications.py # Real-time notification services
├── ML/
│   ├── model.py            # Random Forest training & inference pipeline
│   ├── data_synthetic.csv  # Synthetic evaluation dataset
│   └── model_pipeline.joblib # Serialized Random Forest model pipeline
├── test_mongodb_connection.py   # MongoDB Atlas connection verification test
├── diagnose_atlas_connection.py # Connection diagnostics & TLS verification
├── .env.example            # Environment configuration template
├── requirements.txt        # Python package dependencies (MongoDB Atlas stack)
└── README.md               # Complete project documentation
```

---

## MongoDB Atlas Setup

1. **Create an Atlas Cluster**:
   - Log in to [MongoDB Atlas](https://cloud.mongodb.com/).
   - Create a free-tier or dedicated cluster (e.g., `Cluster0`).
   - Target database: `ai_interview_db`.

2. **Network Access (IP Whitelist)**:
   - In Atlas, navigate to **Security** -> **Network Access**.
   - Click **Add IP Address**.
   - Add your current IP address (or `0.0.0.0/0` for development access).

3. **Database User**:
   - Navigate to **Security** -> **Database Access**.
   - Create a database user with `Read and write to any database` permissions.

---

## Installation & Setup on Windows

### 1. Clone & Set Up Virtual Environment

Open PowerShell in the project directory:

```powershell
# Create Python virtual environment
python -m venv .venv

# Activate virtual environment
.\.venv\Scripts\Activate.ps1
```

### 2. Install Dependencies

Install all required packages from `requirements.txt`:

```powershell
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Copy the template configuration file:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set your credentials:

```env
# MongoDB Atlas Configuration
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=ai_interview_db

# Security & Authentication
JWT_SECRET_KEY=your_secure_jwt_random_secret_key
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

# Optional: GenAI / LLM Settings
GEMINI_API_KEY=your_gemini_api_key
LLM_API_URL=https://api.example.com/v1
```

---

## Running the Application

### 1. Verify MongoDB Atlas Connection

Test cluster reachability, collections, indexes, and write/read capability:

```powershell
python test_mongodb_connection.py
```

### 2. Start the Backend API

Start the FastAPI backend with live reloading:

```powershell
uvicorn Backend.main:app --reload
```

- **Backend Base URL**: `http://127.0.0.1:8000`
- **Interactive Swagger Documentation**: `http://127.0.0.1:8000/docs`
- **ReDoc Documentation**: `http://127.0.0.1:8000/redoc`

### 3. Start the Frontend

In a separate terminal, serve the frontend on port 5500:

```powershell
python -m http.server 5500 --directory Frontend
```

- **Frontend URL**: `http://127.0.0.1:5500`

---

## Default Admin Credentials

- **Username**: `admin`
- **Password**: `Admin@123`

The admin account is authenticated directly against MongoDB Atlas using bcrypt password hash verification. After successful login, the application automatically redirects to `dashboard.html`.

---

## MongoDB Atlas Database Collections & Schema

The application stores all recruitment data in **MongoDB Atlas** (`ai_interview_db`) structured across six primary collections:

| Collection | Description | Key Indexes |
| :--- | :--- | :--- |
| `users` | Role-based user accounts (`admin`, `recruiter`, `candidate`) with bcrypt hashed credentials | `username` (unique) |
| `candidates` | Candidate profiles, contact details, assignment metadata, and status lifecycle | `email` (unique), `status`, `created_at` |
| `interviews` | Multi-round interview sessions, scheduled dates, statuses, and assigned recruiter links | `candidate_id`, `interviewer_id`, `scheduled_at`, `status` |
| `feedback` | Detailed evaluator scorecards (technical, communication, problem-solving), strengths, and growth areas | `interview_id` |
| `reports` | AI-generated executive evaluation syntheses, competency matrices, and recommendations | `candidate_id`, `created_at` |
| `notifications`| Role-targeted event alerts, interview notifications, and unread counters | `recipient_user_id`, `recipient_role`, `is_read`, `created_at` |

---

## Three Distinct User Roles

1. **Admin**:
   - Manages user accounts and recruiter credentials.
   - Monitors global candidate pipelines and interview sessions.
   - Assigns candidates to designated recruiters.
   - Read-only oversight of all recruiter-submitted evaluation scorecards.
2. **Recruiter**:
   - Dedicated portal (`recruiter.html`) for managing assigned candidates.
   - Schedules, reschedules, and completes interview rounds.
   - Submits structured competency feedback (technical, communication, problem-solving).
   - Runs ML Random Forest selection predictions (94% accuracy).
   - Generates Generative AI candidate evaluation syntheses.
3. **Candidate**:
   - Self-service portal (`candidate.html`) with application tracking.
   - Views scheduled interviews and real-time evaluation feedback.
   - Inspects competency score matrices and growth suggestions.
