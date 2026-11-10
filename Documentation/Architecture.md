# Project Architecture

## Overview
The **AI‑Enhanced Interview Management System** is organized into five main layers:

1. **Frontend** – Plain HTML, CSS, and vanilla JavaScript. It provides role-based single-page dashboards for Admin, Recruiter, and Candidate users, communicating with the backend via RESTful HTTP calls with JWT Bearer authentication.
2. **Backend** – FastAPI (Python) exposing endpoints for:
   - CRUD operations on candidates, interviews, and feedback stored in MongoDB Atlas.
   - Machine learning selection probability prediction requests.
   - Generative‑AI evaluation synthesis endpoints that call the Gemini (or configurable) LLM.
   - Real-time notification management and authentication.
3. **Machine Learning (ML)** – A Scikit‑learn Random Forest model bundled with Joblib for persistence. The model is trained on multidimensional candidate evaluation features and loaded on demand.
4. **Database** – MongoDB Atlas document database (`ai_interview_db`) using PyMongo, with collections for `users`, `candidates`, `interviews`, `feedback`, `reports`, and `notifications`.
5. **Configuration** – Environment variables (`.env`) store sensitive credentials (MongoDB Atlas URI, JWT secrets, API keys) and are loaded via `pydantic-settings`.

### Interaction Flow
```
[Browser Client] <--Fetch API / JWT--> [FastAPI Backend] <--PyMongo / TLS--> [MongoDB Atlas]
                                            |
                                            |---> [ML Service] (model.py) – loads Random Forest .joblib model
                                            |
                                            |---> [Generative AI] – calls Gemini API / structured synthesis
```

*All layers are decoupled; the frontend never accesses the database directly. Communication is performed over HTTP with JSON payloads.*

---
*This document provides the architectural blueprint for the cloud-native MongoDB Atlas recruitment management platform.*
