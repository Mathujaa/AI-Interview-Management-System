/**
 * api.js - Centralized API Service for AI Interview Management System
 * Connects Frontend to FastAPI Backend at http://127.0.0.1:8000
 */

const API_BASE_URL = window.API_BASE_URL || 'http://127.0.0.1:8000';

const TOKEN_KEY = 'access_token';
const TOKEN_TYPE_KEY = 'token_type';
const USER_KEY = 'current_user';
const SESSION_EXPIRED_KEY = 'session_expired_message';

let isRedirectingToLogin = false;

/**
 * Token and Auth Storage Utilities
 */
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getTokenType() {
    return localStorage.getItem(TOKEN_TYPE_KEY) || 'Bearer';
}

function setToken(token, tokenType = 'bearer') {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_TYPE_KEY, tokenType);
}

function removeToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_TYPE_KEY);
    localStorage.removeItem(USER_KEY);
}

/**
 * Handle Session Expiration: clears tokens and redirects to login
 */
function handleSessionExpiration(reason = 'Your session has expired. Please sign in again.') {
    removeToken();
    try {
        sessionStorage.setItem(SESSION_EXPIRED_KEY, reason);
    } catch (e) {
        // ignore sessionStorage errors
    }

    // Avoid multiple redirect triggers
    if (isRedirectingToLogin) return;
    isRedirectingToLogin = true;

    // If currently on dashboard or protected page, redirect to index.html
    const pathname = window.location.pathname;
    const isLoginPage = pathname.endsWith('index.html') || pathname.endsWith('/') || pathname === '';
    if (!isLoginPage) {
        window.location.href = 'index.html';
    }
}

/**
 * Decode JWT token payload (client-side decoding without external dependencies)
 */
function parseJwt(token) {
    if (!token) return null;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(jsonPayload);
    } catch (err) {
        return null;
    }
}

/**
 * Returns authenticated user info ONLY if the session is currently valid
 */
function getCurrentUser() {
    if (!isAuthenticated()) {
        removeToken();
        return null;
    }
    const token = getToken();
    if (token) {
        const payload = parseJwt(token);
        if (payload) {
            return {
                username: payload.sub,
                role: payload.role,
                exp: payload.exp
            };
        }
    }
    const stored = localStorage.getItem(USER_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            // ignore
        }
    }
    return null;
}

/**
 * Checks if client has a valid, non-expired JWT token
 */
function isAuthenticated() {
    const token = getToken();
    if (!token) return false;
    const payload = parseJwt(token);
    if (!payload || !payload.exp) {
        removeToken();
        return false;
    }
    const now = Math.floor(Date.now() / 1000);
    // Add 5-second buffer for network latency/clock drift
    if (payload.exp <= (now + 5)) {
        removeToken();
        return false;
    }
    return true;
}

/**
 * Core fetch wrapper with auth header injection and standardized error parsing
 */
