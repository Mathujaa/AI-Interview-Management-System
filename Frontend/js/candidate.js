/**
 * candidate.js - Controller for Candidate Portal
 * Enterprise AI Interview Management System
 */

let candidateProfileCache = null;
let cachedInterviews = [];
let activeCandidateView = 'application';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Authentication Guard
    if (!window.api || !window.api.isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }

    const currentUser = window.api.getCurrentUser();
    if (currentUser) {
        const userRoleLower = (currentUser.role || '').toLowerCase();
        if (userRoleLower === 'admin') {
            window.location.href = 'dashboard.html';
            return;
        }
        if (userRoleLower === 'recruiter') {
            window.location.href = 'recruiter.html';
            return;
        }

        const username = currentUser.username || 'Candidate';
        const role = (currentUser.role || 'CANDIDATE').toUpperCase();
        const initials = username.substring(0, 2).toUpperCase();

        const usernameEl = document.getElementById('cHeaderUsername');
        const roleEl = document.getElementById('cHeaderRole');
        const avatarCircle = document.getElementById('cAvatarCircle');

        if (usernameEl) usernameEl.textContent = username;
        if (roleEl) roleEl.textContent = role;
        if (avatarCircle) avatarCircle.textContent = initials;
    }

    // 2. Initialize View Routing & Navigation
    initViewRouting();

    // 3. Setup Global Events (Sign Out, Notifications Dropdown)
    setupCandidateEvents();

    // 4. Load Portal Data
    loadCandidateProfile();
    loadCandidateInterviews();
    loadCandidateEvaluation();
    loadNotifications();

    // 5. Polling for live notification updates
    setInterval(loadNotifications, 25000);
});

/**
 * =========================================================================
 * 1. TAB ROUTING & VIEW CONTROLLER
 * =========================================================================
 */
function initViewRouting() {
    const navLinks = document.querySelectorAll('#candidateNavMenu a');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = link.getAttribute('data-view') || link.getAttribute('href').replace('#', '');
            switchCandidateView(targetView);
        });
    });

    // Check initial hash in URL
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (['application', 'overview'].includes(hash)) {
        switchCandidateView('application', false);
    } else if (hash === 'interviews') {
        switchCandidateView('interviews', false);
    } else if (['evaluation', 'feedback'].includes(hash)) {
        switchCandidateView('evaluation', false);
    } else {
        switchCandidateView('application', false);
    }

    // Listen for back/forward navigation
    window.addEventListener('hashchange', () => {
        const currentHash = window.location.hash.replace('#', '').toLowerCase();
        if (['application', 'interviews', 'evaluation'].includes(currentHash)) {
            switchCandidateView(currentHash, false);
        }
    });
}

function switchCandidateView(viewName, updateHash = true) {
    const normalizedView = ['overview', 'application'].includes(viewName) ? 'application' : viewName;
    activeCandidateView = normalizedView;

    // Update Nav Link Active States
    const navLinks = document.querySelectorAll('#candidateNavMenu a');
    navLinks.forEach(link => {
        const viewAttr = link.getAttribute('data-view') || link.getAttribute('href').replace('#', '');
        const isActive = (viewAttr === normalizedView) || (normalizedView === 'application' && viewAttr === 'overview');
        link.classList.toggle('active', isActive);
    });

    // Update View Section Visibility
    const allSections = document.querySelectorAll('.candidate-view-section');
    allSections.forEach(sec => sec.classList.remove('active'));

    const activeSec = document.getElementById(`view-${normalizedView}`);
    if (activeSec) {
        activeSec.classList.add('active');
    }

    // Refresh view-specific data when activated
    if (normalizedView === 'evaluation') {
        loadCandidateEvaluation();
    } else if (normalizedView === 'interviews') {
        loadCandidateInterviews();
    } else if (normalizedView === 'application') {
        loadCandidateProfile();
    }

    // Synchronize URL Hash without scrolling
    if (updateHash) {
        history.replaceState(null, '', `#${normalizedView}`);
    }

    // Scroll smoothly to top of main canvas
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.switchCandidateView = switchCandidateView;

/**
 * =========================================================================
 * 2. GLOBAL CANDIDATE EVENTS (LOGOUT, NOTIFICATIONS)
 * =========================================================================
 */
function setupCandidateEvents() {
    // Logout Handler
    const logoutBtn = document.getElementById('cNavLogout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to sign out?')) {
                window.api.logout();
                window.location.href = 'index.html';
            }
        });
    }

    // Notifications Dropdown Toggle
    const bellBtn = document.getElementById('cNotificationsBellBtn');
    const dropdown = document.getElementById('cNotificationsDropdown');
    const markAllBtn = document.getElementById('cMarkAllReadBtn');

    if (bellBtn && dropdown) {
        bellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;
            dropdown.style.display = isHidden ? 'block' : 'none';
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    // Mark All Read
    if (markAllBtn) {
        markAllBtn.addEventListener('click', async () => {
            try {
                await window.api.markAllNotificationsRead();
                loadNotifications();
            } catch (err) {
                console.warn('Failed to mark all read:', err);
            }
        });
    }
}

