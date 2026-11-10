/**
 * login.js - Handles Login & Candidate Registration Authentication Flow
 * Role-aware redirection: candidate -> candidate.html, admin/recruiter -> dashboard.html
 */

document.addEventListener('DOMContentLoaded', () => {
    // Tab elements
    const tabSignInBtn = document.getElementById('tabSignInBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('candidateRegisterForm');
    const linkReturnSignIn = document.getElementById('linkReturnSignIn');

    // Sign In inputs & button
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const signInSubmitBtn = document.getElementById('signInSubmitBtn');

    // Registration inputs & button
    const regName = document.getElementById('regName');
    const regEmail = document.getElementById('regEmail');
    const regPhone = document.getElementById('regPhone');
    const regUsername = document.getElementById('regUsername');
    const regPassword = document.getElementById('regPassword');
    const regConfirmPassword = document.getElementById('regConfirmPassword');
    const regSubmitBtn = document.getElementById('regSubmitBtn');

    // Dedicated notification alert elements
    const alertBox = document.getElementById('authAlertBox');
    const alertIcon = document.getElementById('authAlertIcon');
    const alertBody = document.getElementById('authAlertBody');

    /**
     * Switch Tabs Helper
     */
    function switchToTab(tab) {
        clearAlert();
        if (tab === 'signin') {
            if (tabSignInBtn) {
                tabSignInBtn.classList.add('active');
                tabSignInBtn.setAttribute('aria-selected', 'true');
            }
            if (tabRegisterBtn) {
                tabRegisterBtn.classList.remove('active');
                tabRegisterBtn.setAttribute('aria-selected', 'false');
            }
            if (loginForm) loginForm.style.display = 'block';
            if (registerForm) registerForm.style.display = 'none';
        } else if (tab === 'register') {
            if (tabRegisterBtn) {
                tabRegisterBtn.classList.add('active');
                tabRegisterBtn.setAttribute('aria-selected', 'true');
            }
            if (tabSignInBtn) {
                tabSignInBtn.classList.remove('active');
                tabSignInBtn.setAttribute('aria-selected', 'false');
            }
            if (loginForm) loginForm.style.display = 'none';
            if (registerForm) registerForm.style.display = 'block';
        }
    }

    if (tabSignInBtn) {
        tabSignInBtn.addEventListener('click', () => switchToTab('signin'));
    }
    if (tabRegisterBtn) {
        tabRegisterBtn.addEventListener('click', () => switchToTab('register'));
    }
    if (linkReturnSignIn) {
        linkReturnSignIn.addEventListener('click', (e) => {
            e.preventDefault();
            switchToTab('signin');
        });
    }

    /**
     * Professional Notification Alert Handler
     * types: 'error', 'success', 'info'
     */
    function showAlert(text, type = 'error') {
        if (!alertBox || !alertBody) return;

        alertBody.textContent = text;
        alertBox.className = `auth-alert ${type}`;
        alertBox.style.display = 'flex';

        if (alertIcon) {
            if (type === 'error') {
                alertIcon.textContent = '⚠️';
            } else if (type === 'success') {
                alertIcon.textContent = '✅';
            } else {
                alertIcon.textContent = 'ℹ️';
            }
        }
    }

    function clearAlert() {
        if (!alertBox) return;
        alertBox.style.display = 'none';
        if (alertBody) alertBody.textContent = '';
    }

    /**
     * Check for session expired flash message from api.js redirection
     */
    function checkSessionExpiredMessage() {
        const expiredKey = (window.api && window.api.SESSION_EXPIRED_KEY) || 'session_expired_message';
        try {
            const expiredMsg = sessionStorage.getItem(expiredKey);
            if (expiredMsg) {
                sessionStorage.removeItem(expiredKey);
                showAlert(expiredMsg, 'error');
            }
        } catch (e) {
            // ignore sessionStorage error
        }
    }

    /**
     * Check if user is already authenticated and display status
     */
    function checkCurrentSession() {
        checkSessionExpiredMessage();

        if (window.api && typeof window.api.isAuthenticated === 'function' && window.api.isAuthenticated()) {
            const user = window.api.getCurrentUser();
            const username = user?.username || 'User';
            const role = (user?.role || 'candidate').toLowerCase();
            let targetPage = 'dashboard.html';
            let portalLabel = 'Go to Admin Dashboard &rarr;';
            if (role === 'candidate') {
                targetPage = 'candidate.html';
                portalLabel = 'Go to Candidate Portal &rarr;';
            } else if (role === 'recruiter') {
                targetPage = 'recruiter.html';
                portalLabel = 'Go to Recruiter Dashboard &rarr;';
            }

            let sessionBox = document.getElementById('sessionStatusBox');
            if (!sessionBox) {
                sessionBox = document.createElement('div');
                sessionBox.id = 'sessionStatusBox';
                sessionBox.style.cssText = 'background:#ECFDF5; border:1px solid #A7F3D0; border-radius:12px; padding:16px; margin-bottom:18px; font-size:0.92rem; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.05);';
                const container = document.querySelector('.login-card');
                if (container) {
                    const tabs = document.getElementById('authTabs');
                    container.insertBefore(sessionBox, tabs || container.firstChild);
                }
            }

            sessionBox.innerHTML = `
                <div style="color:#065F46; font-weight:600; margin-bottom:12px;">
                    Currently signed in as <strong>${escapeHtml(username)}</strong> (${escapeHtml(role.toUpperCase())})
                </div>
                <div style="display:flex; gap:10px; justify-content:center;">
                    <a href="${targetPage}" class="button" style="text-decoration:none; padding:8px 16px; font-size:0.88rem;">${portalLabel}</a>
                    <button type="button" id="signOutBtn" class="button btn-secondary" style="padding:8px 16px; font-size:0.88rem;">Sign Out</button>
                </div>
            `;

            const signOutBtn = document.getElementById('signOutBtn');
            if (signOutBtn) {
                signOutBtn.addEventListener('click', () => {
                    window.api.logout();
                    if (sessionBox) sessionBox.remove();
                    showAlert('Signed out successfully.', 'success');
                    if (usernameInput) usernameInput.value = '';
                    if (passwordInput) passwordInput.value = '';
                });
            }
        } else {
            const sessionBox = document.getElementById('sessionStatusBox');
            if (sessionBox) sessionBox.remove();
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Check session on page load
    checkCurrentSession();

    /**
     * 1. Sign In Form Handler
     */
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAlert();

            const username = usernameInput ? usernameInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';

            if (!username || !password) {
                showAlert('Please enter both your username and password.', 'error');
                return;
            }

            if (signInSubmitBtn) {
                signInSubmitBtn.disabled = true;
                signInSubmitBtn.textContent = 'Verifying credentials...';
            }

            try {
                if (!window.api || typeof window.api.login !== 'function') {
                    throw new Error('API service (api.js) is not loaded.');
                }

                const result = await window.api.login(username, password);
                const userRole = (result.user?.role || '').toLowerCase();
                let redirectTarget = 'dashboard.html';
                if (userRole === 'candidate') {
                    redirectTarget = 'candidate.html';
                } else if (userRole === 'recruiter') {
                    redirectTarget = 'recruiter.html';
                }

                showAlert(`Signed in successfully! Redirecting...`, 'success');

                if (passwordInput) passwordInput.value = '';

                setTimeout(() => {
                    window.location.href = redirectTarget;
                }, 600);
            } catch (err) {
                console.error('Login error:', err);

                // Differentiate meaningful error categories
                let displayError = err.message || 'Login failed. Please check your credentials.';
                if (err.isNetworkError || (err.status === 0)) {
                    displayError = `Unable to connect to backend server at http://127.0.0.1:8000. Please ensure the backend server is running.`;
                } else if (err.status === 503) {
                    displayError = err.message || `Database connection failure: Unable to reach MongoDB Atlas. Please ensure your IP address is whitelisted.`;
                } else if (err.status === 401) {
                    displayError = `Invalid username or password. Please verify your credentials.`;
                }

                showAlert(displayError, 'error');
            } finally {
                if (signInSubmitBtn) {
                    signInSubmitBtn.disabled = false;
                    signInSubmitBtn.textContent = 'Sign In to Portal \u2192';
                }
            }
        });
    }

    /**
     * 2. Candidate Registration Form Handler
     */
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAlert();

            const name = regName ? regName.value.trim() : '';
            const email = regEmail ? regEmail.value.trim() : '';
            const phone = regPhone ? regPhone.value.trim() : '';
            const username = regUsername ? regUsername.value.trim() : '';
            const password = regPassword ? regPassword.value : '';
            const confirmPassword = regConfirmPassword ? regConfirmPassword.value : '';

            // Field validation
            if (!name || !email || !username || !password || !confirmPassword) {
                showAlert('Please fill in all required fields.', 'error');
                return;
            }

            if (password.length < 6) {
                showAlert('Password must be at least 6 characters long.', 'error');
                return;
            }

            if (password !== confirmPassword) {
                showAlert('Passwords do not match. Please verify and re-enter.', 'error');
                return;
            }

            if (regSubmitBtn) {
                regSubmitBtn.disabled = true;
                regSubmitBtn.textContent = 'Creating account...';
            }

            try {
                if (!window.api || typeof window.api.registerCandidate !== 'function') {
                    throw new Error('Registration API is not available.');
                }

                await window.api.registerCandidate({
                    name,
                    email,
                    phone: phone || null,
                    username,
                    password
                });

                showAlert('Candidate account created successfully! Redirecting to your Candidate Portal...', 'success');

                setTimeout(() => {
                    window.location.href = 'candidate.html';
                }, 800);
            } catch (err) {
                console.error('Registration error:', err);

                let displayError = err.message || 'Registration failed.';
                if (err.isNetworkError || err.status === 0) {
                    displayError = 'Unable to connect to backend server at http://127.0.0.1:8000. Please ensure the backend is running.';
                } else if (err.status === 503) {
                    displayError = err.message || 'Database service unavailable. Please check MongoDB Atlas connection.';
                }

                showAlert(displayError, 'error');
            } finally {
                if (regSubmitBtn) {
                    regSubmitBtn.disabled = false;
                    regSubmitBtn.textContent = 'Create Candidate Account \u2192';
                }
            }
        });
    }
});