async function apiRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http')
        ? endpoint
        : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    // Client-side authentication pre-check for protected requests
    if (!options.skipAuth && !url.includes('/auth/login') && !url.includes('/health')) {
        if (!isAuthenticated()) {
            handleSessionExpiration('Your session has expired. Please sign in again.');
            throw new Error('Your session has expired. Please sign in again.');
        }
    }

    const headers = options.headers ? { ...options.headers } : {};

    // Automatically attach Bearer token unless skipAuth is explicitly requested
    if (!options.skipAuth) {
        const token = getToken();
        if (token) {
            headers['Authorization'] = `${getTokenType()} ${token}`;
        }
    }

    // Set JSON content-type if body is an object and not already specified
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
    }

    const config = {
        ...options,
        headers,
        body
    };

    let response;
    try {
        response = await fetch(url, config);
    } catch (networkError) {
        console.error('Network request failed:', networkError);
        throw new Error(`Unable to reach server at ${API_BASE_URL}. Ensure the backend is running.`);
    }

    // Parse response
    let responseData = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        try {
            responseData = await response.json();
        } catch (e) {
            responseData = null;
        }
    } else {
        try {
            responseData = await response.text();
        } catch (e) {
            responseData = null;
        }
    }

    if (!response.ok) {
        let message = `Request failed (HTTP ${response.status})`;
        if (responseData && typeof responseData === 'object') {
            if (responseData.detail) {
                if (typeof responseData.detail === 'string') {
                    message = responseData.detail;
                } else if (Array.isArray(responseData.detail)) {
                    message = responseData.detail.map((d) => d.msg || d.detail || JSON.stringify(d)).join(', ');
                }
            } else if (responseData.message) {
                message = responseData.message;
            }
        } else if (typeof responseData === 'string' && responseData.trim()) {
            message = responseData;
        }

        // Categorize meaningful error messages
        if (response.status === 401) {
            const isLoginAttempt = options.skipAuth || url.includes('/auth/login');
            if (!isLoginAttempt) {
                const isExpired = message.toLowerCase().includes('expired') ||
                                  message.toLowerCase().includes('token') ||
                                  message.toLowerCase().includes('credentials') ||
                                  message.toLowerCase().includes('signature');
                const reason = isExpired
                    ? 'Your session has expired. Please sign in again.'
                    : 'Session unauthorized. Please sign in again.';
                handleSessionExpiration(reason);
            } else {
                message = (responseData && responseData.detail) || 'Invalid username or password. Please verify your credentials.';
            }
        } else if (response.status === 503) {
            message = (responseData && responseData.detail) || 'Database service unavailable. Please check MongoDB Atlas connection.';
        } else if (response.status === 403) {
            message = (responseData && responseData.detail) || 'Access forbidden: You do not have permission for this action.';
        } else if (response.status === 400) {
            message = (responseData && responseData.detail) || message;
        }

        const error = new Error(message);
        error.status = response.status;
        error.data = responseData;
        throw error;
    }

    return responseData;
}

/**
 * Authentication API Methods
 */
async function login(username, password) {
    // FastAPI OAuth2PasswordRequestForm expects application/x-www-form-urlencoded
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const data = await apiRequest('/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString(),
        skipAuth: true
    });

    if (data && data.access_token) {
        setToken(data.access_token, data.token_type || 'bearer');
        const userPayload = parseJwt(data.access_token);
        const mustChange = Boolean(data.must_change_password || (data.user && data.user.must_change_password));
        const userData = {
            username: userPayload?.sub || username,
            role: userPayload?.role || 'user',
            must_change_password: mustChange
        };
        localStorage.setItem(USER_KEY, JSON.stringify(userData));
        if (mustChange) {
            sessionStorage.setItem('must_change_password', 'true');
        } else {
            sessionStorage.removeItem('must_change_password');
        }
        return {
            success: true,
            token: data.access_token,
            tokenType: data.token_type,
            user: userData,
            must_change_password: mustChange
        };
    }

    throw new Error('Invalid login response from server.');
}

async function changePassword(oldPassword, newPassword) {
    return apiRequest('/auth/change-password', {
        method: 'POST',
        body: { old_password: oldPassword, new_password: newPassword }
    });
}

async function registerCandidate(candidateData) {
    const data = await apiRequest('/auth/register-candidate', {
        method: 'POST',
        body: candidateData,
        skipAuth: true
    });

    if (data && data.access_token) {
        setToken(data.access_token, data.token_type || 'bearer');
        const userPayload = parseJwt(data.access_token);
        const userData = {
            username: userPayload?.sub || candidateData.username,
            role: userPayload?.role || 'candidate'
        };
        localStorage.setItem(USER_KEY, JSON.stringify(userData));
        return {
            success: true,
            token: data.access_token,
            tokenType: data.token_type,
            user: userData
        };
    }

    return data;
}

function logout() {
    removeToken();
}

/**
 * Utility & Health Check
 */