/**
 * =========================================================================
 * 3. CANDIDATE PROFILE & STEPPER PROGRESSION
 * =========================================================================
 */
async function loadCandidateProfile() {
    try {
        const candidate = await window.api.getMyProfile();
        candidateProfileCache = candidate;

        // Populate Welcome Header
        const nameEl = document.getElementById('candWelcomeName');
        const statusEl = document.getElementById('candBannerStatus');
        const stepperSummary = document.getElementById('stepperStatusSummary');

        if (nameEl) nameEl.textContent = candidate.name || 'Candidate';

        const rawStatus = (candidate.status || 'applied').toLowerCase();
        const displayStatus = rawStatus.replace('_', ' ').toUpperCase();

        if (statusEl) {
            statusEl.textContent = displayStatus;
            statusEl.className = `badge badge-${rawStatus === 'hired' ? 'selected' : rawStatus}`;
        }
        if (stepperSummary) {
            stepperSummary.textContent = displayStatus;
            stepperSummary.className = `badge badge-${rawStatus === 'hired' ? 'selected' : rawStatus}`;
        }

        // Populate Candidate Profile Grid
        const detailName = document.getElementById('candDetailName');
        const detailEmail = document.getElementById('candDetailEmail');
        const detailPhone = document.getElementById('candDetailPhone');
        const detailRole = document.getElementById('candDetailRole');
        const detailExp = document.getElementById('candDetailExp');
        const detailDate = document.getElementById('candDetailDate');
        const detailSkills = document.getElementById('candDetailSkills');

        if (detailName) detailName.textContent = candidate.name || '—';
        if (detailEmail) detailEmail.textContent = candidate.email || '—';
        if (detailPhone) detailPhone.textContent = candidate.phone || 'Not provided';
        if (detailRole) detailRole.textContent = candidate.job_role || candidate.role || 'Software Engineer';
        if (detailExp) detailExp.textContent = candidate.experience ? `${candidate.experience} Years` : 'Experienced';
        if (detailDate) {
            detailDate.textContent = candidate.created_at
                ? new Date(candidate.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                : 'Recently';
        }
        if (detailSkills) {
            if (Array.isArray(candidate.skills)) {
                detailSkills.textContent = candidate.skills.join(', ');
            } else if (candidate.skills) {
                detailSkills.textContent = String(candidate.skills);
            } else {
                detailSkills.textContent = 'Software Engineering, Problem Solving';
            }
        }

        // Update 5-Stage Stepper
        updateStepper(rawStatus, candidate.status_history, candidate.created_at);

        // Render Status History Timeline
        renderCandidateTimeline(candidate);
    } catch (err) {
        console.error('Failed to load profile:', err);
        const timeline = document.getElementById('cStatusHistoryTimeline');
        if (timeline) {
            timeline.innerHTML = `
                <div style="padding:28px 16px; text-align:center; color:var(--muted-text);">
                    <div style="font-size:1.8rem; margin-bottom:8px;">⚠️</div>
                    Unable to load progression history. Please check your network connection or try refreshing.
                </div>
            `;
        }
        showCandidateAlert('Unable to load candidate details. Please ensure you are logged in.', 'error');
    }
}

/**
 * 5-Stage Recruitment Progress Stepper
 * Stages: Applied (1) -> Shortlisted (2) -> Scheduled (3) -> Interviewed (4) -> Decision (5)
 */
function updateStepper(rawStatus, statusHistory = [], createdAt = null) {
    const status = (rawStatus || 'applied').toLowerCase();
    const nodes = [
        document.getElementById('stepNode1'),
        document.getElementById('stepNode2'),
        document.getElementById('stepNode3'),
        document.getElementById('stepNode4'),
        document.getElementById('stepNode5')
    ];
    const circles = [
        document.getElementById('step1Circle'),
        document.getElementById('step2Circle'),
        document.getElementById('step3Circle'),
        document.getElementById('step4Circle'),
        document.getElementById('step5Circle')
    ];
    const fillBar = document.getElementById('stepperFill');
    const step5Label = document.getElementById('step5Label');

    // Reset node classes
    nodes.forEach((n, idx) => {
        if (n) n.className = 'step-node';
        if (circles[idx]) circles[idx].textContent = String(idx + 1);
    });

    let activeStage = 1;
    let fillPct = 0;

    switch (status) {
        case 'applied':
            activeStage = 1;
            fillPct = 0;
            break;
        case 'shortlisted':
            activeStage = 2;
            fillPct = 25;
            break;
        case 'scheduled':
            activeStage = 3;
            fillPct = 50;
            break;
        case 'interviewed':
            activeStage = 4;
            fillPct = 75;
            break;
        case 'selected':
        case 'hired':
            activeStage = 5;
            fillPct = 100;
            if (step5Label) step5Label.textContent = 'Selected 🎉';
            break;
        case 'rejected':
            activeStage = 5;
            fillPct = 100;
            if (step5Label) step5Label.textContent = 'Decision: Closed';
            break;
        default:
            activeStage = 1;
            fillPct = 0;
    }

    // Set stage status classes and icons
    for (let i = 0; i < nodes.length; i++) {
        const stepNum = i + 1;
        const node = nodes[i];
        const circle = circles[i];
        if (!node) continue;

        if (stepNum < activeStage) {
            node.classList.add('completed');
            if (circle) circle.textContent = '✓';
        } else if (stepNum === activeStage) {
            if (activeStage === 5) {
                if (status === 'selected' || status === 'hired') {
                    node.classList.add('completed', 'selected');
                    if (circle) circle.textContent = '🎉';
                } else if (status === 'rejected') {
                    node.classList.add('completed', 'rejected');
                    if (circle) circle.textContent = '✕';
                } else {
                    node.classList.add('active');
                }
            } else {
                node.classList.add('active');
            }
        }
    }

    // Fill bar styling
    if (fillBar) {
        fillBar.style.width = `${fillPct}%`;
        if (status === 'rejected') {
            fillBar.style.backgroundColor = 'var(--status-red)';
        } else {
            fillBar.style.backgroundColor = 'var(--status-green)';
        }
    }

    // Helper to find date from status history
    function findStageDate(statusKeys) {
        if (!Array.isArray(statusHistory)) return null;
        for (const item of statusHistory) {
            const st = (item.new_status || item.status || '').toLowerCase();
            if (statusKeys.includes(st) && item.timestamp) {
                return new Date(item.timestamp);
            }
        }
        return null;
    }

    // Format dates for each stage node
    const formatDateShort = (d) => {
        if (!d) return '—';
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    const step1Date = document.getElementById('step1Date');
    const step2Date = document.getElementById('step2Date');
    const step3Date = document.getElementById('step3Date');
    const step4Date = document.getElementById('step4Date');
    const step5Date = document.getElementById('step5Date');

    const d1 = createdAt ? new Date(createdAt) : (findStageDate(['applied']) || new Date());
    const d2 = findStageDate(['shortlisted']);
    const d3 = findStageDate(['scheduled']);
    const d4 = findStageDate(['interviewed']);
    const d5 = findStageDate(['selected', 'hired', 'rejected']);

    if (step1Date) step1Date.textContent = formatDateShort(d1);
    if (step2Date) step2Date.textContent = d2 ? formatDateShort(d2) : (activeStage >= 2 ? 'In Review' : '—');
    if (step3Date) step3Date.textContent = d3 ? formatDateShort(d3) : (activeStage >= 3 ? 'Pending' : '—');
    if (step4Date) step4Date.textContent = d4 ? formatDateShort(d4) : (activeStage >= 4 ? 'Pending' : '—');
    if (step5Date) step5Date.textContent = d5 ? formatDateShort(d5) : (activeStage === 5 ? 'Concluded' : '—');
}

/**
 * =========================================================================
 * 4. STATUS PROGRESSION TIMELINE
 * =========================================================================
 */
function renderCandidateTimeline(candidate) {
    const container = document.getElementById('cStatusHistoryTimeline');
    if (!container) return;

    let history = [];
    if (Array.isArray(candidate.status_history) && candidate.status_history.length > 0) {
        // Deep copy and reverse to show newest on top
        history = [...candidate.status_history].reverse();
    } else {
        history = [
            {
                status: candidate.status || 'applied',
                previous_status: null,
                updated_by: 'System',
                timestamp: candidate.created_at || new Date().toISOString(),
                remarks: 'Application submitted successfully. Awaiting initial recruitment review.'
            }
        ];
    }

    container.innerHTML = `
        <div class="status-timeline">
            ${history.map((item, index) => {
                const currentStatus = (item.new_status || item.status || 'applied').replace('_', ' ').toUpperCase();
                const prevStatus = item.previous_status ? `${item.previous_status.replace('_', ' ').toUpperCase()} &rarr; ` : '';
                const dateStr = item.timestamp
                    ? new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                    : 'Recent';
                const updater = item.updated_by || 'Recruitment Team';
                const remarks = item.remarks || 'Application stage progression recorded.';
                const isLatest = index === 0;

                return `
                    <div class="timeline-entry ${isLatest ? 'latest' : ''}">
                        <div class="timeline-entry-dot">${isLatest ? '★' : '•'}</div>
                        <div class="timeline-entry-header">
                            <span class="timeline-entry-status">${prevStatus}${escapeHtml(currentStatus)}</span>
                            <span class="timeline-entry-date">${escapeHtml(dateStr)}</span>
                        </div>
                        <div class="timeline-entry-author">Updated by: <strong>${escapeHtml(updater)}</strong></div>
                        <div class="timeline-entry-remarks">${escapeHtml(remarks)}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/**
 * =========================================================================
 * 5. INTERVIEWS MODULE (UPCOMING VS COMPLETED)
 * =========================================================================
 */
async function loadCandidateInterviews() {
    const upcomingContainer = document.getElementById('cUpcomingInterviewsList');
    const completedContainer = document.getElementById('cCompletedInterviewsList');
    const totalBadge = document.getElementById('totalInterviewsBadge');
    const upcomingBadge = document.getElementById('upcomingCountBadge');
    const completedBadge = document.getElementById('completedCountBadge');

    try {
        const interviews = await window.api.getMyInterviews();
        cachedInterviews = Array.isArray(interviews) ? interviews : [];

        if (totalBadge) totalBadge.textContent = `${cachedInterviews.length} Sessions`;

        const now = new Date();
        const upcoming = [];
        const completed = [];

        cachedInterviews.forEach(inv => {
            const st = (inv.status || 'scheduled').toLowerCase();
            const scheduledTime = inv.scheduled_at ? new Date(inv.scheduled_at) : null;
            const isPast = scheduledTime && scheduledTime < now;

            if (st === 'completed' || st === 'interviewed' || (isPast && st !== 'scheduled')) {
                completed.push(inv);
            } else {
                upcoming.push(inv);
            }
        });

        if (upcomingBadge) upcomingBadge.textContent = `${upcoming.length} Upcoming`;
        if (completedBadge) completedBadge.textContent = `${completed.length} Completed`;

        // Render Upcoming Interviews
        if (upcomingContainer) {
            if (upcoming.length === 0) {
                upcomingContainer.innerHTML = `
                    <div style="text-align:center; padding:32px 16px; color:var(--secondary-text);">
                        <div style="font-size:2rem; margin-bottom:8px;">📅</div>
                        <div style="font-weight:600; color:var(--dark-navy); margin-bottom:4px;">No Upcoming Interviews</div>
                        <p style="font-size:0.86rem; margin:0;">
                            You have no pending interview sessions. You will receive an instant notification as soon as an interview round is coordinated.
                        </p>
                    </div>
                `;
            } else {
                upcomingContainer.innerHTML = upcoming.map((inv) => {
                    const roundLabel = `Round ${inv.round || 1}: Technical Interview`;
                    const dateStr = inv.scheduled_at
                        ? new Date(inv.scheduled_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : 'Schedule Confirmation in Progress';
                    const interviewer = inv.interviewer_name || 'Assigned Recruiter';

                    return `
                        <div class="interview-card">
                            <div class="interview-card-left">
                                <div class="interview-card-icon">📅</div>
                                <div>
                                    <div class="interview-card-title">${escapeHtml(roundLabel)}</div>
                                    <div class="interview-card-meta">
                                        <span>🕒 <strong>${escapeHtml(dateStr)}</strong></span>
                                        <span>👤 Interviewer: <strong>${escapeHtml(interviewer)}</strong></span>
                                    </div>
                                    <div style="margin-top:6px; font-size:0.78rem; color:var(--muted-text);">
                                        Please join 5 minutes before the session starts with your development environment ready.
                                    </div>
                                </div>
                            </div>
                            <div>
                                <span class="badge badge-scheduled">SCHEDULED</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Render Completed Interviews
        if (completedContainer) {
            if (completed.length === 0) {
                completedContainer.innerHTML = `
                    <div style="text-align:center; padding:32px 16px; color:var(--secondary-text);">
                        <div style="font-size:2rem; margin-bottom:8px;">📋</div>
                        <div style="font-weight:600; color:var(--dark-navy); margin-bottom:4px;">No Past Interviews Recorded</div>
                        <p style="font-size:0.86rem; margin:0;">
                            Completed interview rounds along with feedback status will be archived in this section.
                        </p>
                    </div>
                `;
            } else {
                completedContainer.innerHTML = completed.map((inv) => {
                    const roundLabel = `Round ${inv.round || 1}: Interview Session`;
                    const dateStr = inv.scheduled_at
                        ? new Date(inv.scheduled_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : 'Concluded';
                    const interviewer = inv.interviewer_name || 'Assigned Recruiter';

                    const feedbackBadge = inv.has_feedback
                        ? `<button type="button" class="badge badge-hired" style="cursor:pointer; border:none;" onclick="switchCandidateView('evaluation')">⭐ Feedback Available &rarr;</button>`
                        : `<span class="badge badge-applied">⏳ Feedback In Review</span>`;

                    return `
                        <div class="interview-card">
                            <div class="interview-card-left">
                                <div class="interview-card-icon completed">✓</div>
                                <div>
                                    <div class="interview-card-title">${escapeHtml(roundLabel)}</div>
                                    <div class="interview-card-meta">
                                        <span>🕒 Concluded on: <strong>${escapeHtml(dateStr)}</strong></span>
                                        <span>👤 Evaluator: <strong>${escapeHtml(interviewer)}</strong></span>
                                    </div>
                                </div>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span class="badge badge-hired">COMPLETED</span>
                                ${feedbackBadge}
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (err) {
        console.warn('Interviews error:', err);
        const errMsg = `<p style="color:var(--status-red); text-align:center; padding:20px;">Failed to load interviews: ${escapeHtml(err.message)}</p>`;
        if (upcomingContainer) upcomingContainer.innerHTML = errMsg;
        if (completedContainer) completedContainer.innerHTML = errMsg;
    }
}

/**
 * =========================================================================
 * 6. EVALUATION SCORES & AI REPORT
 * =========================================================================
 */
async function loadCandidateEvaluation() {
    const container = document.getElementById('cEvaluationContent');
    const badge = document.getElementById('overallRecommendationBadge');
    if (!container) return;

    try {
        let feedbackList = [];
        try {
            feedbackList = await window.api.getMyFeedback();
        } catch (ignore) {}

        let reportData = null;
        try {
            reportData = await window.api.getMyReport();
        } catch (ignore) {}

        const hasFeedback = Array.isArray(feedbackList) && feedbackList.length > 0;

        // 1. If NO feedback has been submitted yet: render explicit Pending state (never 0/10 or fabricated decision)
        if (!hasFeedback) {
            if (badge) {
                badge.textContent = 'Pending Evaluation';
                badge.className = 'badge badge-applied';
            }

            container.innerHTML = `
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:24px;">
                    <!-- Pending Competency Score Matrix -->
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:12px; padding:22px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <h4 style="font-size:0.96rem; font-weight:700; color:var(--dark-navy); margin:0;">
                                Competency Score Matrix
                            </h4>
                            <span class="badge badge-applied" style="font-size:0.82rem;">Evaluation Pending</span>
                        </div>
                        <p style="font-size:0.78rem; color:var(--muted-text); margin:0 0 16px 0;">
                            Detailed scorecard will be compiled from verified evaluator reviews once submitted.
                        </p>

                        <!-- Technical Score (Pending) -->
                        <div style="margin-bottom:16px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.84rem; margin-bottom:6px;">
                                <span>Technical Competence</span>
                                <span class="badge badge-applied" style="font-size:0.75rem;">Pending</span>
                            </div>
                            <div class="meter-track">
                                <div class="meter-fill" style="background:#CBD5E1; width:0%;"></div>
                            </div>
                        </div>

                        <!-- Communication (Pending) -->
                        <div style="margin-bottom:16px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.84rem; margin-bottom:6px;">
                                <span>Communication &amp; Clarity</span>
                                <span class="badge badge-applied" style="font-size:0.75rem;">Pending</span>
                            </div>
                            <div class="meter-track">
                                <div class="meter-fill" style="background:#CBD5E1; width:0%;"></div>
                            </div>
                        </div>

                        <!-- Problem Solving (Pending) -->
                        <div style="margin-bottom:16px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.84rem; margin-bottom:6px;">
                                <span>Problem Solving &amp; Logic</span>
                                <span class="badge badge-applied" style="font-size:0.75rem;">Pending</span>
                            </div>
                            <div class="meter-track">
                                <div class="meter-fill" style="background:#CBD5E1; width:0%;"></div>
                            </div>
                        </div>

                        <div style="margin-top:14px; padding:10px 12px; background:#F1F5F9; border-radius:6px; font-size:0.78rem; color:var(--muted-text); line-height:1.45;">
                            ⏳ <strong>Evaluation Pending:</strong> No interview feedback scorecards have been recorded yet. Scores across Technical, Communication, and Problem Solving criteria will be displayed once submitted by your evaluators.
                        </div>
                    </div>

                    <!-- Pending Executive Evaluation Summary -->
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:12px; padding:22px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                            <h4 style="font-size:0.96rem; font-weight:700; color:var(--dark-navy); margin:0;">
                                Executive Evaluation Summary
                            </h4>
                            <span class="badge badge-applied" style="font-size:0.75rem;">0 Evaluations Recorded</span>
                        </div>

                        <p style="font-size:0.88rem; color:var(--secondary-text); line-height:1.55; margin-bottom:18px;">
                            Evaluation is currently in progress. A verified evaluation summary, identified strengths, and growth recommendations will appear here after interview sessions are evaluated.
                        </p>

                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                            <div>
                                <div style="font-size:0.76rem; font-weight:700; color:#065F46; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">
                                    Identified Strengths
                                </div>
                                <p style="font-size:0.82rem; color:var(--muted-text); margin:0; font-style:italic;">
                                    Awaiting completed interview feedback...
                                </p>
                            </div>
                            <div>
                                <div style="font-size:0.76rem; font-weight:700; color:#991B1B; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">
                                    Growth Opportunities
                                </div>
                                <p style="font-size:0.82rem; color:var(--muted-text); margin:0; font-style:italic;">
                                    Awaiting completed interview feedback...
                                </p>
                            </div>
                        </div>

                        <div style="margin-top:20px; text-align:right;">
                            <button type="button" class="btn btn-outline" style="font-size:0.78rem; padding:4px 10px;" onclick="loadCandidateEvaluation()">
                                ↻ Refresh Evaluation
                            </button>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        // 2. Feedback records exist: calculate competency averages and overall score
        function parseScore(val) {
            if (val === null || val === undefined || val === '') return null;
            const n = parseFloat(val);
            return (!isNaN(n) && n >= 0 && n <= 10) ? n : null;
        }

        const techScores = feedbackList.map(f => parseScore(f.technical_score)).filter(s => s !== null);
        const commScores = feedbackList.map(f => parseScore(f.communication_score)).filter(s => s !== null);
        const probScores = feedbackList.map(f => parseScore(f.problem_solving_score)).filter(s => s !== null);

        const avgTech = techScores.length > 0 ? Number((techScores.reduce((a, b) => a + b, 0) / techScores.length).toFixed(1)) : null;
        const avgComm = commScores.length > 0 ? Number((commScores.reduce((a, b) => a + b, 0) / commScores.length).toFixed(1)) : null;
        const avgProb = probScores.length > 0 ? Number((probScores.reduce((a, b) => a + b, 0) / probScores.length).toFixed(1)) : null;

        // Calculate overall average from available non-null competency averages
        const validAvgs = [avgTech, avgComm, avgProb].filter(s => s !== null);
        let overallScore = null;
        let overallPercent = null;

        if (validAvgs.length > 0) {
            overallScore = Number((validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length).toFixed(1));
            overallPercent = Math.round((overallScore / 10.0) * 100);
        }

        // Synchronize recommendation strictly based on actual evaluation scores
        let recommendation = 'Under Review';
        if (overallScore === null) {
            recommendation = 'Pending Evaluation';
        } else if (overallScore >= 8.0 && (avgTech === null || avgTech >= 7.5)) {
            recommendation = 'Strong Hire';
        } else if (overallScore >= 6.0) {
            recommendation = 'Recommended';
        } else if (overallScore >= 4.0) {
            recommendation = 'Under Review';
        } else {
            recommendation = 'Needs Improvement';
        }

        // Update overall recommendation badge in header banner
        if (badge) {
            badge.textContent = recommendation;
            const recLower = recommendation.toLowerCase();
            if (recLower.includes('hire') || recLower.includes('recommend') || recLower.includes('selected')) {
                badge.className = 'badge badge-hired';
            } else if (recLower.includes('reject') || recLower.includes('needs improvement')) {
                badge.className = 'badge badge-rejected';
            } else if (recLower.includes('pending')) {
                badge.className = 'badge badge-applied';
            } else {
                badge.className = 'badge badge-scheduled';
            }
        }

        // Extract qualitative remarks from feedback
        const feedbackStrengths = [];
        const feedbackWeaknesses = [];
        const feedbackComments = [];

        feedbackList.forEach(f => {
            if (f.strengths && f.strengths.trim()) feedbackStrengths.push(f.strengths.trim());
            if (f.weaknesses && f.weaknesses.trim()) feedbackWeaknesses.push(f.weaknesses.trim());
            if (f.comments && f.comments.trim()) feedbackComments.push(f.comments.trim());
        });

        // Use report content if available and non-empty
        let summary = '';
        let strengths = feedbackStrengths;
        let growthAreas = feedbackWeaknesses;

        if (reportData && reportData.content && typeof reportData.content === 'object') {
            const rContent = reportData.content;
            if (rContent.executive_summary) {
                summary = rContent.executive_summary;
            }
            if (Array.isArray(rContent.strengths) && rContent.strengths.length > 0) {
                strengths = rContent.strengths;
            }
            if (Array.isArray(rContent.growth_areas) && rContent.growth_areas.length > 0) {
                growthAreas = rContent.growth_areas;
            }
        }

        // Fallback summary synthesized directly from actual feedback
        if (!summary) {
            const commentsText = feedbackComments.length > 0 ? ` Evaluator remarks: "${feedbackComments.join(' ')}"` : '';
            summary = `Evaluation synthesized across ${feedbackList.length} completed interview evaluation(s). The candidate achieved an overall competency score of ${overallScore !== null ? overallScore + '/10 (' + overallPercent + '%)' : 'Pending'}. Current evaluation status: ${recommendation}.${commentsText}`;
        }

        if (strengths.length === 0) {
            strengths = ['Demonstrated core technical foundation and domain problem solving across evaluations.'];
        }
        if (growthAreas.length === 0) {
            growthAreas = ['Continue strengthening large-scale system design and depth in distributed architecture.'];
        }

        // Helper to format competency rows with scores or Pending badge
        const renderCompetencyRow = (label, score, color) => {
            const isScored = score !== null;
            const scoreDisplay = isScored
                ? `<strong style="color:var(--dark-navy);">${score} / 10</strong>`
                : `<span class="badge badge-applied" style="font-size:0.75rem;">Pending</span>`;
            const fillWidth = isScored ? Math.min(100, Math.round(score * 10)) : 0;
            const fillColor = isScored ? color : '#CBD5E1';

            return `
                <div style="margin-bottom:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.84rem; margin-bottom:6px;">
                        <span>${escapeHtml(label)}</span>
                        ${scoreDisplay}
                    </div>
                    <div class="meter-track">
                        <div class="meter-fill" style="background:${fillColor}; width:${fillWidth}%;"></div>
                    </div>
                </div>
            `;
        };

        const overallBadgeText = overallPercent !== null ? `${overallPercent}% Overall` : 'Pending';

        container.innerHTML = `
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:24px;">
                <!-- Quantitative Evaluator Scores -->
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:12px; padding:22px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <h4 style="font-size:0.96rem; font-weight:700; color:var(--dark-navy); margin:0;">
                            Competency Score Matrix
                        </h4>
                        <span class="badge badge-shortlisted" style="font-size:0.82rem;">${overallBadgeText}</span>
                    </div>
                    <p style="font-size:0.78rem; color:var(--muted-text); margin:0 0 16px 0;">
                        Compiled from <strong>${feedbackList.length}</strong> evaluation scorecard(s) across completed rounds.
                    </p>

                    <!-- Technical Score -->
                    ${renderCompetencyRow('Technical Competence', avgTech, '#1769C2')}

                    <!-- Communication -->
                    ${renderCompetencyRow('Communication & Clarity', avgComm, '#16A36A')}

                    <!-- Problem Solving -->
                    ${renderCompetencyRow('Problem Solving & Logic', avgProb, '#8B5CF6')}

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid #E2E8F0;">
                        <span style="font-size:0.76rem; color:var(--muted-text);">
                            Scale: 0 - 10 per competency
                        </span>
                        <button type="button" class="btn btn-outline" style="font-size:0.75rem; padding:3px 8px;" onclick="loadCandidateEvaluation()">
                            ↻ Refresh
                        </button>
                    </div>
                </div>

                <!-- Qualitative Insights & Executive AI Synthesis -->
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:12px; padding:22px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <h4 style="font-size:0.96rem; font-weight:700; color:var(--dark-navy); margin:0;">
                            Executive Evaluation Summary
                        </h4>
                        <span class="badge badge-hired" style="font-size:0.75rem;">✓ ${feedbackList.length} Round(s) Evaluated</span>
                    </div>

                    <p style="font-size:0.88rem; color:var(--dark-text); line-height:1.55; margin-bottom:18px;">
                        ${escapeHtml(summary)}
                    </p>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                        <div>
                            <div style="font-size:0.76rem; font-weight:700; color:#065F46; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">
                                Identified Strengths
                            </div>
                            <ul style="font-size:0.82rem; padding-left:18px; margin:0; color:var(--secondary-text); line-height:1.45;">
                                ${strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
                            </ul>
                        </div>
                        <div>
                            <div style="font-size:0.76rem; font-weight:700; color:#991B1B; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">
                                Growth Opportunities
                            </div>
                            <ul style="font-size:0.82rem; padding-left:18px; margin:0; color:var(--secondary-text); line-height:1.45;">
                                ${growthAreas.map(g => `<li>${escapeHtml(g)}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        console.warn('Evaluation load error:', err);
        container.innerHTML = `<p style="color:var(--status-red); text-align:center;">Failed to load evaluation: ${escapeHtml(err.message)}</p>`;
    }
}

/**
 * =========================================================================
 * 7. NOTIFICATIONS DROPDOWN & CLICK-TO-NAVIGATE
 * =========================================================================
 */
async function loadNotifications() {
    if (!window.api || !window.api.isAuthenticated()) return;

    try {
        const res = await window.api.getNotifications();
        const notifications = res.notifications || [];
        const unreadCount = res.unread_count || 0;

        const badge = document.getElementById('cNotificationsBadge');
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        const listEl = document.getElementById('cNotificationsList');
        if (!listEl) return;

        if (notifications.length === 0) {
            listEl.innerHTML = '<div class="empty-notif">No new notifications</div>';
            return;
        }

        const iconMap = {
            status_change: '🔄',
            interview: '📅',
            feedback: '⭐',
            report: '📄',
            candidate_registered: '👤',
            general: '🔔'
        };

        listEl.innerHTML = notifications.slice(0, 15).map((n) => {
            const icon = iconMap[n.notification_type] || '🔔';
            const isUnread = !n.is_read;
            const timeStr = n.created_at ? formatTimeAgo(new Date(n.created_at)) : 'Just now';
            const linkSec = n.link_section || '';

            return `
                <div class="notification-item ${isUnread ? 'unread' : ''}" onclick="handleCandidateNotifClick('${n.id}', '${linkSec}')">
                    <span class="notif-icon">${icon}</span>
                    <div class="notif-body">
                        <div class="notif-title">${escapeHtml(n.title)}</div>
                        <div class="notif-msg">${escapeHtml(n.message)}</div>
                        <div class="notif-time">${escapeHtml(timeStr)}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (ignore) {}
}

async function handleCandidateNotifClick(notifId, linkSection) {
    try {
        await window.api.markNotificationRead(notifId);
        loadNotifications();

        // Navigate to appropriate candidate view
        if (linkSection === 'interviews') {
            switchCandidateView('interviews');
        } else if (linkSection === 'evaluation' || linkSection === 'feedback') {
            switchCandidateView('evaluation');
        } else if (linkSection === 'candidates' || linkSection === 'application' || linkSection === 'status') {
            switchCandidateView('application');
        }

        // Close dropdown
        const dropdown = document.getElementById('cNotificationsDropdown');
        if (dropdown) dropdown.style.display = 'none';
    } catch (ignore) {}
}
window.handleCandidateNotifClick = handleCandidateNotifClick;

/**
 * =========================================================================
 * 8. UTILITY HELPERS
 * =========================================================================
 */
function showCandidateAlert(message, type = 'success', duration = 4000) {
    const alertEl = document.getElementById('cStatusAlert');
    if (!alertEl) return;

    alertEl.textContent = message;
    alertEl.className = `alert alert-${type} show`;

    setTimeout(() => {
        alertEl.classList.remove('show');
    }, duration);
}

function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