async function checkHealth() {
    return apiRequest('/health', { method: 'GET', skipAuth: true });
}

async function getUsers() {
    return apiRequest('/auth/users', { method: 'GET' });
}

/**
 * Candidate Management APIs
 */
async function getCandidates(skip = 0, limit = 100) {
    return apiRequest(`/candidates/?skip=${skip}&limit=${limit}`, { method: 'GET' });
}

async function getCandidate(id) {
    return apiRequest(`/candidates/${id}`, { method: 'GET' });
}

async function createCandidate(candidateData) {
    return apiRequest('/candidates/', {
        method: 'POST',
        body: candidateData
    });
}

async function updateCandidate(id, candidateData) {
    return apiRequest(`/candidates/${id}`, {
        method: 'PUT',
        body: candidateData
    });
}

async function deleteCandidate(id) {
    return apiRequest(`/candidates/${id}`, {
        method: 'DELETE'
    });
}

async function assignCandidateRecruiter(candidateId, recruiterId) {
    return apiRequest(`/candidates/${candidateId}/assign-recruiter`, {
        method: 'PUT',
        body: { recruiter_id: recruiterId || null }
    });
}

/**
 * Interview Management APIs
 */
async function getInterviews(skip = 0, limit = 100) {
    return apiRequest(`/interviews/?skip=${skip}&limit=${limit}`, { method: 'GET' });
}

async function getInterview(id) {
    return apiRequest(`/interviews/${id}`, { method: 'GET' });
}

async function scheduleInterview(interviewData) {
    return apiRequest('/interviews/', {
        method: 'POST',
        body: interviewData
    });
}

async function updateInterview(id, interviewData) {
    return apiRequest(`/interviews/${id}`, {
        method: 'PUT',
        body: interviewData
    });
}

async function deleteInterview(id) {
    return apiRequest(`/interviews/${id}`, {
        method: 'DELETE'
    });
}

/**
 * Feedback Management APIs
 */
async function submitFeedback(feedbackData) {
    return apiRequest('/feedback/', {
        method: 'POST',
        body: feedbackData
    });
}

async function getFeedbackByInterview(interviewId) {
    return apiRequest(`/feedback/interview/${interviewId}`, { method: 'GET' });
}

async function getFeedbackHistory(skip = 0, limit = 100) {
    return apiRequest(`/feedback/?skip=${skip}&limit=${limit}`, { method: 'GET' });
}

/**
 * Dashboard & Analytics APIs
 */
async function getDashboardStats() {
    return apiRequest('/dashboard/stats', { method: 'GET' });
}

/**
 * Prediction (ML) & Report (GenAI) APIs
 */
async function predictSelection(arg1, arg2) {
    let candidateId;
    let payload;
    if (arg2 !== undefined && (typeof arg1 === 'string' || typeof arg1 === 'number')) {
        candidateId = String(arg1);
        payload = arg2;
    } else if (typeof arg1 === 'object' && arg1 !== null) {
        payload = arg1;
        candidateId = payload.candidate_id || payload.id;
    } else {
        candidateId = String(arg1);
        payload = {};
    }

    if (!candidateId) {
        throw new Error('Candidate ID is required for ML selection prediction.');
    }

    const body = {
        skill_score: parseInt(payload.skill_score, 10) || 5,
        years_experience: parseInt(payload.years_experience, 10) || 0,
        technical_score: parseInt(payload.technical_score, 10) || 5,
        communication_rating: parseInt(payload.communication_rating, 10) || 5,
        prev_performance: parseInt(payload.prev_performance, 10) || 5,
        education: String(payload.education || 'bachelor').toLowerCase()
    };

    return apiRequest(`/prediction/${candidateId}`, {
        method: 'POST',
        body
    });
}

async function predictCandidate(candidateId, predictionData) {
    return predictSelection(candidateId, predictionData);
}

async function getCandidatePredictionFeatures(candidateId) {
    return apiRequest(`/prediction/candidate-features/${candidateId}`, {
        method: 'GET'
    });
}

async function getModelInfo() {
    return apiRequest('/prediction/model-info', {
        method: 'GET'
    });
}

async function generateReport(candidateId) {
    return apiRequest(`/report/generate-report/${candidateId}`, {
        method: 'POST'
    });
}

async function getReport(candidateId) {
    return apiRequest(`/report/reports/${candidateId}`, {
        method: 'GET'
    });
}

/**
 * Candidate Self-Service APIs
 */
async function getMyProfile() {
    return apiRequest('/candidates/me', { method: 'GET' });
}

async function updateMyProfile(profileData) {
    return apiRequest('/candidates/me', {
        method: 'PUT',
        body: profileData
    });
}

async function getMyInterviews() {
    return apiRequest('/interviews/my-interviews', { method: 'GET' });
}

async function getMyFeedback() {
    return apiRequest('/feedback/my-feedback', { method: 'GET' });
}

async function getMyReport() {
    return apiRequest('/report/my-report', { method: 'GET' });
}

/**
 * Recruiter & User Management APIs
 */
async function getRecruiters() {
    return apiRequest('/auth/recruiters', { method: 'GET' });
}

async function createRecruiter(userData) {
    return apiRequest('/auth/users', {
        method: 'POST',
        body: {
            username: userData.username,
            password: userData.password,
            role: 'recruiter'
        }
    });
}

async function deleteUser(userId) {
    return apiRequest(`/auth/users/${userId}`, { method: 'DELETE' });
}

/**
 * Notifications APIs
 */
async function getNotifications() {
    return apiRequest('/notifications/', { method: 'GET' });
}

async function markNotificationRead(id) {
    return apiRequest(`/notifications/${id}/read`, { method: 'PUT' });
}

async function markAllNotificationsRead() {
    return apiRequest('/notifications/read-all', { method: 'PUT' });
}

/**
 * Report Export API
 */
async function getExportData(dateRange = '30', status = 'all') {
    return apiRequest(`/report/export-data?date_range=${encodeURIComponent(dateRange)}&status=${encodeURIComponent(status)}`, {
        method: 'GET'
    });
}

/**
 * Token Refresh API - Issues a fresh access token for an active session
 */
async function refreshToken() {
    try {
        const data = await apiRequest('/auth/refresh', {
            method: 'POST'
        });
        if (data && data.access_token) {
            setToken(data.access_token, data.token_type || 'bearer');
            const userPayload = parseJwt(data.access_token);
            if (userPayload) {
                const userData = {
                    username: userPayload.sub,
                    role: userPayload.role
                };
                localStorage.setItem(USER_KEY, JSON.stringify(userData));
            }
            return data.access_token;
        }
    } catch (err) {
        console.warn('Token refresh failed:', err);
        return null;
    }
}

// Expose API module globally for browser use
const api = {
    BASE_URL: API_BASE_URL,
    getToken,
    getTokenType,
    setToken,
    removeToken,
    getCurrentUser,
    isAuthenticated,
    handleSessionExpiration,
    SESSION_EXPIRED_KEY,
    apiRequest,
    login,
    logout,
    refreshToken,
    checkHealth,
    getUsers,
    getCandidates,
    getCandidate,
    createCandidate,
    updateCandidate,
    deleteCandidate,
    assignCandidateRecruiter,
    getInterviews,
    getInterview,
    scheduleInterview,
    updateInterview,
    deleteInterview,
    submitFeedback,
    getFeedbackByInterview,
    getFeedbackHistory,
    getDashboardStats,
    predictCandidate,
    predictSelection,
    getCandidatePredictionFeatures,
    getModelInfo,
    generateReport,
    getReport,
    registerCandidate,
    getMyProfile,
    updateMyProfile,
    getMyInterviews,
    getMyFeedback,
    getMyReport,
    getRecruiters,
    createRecruiter,
    deleteUser,
    getNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    changePassword,
    getExportData
};

window.api = api;

