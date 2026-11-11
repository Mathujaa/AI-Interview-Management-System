/**
 * recruiter.js - Dedicated Recruiter Portal Controller
 * AI Interview Management System — Enterprise Edition
 */

let assignedCandidatesCache = [];
let assignedInterviewsCache = [];
let recruiterFeedbackCache = [];

document.addEventListener('DOMContentLoaded', () => {
    // 1. Authentication & Role Guard
    if (!window.api || !window.api.isAuthenticated()) {
        if (window.api && typeof window.api.handleSessionExpiration === 'function') {
            window.api.handleSessionExpiration('Please sign in to access the recruiter portal.');
        } else {
            window.location.href = 'index.html';
        }
        return;
    }

    const currentUser = window.api.getCurrentUser();
    if (!currentUser) {
        window.api.handleSessionExpiration('Session expired. Please sign in again.');
        return;
    }

    const userRoleLower = (currentUser.role || '').toLowerCase();
    if (userRoleLower === 'candidate') {
        window.location.href = 'candidate.html';
        return;
    }
    if (userRoleLower === 'admin') {
        window.location.href = 'dashboard.html';
        return;
    }

    // Populate Top Navbar User Details
    const username = currentUser.username || 'Recruiter';
    const role = userRoleLower.toUpperCase();
    const initials = username.substring(0, 2).toUpperCase();

    const usernameEl = document.getElementById('headerUsername');
    const roleEl = document.getElementById('headerUserRole');
    const avatarCircle = document.getElementById('headerAvatarCircle');
    const greetingEl = document.getElementById('welcomeUserGreeting');

    if (usernameEl) usernameEl.textContent = username;
    if (roleEl) roleEl.textContent = role;
    if (avatarCircle) avatarCircle.textContent = initials;
    if (greetingEl) greetingEl.textContent = username;

    // Mobile Navigation Toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navCenterMenu = document.getElementById('navCenterMenu');
    if (mobileMenuBtn && navCenterMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            navCenterMenu.classList.toggle('mobile-open');
        });
    }

    // Sign Out Button
    const logoutBtn = document.getElementById('nav-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            window.api.logout();
            window.location.href = 'index.html';
        });
    }

    // Setup Notification Bell & Dropdown Toggle
    setupRecruiterNotificationBell();

    // Check First-Login Temporary Password Status
    checkFirstLoginPasswordStatus();

    // Setup Form & Filter Event Listeners
    setupRecruiterFormListeners();

    // Route based on URL hash or default to overview
    const initialSection = window.location.hash.replace('#', '') || 'overview';
    navigateTo(initialSection);

    // Initial background notifications poll & periodic 20s polling
    loadRecruiterNotifications();
    setInterval(loadRecruiterNotifications, 20000);
});

/**
 * =============================================================================
 * SECTION NAVIGATION ROUTER
 * =============================================================================
 */
function navigateTo(sectionName) {
    const validSections = ['overview', 'candidates', 'interviews', 'feedback'];
    if (!validSections.includes(sectionName)) {
        sectionName = 'overview';
    }

    // Close mobile nav if open
    const navMenu = document.getElementById('navCenterMenu');
    if (navMenu) navMenu.classList.remove('mobile-open');

    // Update active nav links
    const links = document.querySelectorAll('.nav-link-item');
    links.forEach((l) => l.classList.remove('active'));

    const activeLink = document.getElementById(`nav-${sectionName}`);
    if (activeLink) activeLink.classList.add('active');

    // Update active content section
    const sections = document.querySelectorAll('.content-section');
    sections.forEach((s) => s.classList.remove('active'));

    const activeSection = document.getElementById(`section-${sectionName}`);
    if (activeSection) activeSection.classList.add('active');

    // Update Page Title and Subtitle
    const titleEl = document.getElementById('pageTitle');
    const subtitleEl = document.getElementById('headerSubtitle');
    const titles = {
        overview: 'Recruiter Portfolio Overview',
        candidates: 'My Assigned Candidates',
        interviews: 'My Assigned Interviews',
        feedback: 'Submit Interview Feedback'
    };
    const subtitles = {
        overview: 'Real-time performance metrics and pipeline health for your assigned candidates',
        candidates: 'Manage candidate application progression, view AI reports & ML predictions',
        interviews: 'Schedule interview rounds and oversee sessions where you are the evaluator',
        feedback: 'Score technical and behavioral competencies and generate AI evaluation summaries'
    };

    if (titleEl && titles[sectionName]) titleEl.textContent = titles[sectionName];
    if (subtitleEl && subtitles[sectionName]) subtitleEl.textContent = subtitles[sectionName];

    window.location.hash = sectionName;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger Section Data Loading
    if (sectionName === 'overview') {
        loadRecruiterDashboardStats();
    } else if (sectionName === 'candidates') {
        loadRecruiterCandidates();
    } else if (sectionName === 'interviews') {
        loadRecruiterInterviews();
        populateRecruiterCandidateDropdown();
    } else if (sectionName === 'feedback') {
        loadFeedbackInterviewDropdown();
        loadRecruiterFeedbackHistory();
    }
}
window.navigateTo = navigateTo;

function refreshCurrentSection() {
    const current = window.location.hash.replace('#', '') || 'overview';
    navigateTo(current);
    showAlert('Data refreshed successfully.', 'success', 2000);
}
window.refreshCurrentSection = refreshCurrentSection;

/**
 * =============================================================================
 * ALERT / TOAST NOTIFICATIONS
 * =============================================================================
 */
function showAlert(message, type = 'success', duration = 4000) {
    const alertEl = document.getElementById('statusAlert');
    if (!alertEl) return;

    alertEl.className = `alert alert-${type}`;
    alertEl.textContent = message;
    alertEl.style.display = 'flex';

    if (duration > 0) {
        setTimeout(() => {
            alertEl.style.display = 'none';
        }, duration);
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

/**
 * =============================================================================
 * 1. RECRUITER OVERVIEW & STATS
 * =============================================================================
 */
async function loadRecruiterDashboardStats() {
    try {
        const stats = await window.api.getDashboardStats();
        
        const candEl = document.getElementById('stat-rec-candidates');
        const upEl = document.getElementById('stat-rec-upcoming');
        const compEl = document.getElementById('stat-rec-completed');
        const pendFbEl = document.getElementById('stat-rec-pending-feedback');
        const shortEl = document.getElementById('stat-rec-shortlisted');
        const outcomesEl = document.getElementById('stat-rec-outcomes');

        const totalCand = stats.total_candidates || 0;
        const upcomingInt = stats.upcoming_interviews !== undefined ? stats.upcoming_interviews : (stats.scheduled_interviews || 0);
        const compInt = stats.completed_interviews || 0;
        const pendFb = stats.pending_feedback !== undefined ? stats.pending_feedback : 0;
        const shortlisted = stats.shortlisted_candidates || 0;
        const selected = stats.selected_candidates || 0;
        const rejected = stats.rejected_candidates || 0;

        if (candEl) candEl.textContent = totalCand;
        if (upEl) upEl.textContent = upcomingInt;
        if (compEl) compEl.textContent = compInt;
        if (pendFbEl) pendFbEl.textContent = pendFb;
        if (shortEl) shortEl.textContent = shortlisted;
        if (outcomesEl) outcomesEl.textContent = `${selected} / ${rejected}`;

        // Load overview widgets
        loadOverviewWidgets();
    } catch (err) {
        console.error('Failed to load recruiter stats:', err);
        showAlert(err.message || 'Failed to load portfolio metrics.', 'error');
    }
}

async function loadOverviewWidgets() {
    // 1. Upcoming sessions widget
    const upcomingContainer = document.getElementById('overviewUpcomingList');
    const breakdownContainer = document.getElementById('overviewCandidateBreakdown');

    try {
        const [interviews, candidates] = await Promise.all([
            window.api.getInterviews(),
            window.api.getCandidates()
        ]);

        assignedInterviewsCache = interviews || [];
        assignedCandidatesCache = candidates || [];

        // Render upcoming
        const scheduled = assignedInterviewsCache
            .filter((i) => (i.status || '').toLowerCase() === 'scheduled')
            .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
            .slice(0, 4);

        if (upcomingContainer) {
            if (scheduled.length === 0) {
                upcomingContainer.innerHTML = `
                    <div style="text-align:center; padding:24px; color:var(--secondary-text);">
                        <span style="font-size:1.8rem; display:block; margin-bottom:6px;">☕</span>
                        No upcoming interviews scheduled. Use the Schedule tab to book sessions.
                    </div>
                `;
            } else {
                upcomingContainer.innerHTML = scheduled.map((s) => {
                    const cand = assignedCandidatesCache.find((c) => String(c.id) === String(s.candidate_id)) || {};
                    const candName = cand.name || `Candidate #${s.candidate_id}`;
                    let dateStr = s.scheduled_at;
                    try {
                        const d = new Date(s.scheduled_at);
                        dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    } catch (_) {}

                    return `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; margin-bottom:8px; background:var(--hover-bg); border-radius:8px; border:1px solid var(--border-color);">
                            <div>
                                <strong style="color:var(--dark-navy);">${escapeHtml(candName)}</strong>
                                <span style="font-size:0.8rem; color:var(--secondary-text); margin-left:6px;">Round ${s.round || 1}</span>
                                <div style="font-size:0.82rem; color:var(--secondary-text); margin-top:2px;">📅 ${dateStr}</div>
                            </div>
                            <button type="button" class="button btn-secondary btn-sm" onclick="navigateTo('interviews')">View Session</button>
                        </div>
                    `;
                }).join('');
            }
        }

        // Render portfolio breakdown
        if (breakdownContainer) {
            const counts = {
                applied: assignedCandidatesCache.filter((c) => (c.status || '').toLowerCase() === 'applied').length,
                shortlisted: assignedCandidatesCache.filter((c) => (c.status || '').toLowerCase() === 'shortlisted').length,
                scheduled: assignedCandidatesCache.filter((c) => (c.status || '').toLowerCase() === 'scheduled').length,
                interviewed: assignedCandidatesCache.filter((c) => (c.status || '').toLowerCase() === 'interviewed').length,
                selected: assignedCandidatesCache.filter((c) => ['selected', 'hired'].includes((c.status || '').toLowerCase())).length,
                rejected: assignedCandidatesCache.filter((c) => (c.status || '').toLowerCase() === 'rejected').length,
            };

            const total = assignedCandidatesCache.length || 1;

            const stages = [
                { key: 'Applied', count: counts.applied, color: '#3B82C4' },
                { key: 'Shortlisted', count: counts.shortlisted, color: '#0EA5E9' },
                { key: 'Scheduled', count: counts.scheduled, color: '#F59E0B' },
                { key: 'Interviewed', count: counts.interviewed, color: '#8B5CF6' },
                { key: 'Selected', count: counts.selected, color: '#16A36A' },
                { key: 'Rejected', count: counts.rejected, color: '#E5484D' }
            ];

            breakdownContainer.innerHTML = stages.map((st) => {
                const pct = Math.round((st.count / total) * 100);
                return `
                    <div style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.86rem; margin-bottom:4px;">
                            <span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${st.color}; margin-right:6px;"></span>${st.key}</span>
                            <strong>${st.count} (${pct}%)</strong>
                        </div>
                        <div style="background:#E2E8F0; height:6px; border-radius:3px; overflow:hidden;">
                            <div style="background:${st.color}; width:${pct}%; height:100%;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (err) {
        console.warn('Failed to load overview widgets:', err);
    }
}

/**
 * =============================================================================
 * 2. MY CANDIDATES MODULE
 * =============================================================================
 */
async function loadRecruiterCandidates() {
    const tbody = document.getElementById('recCandidatesTableBody');
    const countBadge = document.getElementById('assignedCandidateCountBadge');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#718096; padding:24px;">Loading assigned candidates...</td></tr>';

    try {
        const candidates = await window.api.getCandidates();
        assignedCandidatesCache = Array.isArray(candidates) ? candidates : [];

        if (countBadge) {
            countBadge.textContent = `${assignedCandidatesCache.length} Candidates`;
        }

        renderRecruiterCandidatesTable(assignedCandidatesCache);
    } catch (err) {
        console.error('Failed to load recruiter candidates:', err);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#EF4444; padding:24px;">Failed to load assigned candidates: ${escapeHtml(err.message)}</td></tr>`;
    }
}
window.loadRecruiterCandidates = loadRecruiterCandidates;

function renderRecruiterCandidatesTable(candidates) {
    const tbody = document.getElementById('recCandidatesTableBody');
    if (!tbody) return;

    const searchVal = (document.getElementById('recCandSearchInput')?.value || '').trim().toLowerCase();
    const filterStatus = (document.getElementById('recCandStatusFilter')?.value || '').trim().toLowerCase();

    let list = Array.isArray(candidates) ? [...candidates] : [];

    if (searchVal) {
        list = list.filter((c) =>
            (c.name || '').toLowerCase().includes(searchVal) ||
            (c.email || '').toLowerCase().includes(searchVal) ||
            (c.phone || '').toLowerCase().includes(searchVal) ||
            String(c.id || '').toLowerCase().includes(searchVal)
        );
    }

    if (filterStatus) {
        list = list.filter((c) => (c.status || '').toLowerCase() === filterStatus);
    }

    if (list.length === 0) {
        const msg = (searchVal || filterStatus)
            ? 'No assigned candidates match your search filters.'
            : 'No candidates currently assigned to your portfolio.';
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; color:#718096; padding:32px;">
                    <div style="font-size:1.4rem; margin-bottom:6px;">👥</div>
                    ${escapeHtml(msg)}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = list.map((cand) => {
        const rawStatus = (cand.status || 'applied').toLowerCase();
        let statusClass = `badge-${rawStatus}`;
        if (rawStatus === 'hired' || rawStatus === 'selected') statusClass = 'badge-hired';

        // Recruitment stage actions
        let stageActionBtns = '';
        if (rawStatus === 'applied') {
            stageActionBtns = `
                <button type="button" class="button btn-success btn-sm" onclick="recruiterShortlistPrompt('${cand.id}', '${escapeHtml(cand.name)}')" title="Shortlist for interview">Shortlist</button>
                <button type="button" class="button btn-secondary btn-sm" onclick="openRecDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'rejected')" title="Reject Candidate">Reject</button>
            `;
        } else if (rawStatus === 'shortlisted') {
            stageActionBtns = `
                <button type="button" class="button btn-primary btn-sm" onclick="openScheduleForCandidate('${cand.id}')" title="Schedule interview session">Schedule</button>
                <button type="button" class="button btn-secondary btn-sm" onclick="openRecDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'rejected')" title="Reject Candidate">Reject</button>
            `;
        } else if (rawStatus === 'scheduled') {
            stageActionBtns = `
                <button type="button" class="button btn-secondary btn-sm" onclick="navigateTo('interviews')" title="View interview schedule">Sessions</button>
                <button type="button" class="button btn-secondary btn-sm" onclick="openRecDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'rejected')" title="Reject Candidate">Reject</button>
            `;
        } else if (rawStatus === 'interviewed') {
            stageActionBtns = `
                <button type="button" class="button btn-success btn-sm" onclick="openRecDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'selected')" title="Select Candidate">⭐ Select</button>
                <button type="button" class="button btn-danger btn-sm" onclick="openRecDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'rejected')" title="Reject Candidate">Reject</button>
            `;
        } else if (['selected', 'hired'].includes(rawStatus)) {
            stageActionBtns = `<span class="badge badge-hired">Selected</span>`;
        } else if (rawStatus === 'rejected') {
            stageActionBtns = `<span class="badge badge-rejected">Closed</span>`;
        }

        return `
            <tr>
                <td><strong style="color:var(--dark-navy);">#${cand.id}</strong></td>
                <td>
                    <div style="font-weight:600; color:var(--dark-navy);">${escapeHtml(cand.name)}</div>
                </td>
                <td><span style="color:var(--text-secondary);">${escapeHtml(cand.email)}</span></td>
                <td><span style="color:var(--text-secondary);">${escapeHtml(cand.phone || '—')}</span></td>
                <td><span class="badge ${statusClass}">${escapeHtml(cand.status || 'applied')}</span></td>
                <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        ${stageActionBtns}
                        <button type="button" class="button btn-secondary btn-sm" onclick="openRecReportModal('${cand.id}', '${escapeHtml(cand.name)}')" title="View AI Evaluation Report">📄 AI Report</button>
                        <button type="button" class="button btn-secondary btn-sm" onclick="openRecPredictionModal('${cand.id}', '${escapeHtml(cand.name)}')" title="Run ML Selection Prediction">⚡ ML Predict</button>
                        <button type="button" class="button btn-secondary btn-sm" onclick="openStatusHistoryModal('${cand.id}')" title="View Full Lifecycle History">History</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function recruiterShortlistPrompt(candId, candName) {
    if (!confirm(`Shortlist candidate "${candName}" for interview rounds?`)) return;

    try {
        await window.api.updateCandidate(candId, {
            status: 'shortlisted',
            remarks: 'Screening passed by assigned recruiter. Ready for interview scheduling.'
        });
        showAlert(`Candidate "${candName}" shortlisted successfully!`, 'success');
        loadRecruiterCandidates();
        loadRecruiterDashboardStats();
    } catch (err) {
        showAlert(err.message || 'Failed to shortlist candidate.', 'error');
    }
}
window.recruiterShortlistPrompt = recruiterShortlistPrompt;

function openScheduleForCandidate(candId) {
    navigateTo('interviews');
    setTimeout(() => {
        const select = document.getElementById('recInterviewCandidateSelect');
        if (select) {
            select.value = candId;
            select.focus();
        }
    }, 200);
}
window.openScheduleForCandidate = openScheduleForCandidate;

/**
 * =============================================================================
 * 3. MY INTERVIEWS MODULE
 * =============================================================================
 */
async function loadRecruiterInterviews() {
    const tbody = document.getElementById('recInterviewsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#718096; padding:24px;">Loading your assigned interviews...</td></tr>';

    try {
        const [interviews, candidates] = await Promise.all([
            window.api.getInterviews(),
            assignedCandidatesCache.length ? Promise.resolve(assignedCandidatesCache) : window.api.getCandidates()
        ]);

        assignedInterviewsCache = Array.isArray(interviews) ? interviews : [];
        assignedCandidatesCache = Array.isArray(candidates) ? candidates : [];

        renderRecruiterInterviewsTable(assignedInterviewsCache);
    } catch (err) {
        console.error('Failed to load recruiter interviews:', err);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#EF4444; padding:24px;">Failed to load interviews: ${escapeHtml(err.message)}</td></tr>`;
    }
}
window.loadRecruiterInterviews = loadRecruiterInterviews;

function renderRecruiterInterviewsTable(interviews) {
    const tbody = document.getElementById('recInterviewsTableBody');
    if (!tbody) return;

    const filterStatus = (document.getElementById('recInterviewStatusFilter')?.value || '').trim().toLowerCase();

    let list = Array.isArray(interviews) ? [...interviews] : [];
    if (filterStatus) {
        list = list.filter((i) => (i.status || '').toLowerCase() === filterStatus);
    }

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; color:#718096; padding:32px;">
                    <div style="font-size:1.4rem; margin-bottom:6px;">📅</div>
                    No interview sessions found for your portfolio.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = list.map((inv) => {
        const cand = assignedCandidatesCache.find((c) => String(c.id) === String(inv.candidate_id)) || {};
        const candName = cand.name || `Candidate #${inv.candidate_id}`;
        const rawStatus = (inv.status || 'scheduled').toLowerCase();
        let statusBadge = `badge-${rawStatus}`;
        if (rawStatus === 'completed') statusBadge = 'badge-hired';
        if (rawStatus === 'cancelled') statusBadge = 'badge-rejected';

        let dateStr = inv.scheduled_at;
        try {
            const d = new Date(inv.scheduled_at);
            dateStr = d.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (_) {}

        const fbBadge = inv.has_feedback
            ? `<span class="badge badge-shortlisted">Evaluated ✓</span>`
            : `<span class="badge badge-applied">Pending</span>`;

        let actionBtns = '';
        if (rawStatus === 'scheduled') {
            actionBtns = `
                <button type="button" class="button btn-success btn-sm" onclick="recruiterCompleteInterviewPrompt('${inv.id}', '${escapeHtml(candName)}', ${inv.round || 1})">Complete</button>
                <button type="button" class="button btn-secondary btn-sm" onclick="recruiterCancelInterviewPrompt('${inv.id}')">Cancel</button>
            `;
        }

        if (!inv.has_feedback) {
            actionBtns += `
                <button type="button" class="button btn-primary btn-sm" onclick="openFeedbackForInterview('${inv.id}')">Submit Feedback</button>
            `;
        } else {
            actionBtns += `
                <button type="button" class="button btn-secondary btn-sm" onclick="openRecViewFeedbackModal('${inv.id}')">View Evaluation</button>
            `;
        }

        return `
            <tr>
                <td><strong style="color:var(--dark-navy);">#${inv.id}</strong></td>
                <td><strong>${escapeHtml(candName)}</strong></td>
                <td>Round ${inv.round || 1}</td>
                <td>${escapeHtml(dateStr)}</td>
                <td><span class="badge ${statusBadge}">${escapeHtml(rawStatus)}</span></td>
                <td>${fbBadge}</td>
                <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        ${actionBtns}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function populateRecruiterCandidateDropdown() {
    const select = document.getElementById('recInterviewCandidateSelect');
    if (!select) return;

    let html = '<option value="">-- Select Assigned Candidate --</option>';
    assignedCandidatesCache.forEach((cand) => {
        html += `<option value="${cand.id}">${escapeHtml(cand.name)} (${escapeHtml(cand.email)}) — ${escapeHtml(cand.status || 'applied')}</option>`;
    });
    select.innerHTML = html;
}

async function recruiterCompleteInterviewPrompt(id, candName, round) {
    if (!confirm(`Mark Round ${round} interview for "${candName}" as completed?`)) return;

    try {
        await window.api.updateInterview(id, { status: 'completed' });
        showAlert(`Interview session #${id} marked as completed!`, 'success');
        loadRecruiterInterviews();
        loadRecruiterDashboardStats();

        if (confirm(`Would you like to submit evaluation feedback for ${candName} now?`)) {
            openFeedbackForInterview(id);
        }
    } catch (err) {
        showAlert(err.message || 'Failed to complete interview.', 'error');
    }
}
window.recruiterCompleteInterviewPrompt = recruiterCompleteInterviewPrompt;

async function recruiterCancelInterviewPrompt(id) {
    const reason = prompt('Please enter cancellation remarks:', 'Scheduling adjustment');
    if (reason === null) return;

    try {
        await window.api.updateInterview(id, { status: 'cancelled' });
        showAlert(`Interview #${id} has been cancelled.`, 'success');
        loadRecruiterInterviews();
        loadRecruiterDashboardStats();
    } catch (err) {
        showAlert(err.message || 'Failed to cancel interview.', 'error');
    }
}
window.recruiterCancelInterviewPrompt = recruiterCancelInterviewPrompt;

function openFeedbackForInterview(invId) {
    navigateTo('feedback');
    setTimeout(() => {
        const select = document.getElementById('recFeedbackInterviewSelect');
        if (select) {
            select.value = invId;
            select.focus();
        }
    }, 200);
}
window.openFeedbackForInterview = openFeedbackForInterview;

/**
 * =============================================================================
 * 4. SUBMIT FEEDBACK MODULE
 * =============================================================================
 */
async function loadFeedbackInterviewDropdown() {
    const select = document.getElementById('recFeedbackInterviewSelect');
    if (!select) return;

    select.innerHTML = '<option value="">Loading interview sessions...</option>';

    try {
        const [interviews, candidates] = await Promise.all([
            window.api.getInterviews(),
            assignedCandidatesCache.length ? Promise.resolve(assignedCandidatesCache) : window.api.getCandidates()
        ]);

        assignedInterviewsCache = Array.isArray(interviews) ? interviews : [];
        assignedCandidatesCache = Array.isArray(candidates) ? candidates : [];

        let html = '<option value="">-- Select Interview Session to Evaluate --</option>';

        // Prioritize un-evaluated sessions
        const unevaluated = assignedInterviewsCache.filter((i) => !i.has_feedback);
        const evaluated = assignedInterviewsCache.filter((i) => i.has_feedback);

        if (unevaluated.length > 0) {
            html += '<optgroup label="Pending Feedback">';
            unevaluated.forEach((inv) => {
                const cand = assignedCandidatesCache.find((c) => String(c.id) === String(inv.candidate_id)) || {};
                const name = cand.name || `Candidate #${inv.candidate_id}`;
                html += `<option value="${inv.id}">${escapeHtml(name)} — Round ${inv.round || 1} (${escapeHtml(inv.status)})</option>`;
            });
            html += '</optgroup>';
        }

        if (evaluated.length > 0) {
            html += '<optgroup label="Already Evaluated">';
            evaluated.forEach((inv) => {
                const cand = assignedCandidatesCache.find((c) => String(c.id) === String(inv.candidate_id)) || {};
                const name = cand.name || `Candidate #${inv.candidate_id}`;
                html += `<option value="${inv.id}">${escapeHtml(name)} — Round ${inv.round || 1} (Evaluated ✓)</option>`;
            });
            html += '</optgroup>';
        }

        select.innerHTML = html;
    } catch (err) {
        select.innerHTML = '<option value="">Failed to load interviews</option>';
    }
}

async function loadRecruiterFeedbackHistory() {
    const tbody = document.getElementById('recFeedbackHistoryTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#718096; padding:24px;">Loading feedback history...</td></tr>';

    try {
        const [feedbackList, candidates] = await Promise.all([
            window.api.apiRequest('/feedback/', { method: 'GET' }),
            assignedCandidatesCache.length ? Promise.resolve(assignedCandidatesCache) : window.api.getCandidates()
        ]);

        recruiterFeedbackCache = Array.isArray(feedbackList) ? feedbackList : [];
        assignedCandidatesCache = Array.isArray(candidates) ? candidates : [];

        if (recruiterFeedbackCache.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align:center; color:#718096; padding:32px;">
                        <div style="font-size:1.4rem; margin-bottom:6px;">📝</div>
                        No feedback scorecards submitted yet.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = recruiterFeedbackCache.map((fb) => {
            const inv = assignedInterviewsCache.find((i) => String(i.id) === String(fb.interview_id));
            const candId = inv ? inv.candidate_id : fb.candidate_id;
            const cand = assignedCandidatesCache.find((c) => String(c.id) === String(candId)) || {};
            const candName = cand.name || `Candidate #${candId || '—'}`;

            let dateStr = fb.created_at;
            try {
                const d = new Date(fb.created_at);
                dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            } catch (_) {}

            return `
                <tr>
                    <td><strong style="color:var(--dark-navy);">#${fb.interview_id}</strong></td>
                    <td><strong>${escapeHtml(candName)}</strong></td>
                    <td><span class="badge badge-shortlisted">${fb.technical_score}/10</span></td>
                    <td><span class="badge badge-shortlisted">${fb.communication_score}/10</span></td>
                    <td><span class="badge badge-shortlisted">${fb.problem_solving_score}/10</span></td>
                    <td>${escapeHtml(dateStr)}</td>
                    <td style="text-align:right;">
                        <button type="button" class="button btn-secondary btn-sm" onclick="openRecViewFeedbackModal('${fb.interview_id}')">View Scorecard</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#EF4444; padding:24px;">Failed to load feedback history: ${escapeHtml(err.message)}</td></tr>`;
    }
}
window.loadRecruiterFeedbackHistory = loadRecruiterFeedbackHistory;

/**
 * =============================================================================
 * 5. NOTIFICATIONS MODULE (Bell Icon & Dropdown Navigation)
 * =============================================================================
 */
function setupRecruiterNotificationBell() {
    const bellBtn = document.getElementById('rNotificationsBellBtn');
    const dropdown = document.getElementById('rNotificationsDropdown');

    if (bellBtn && dropdown) {
        bellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
            if (!isVisible) {
                loadRecruiterNotifications();
            }
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }
}

function formatTimeAgo(dateString) {
    if (!dateString) return 'Just now';
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffSecs = Math.floor(diffMs / 1000);
        if (diffSecs < 60) return 'Just now';
        const diffMins = Math.floor(diffSecs / 60);
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (_) {
        return 'Recently';
    }
}

async function loadRecruiterNotifications() {
    const listContainer = document.getElementById('rNotificationsList');
    const badgeEl = document.getElementById('rNotificationsBadge');

    try {
        const res = await window.api.getNotifications();
        const notifs = res.notifications || [];
        const unreadCount = res.unread_count !== undefined ? res.unread_count : notifs.filter((n) => !n.is_read).length;

        if (badgeEl) {
            badgeEl.textContent = unreadCount;
            badgeEl.style.display = unreadCount > 0 ? 'inline-block' : 'none';
        }

        if (!listContainer) return;

        if (notifs.length === 0) {
            listContainer.innerHTML = '<div class="empty-notif" style="padding:24px; text-align:center; color:var(--secondary-text); font-size:0.86rem;">No new notifications</div>';
            return;
        }

        listContainer.innerHTML = notifs.map((n) => {
            const isUnread = !n.is_read;
            const timeAgo = formatTimeAgo(n.created_at);

            return `
                <div class="notification-item ${isUnread ? 'unread' : ''}" style="cursor:pointer; padding:10px 14px; border-bottom:1px solid var(--border-color); ${isUnread ? 'background:#EFF6FF;' : ''}" onclick="handleRecruiterNotifClick('${n.id}', '${escapeHtml(n.title)}', '${escapeHtml(n.message)}')">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <strong style="font-size:0.86rem; color:var(--dark-navy);">${escapeHtml(n.title)}</strong>
                        <span style="font-size:0.74rem; color:var(--secondary-text);">${timeAgo}</span>
                    </div>
                    <p style="margin:0; font-size:0.82rem; color:var(--text-secondary); line-height:1.35;">${escapeHtml(n.message)}</p>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.warn('Failed to load recruiter notifications:', err);
    }
}
window.loadRecruiterNotifications = loadRecruiterNotifications;

async function handleRecruiterNotifClick(notifId, title, message) {
    try {
        await window.api.markNotificationRead(notifId);
    } catch (_) {}

    const dropdown = document.getElementById('rNotificationsDropdown');
    if (dropdown) dropdown.style.display = 'none';

    loadRecruiterNotifications();

    const t = (title + ' ' + message).toLowerCase();
    if (t.includes('interview') || t.includes('scheduled') || t.includes('rescheduled')) {
        navigateTo('interviews');
    } else if (t.includes('feedback') || t.includes('scorecard') || t.includes('evaluation')) {
        navigateTo('feedback');
    } else if (t.includes('candidate') || t.includes('assign') || t.includes('shortlist') || t.includes('hired') || t.includes('selected') || t.includes('rejected')) {
        navigateTo('candidates');
    } else {
        navigateTo('overview');
    }
}
window.handleRecruiterNotifClick = handleRecruiterNotifClick;

async function markRecruiterNotificationRead(id) {
    try {
        await window.api.markNotificationRead(id);
        loadRecruiterNotifications();
    } catch (err) {
        showAlert('Failed to mark notification as read.', 'error');
    }
}
window.markRecruiterNotificationRead = markRecruiterNotificationRead;

async function markAllRecruiterNotificationsRead() {
    try {
        await window.api.markAllNotificationsRead();
        showAlert('All notifications marked as read.', 'success');
        loadRecruiterNotifications();
    } catch (err) {
        showAlert('Failed to mark all as read.', 'error');
    }
}
window.markAllRecruiterNotificationsRead = markAllRecruiterNotificationsRead;

/**
 * =============================================================================
 * 6. MODALS & FORMS HANDLERS
 * =============================================================================
 */
function setupRecruiterFormListeners() {
    // Schedule Interview Form
    const scheduleForm = document.getElementById('recScheduleInterviewForm');
    if (scheduleForm) {
        scheduleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnRecSchedule');
            const candId = document.getElementById('recInterviewCandidateSelect')?.value;
            const dateTimeVal = document.getElementById('recInterviewDateTime')?.value;
            const roundVal = parseInt(document.getElementById('recInterviewRound')?.value, 10) || 1;

            if (!candId || !dateTimeVal) {
                showAlert('Please select a candidate and schedule date/time.', 'error');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Scheduling...';
            }

            try {
                const scheduledAt = new Date(dateTimeVal).toISOString();
                await window.api.scheduleInterview({
                    candidate_id: candId,
                    scheduled_at: scheduledAt,
                    round: roundVal
                });

                showAlert(`Interview Round ${roundVal} scheduled successfully!`, 'success');
                scheduleForm.reset();
                loadRecruiterInterviews();
                loadRecruiterCandidates();
                loadRecruiterDashboardStats();
            } catch (err) {
                showAlert(err.message || 'Failed to schedule interview round.', 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span>📅</span> Schedule Interview Round';
                }
            }
        });
    }

    // Submit Feedback Form
    const feedbackForm = document.getElementById('recFeedbackForm');
    if (feedbackForm) {
        feedbackForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnRecSubmitFeedback');
            const interviewId = document.getElementById('recFeedbackInterviewSelect')?.value;
            const techScore = parseInt(document.getElementById('recTechScore')?.value, 10);
            const commScore = parseInt(document.getElementById('recCommScore')?.value, 10);
            const probScore = parseInt(document.getElementById('recProbScore')?.value, 10);
            const strengths = document.getElementById('recStrengths')?.value.trim();
            const weaknesses = document.getElementById('recWeaknesses')?.value.trim();
            const comments = document.getElementById('recComments')?.value.trim();

            if (!interviewId) {
                showAlert('Please select an interview session to evaluate.', 'error');
                return;
            }

            if (isNaN(techScore) || isNaN(commScore) || isNaN(probScore)) {
                showAlert('Please provide all three scores on a 0-10 scale.', 'error');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Submitting Scorecard...';
            }

            try {
                const payload = {
                    interview_id: interviewId,
                    technical_score: techScore,
                    communication_score: commScore,
                    problem_solving_score: probScore,
                    strengths: strengths || null,
                    weaknesses: weaknesses || null,
                    comments: comments || null
                };

                await window.api.submitFeedback(payload);
                showAlert('Evaluation feedback submitted successfully!', 'success');

                // Trigger GenAI candidate report generation in the background
                const selectedInv = assignedInterviewsCache.find((i) => String(i.id) === String(interviewId));
                if (selectedInv && selectedInv.candidate_id) {
                    window.api.generateReport(selectedInv.candidate_id)
                        .then(() => console.log('GenAI report synthesized.'))
                        .catch((e) => console.warn('Background report generation notice:', e));
                }

                feedbackForm.reset();
                loadFeedbackInterviewDropdown();
                loadRecruiterFeedbackHistory();
                loadRecruiterInterviews();
                loadRecruiterCandidates();
                loadRecruiterDashboardStats();
            } catch (err) {
                showAlert(err.message || 'Failed to submit feedback.', 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span>📝</span> Submit Scorecard &amp; Synthesize Report';
                }
            }
        });
    }

    // Lifecycle Decision Form
    const decisionForm = document.getElementById('recDecisionForm');
    if (decisionForm) {
        decisionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const candId = document.getElementById('recDecisionCandId')?.value;
            const action = document.getElementById('recDecisionAction')?.value;
            const remarks = document.getElementById('recDecisionRemarks')?.value.trim();
            const btn = document.getElementById('btnRecConfirmDecision');

            if (!remarks) {
                showAlert('Please provide decision remarks / justification.', 'error');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Confirming...';
            }

            try {
                await window.api.updateCandidate(candId, { status: action, remarks });
                showAlert(`Candidate #${candId} successfully marked as ${action.toUpperCase()}!`, 'success');
                closeRecDecisionModal();
                loadRecruiterCandidates();
                loadRecruiterDashboardStats();
            } catch (err) {
                showAlert(err.message || 'Failed to finalize candidate decision.', 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Confirm Decision';
                }
            }
        });
    }

    // First-Login Password Change Form
    const firstLoginForm = document.getElementById('firstLoginForm');
    if (firstLoginForm) {
        firstLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const alertEl = document.getElementById('firstLoginAlert');
            const oldPass = document.getElementById('firstLoginOldPass')?.value;
            const newPass = document.getElementById('firstLoginNewPass')?.value;
            const confirmPass = document.getElementById('firstLoginConfirmPass')?.value;
            const btn = document.getElementById('btnConfirmChangePass');

            if (alertEl) {
                alertEl.style.display = 'none';
                alertEl.className = 'alert';
            }

            if (!oldPass || !newPass || !confirmPass) {
                showFirstLoginAlert('Please fill in all password fields.', 'error');
                return;
            }

            if (newPass.length < 6) {
                showFirstLoginAlert('New password must be at least 6 characters long.', 'error');
                return;
            }

            if (newPass !== confirmPass) {
                showFirstLoginAlert('New passwords do not match. Please verify.', 'error');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Updating Password...';
            }

            try {
                await window.api.changePassword(oldPass, newPass);
                const user = window.api.getCurrentUser() || {};
                user.must_change_password = false;
                localStorage.setItem('current_user', JSON.stringify(user));
                sessionStorage.removeItem('must_change_password');

                const modal = document.getElementById('firstLoginPasswordModal');
                if (modal) modal.classList.remove('active');

                showAlert('Password successfully updated! Welcome to your Recruiter Portal.', 'success', 5000);
            } catch (err) {
                showFirstLoginAlert(err.message || 'Failed to update password. Please check your current password.', 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Save Password & Enter Portal';
                }
            }
        });
    }

    // Search and Status Filters
    const candSearch = document.getElementById('recCandSearchInput');
    const candStatus = document.getElementById('recCandStatusFilter');
    if (candSearch) candSearch.addEventListener('input', () => renderRecruiterCandidatesTable(assignedCandidatesCache));
    if (candStatus) candStatus.addEventListener('change', () => renderRecruiterCandidatesTable(assignedCandidatesCache));

    const intFilter = document.getElementById('recInterviewStatusFilter');
    if (intFilter) intFilter.addEventListener('change', () => renderRecruiterInterviewsTable(assignedInterviewsCache));
}

// Lifecycle Decision Modal
function openRecDecisionModal(candId, name, action) {
    const modal = document.getElementById('recDecisionModal');
    const candIdInput = document.getElementById('recDecisionCandId');
    const actionInput = document.getElementById('recDecisionAction');
    const title = document.getElementById('recDecisionModalTitle');
    const prompt = document.getElementById('recDecisionPrompt');
    const remarks = document.getElementById('recDecisionRemarks');
    const confirmBtn = document.getElementById('btnRecConfirmDecision');

    if (!modal || !candIdInput || !actionInput) return;

    candIdInput.value = candId;
    actionInput.value = action;
    if (remarks) remarks.value = '';

    const isSelect = action === 'selected';
    if (title) title.textContent = isSelect ? 'Final Hiring Decision: Select Candidate' : 'Conclude Application: Reject Candidate';
    if (prompt) {
        prompt.textContent = isSelect
            ? `Confirm final selection for "${name}" (ID #${candId})? This will mark candidate status as Selected.`
            : `Confirm rejection for "${name}" (ID #${candId})? This will conclude their recruitment process.`;
    }

    if (confirmBtn) {
        confirmBtn.textContent = isSelect ? 'Confirm Selection' : 'Confirm Rejection';
        confirmBtn.className = isSelect ? 'button btn-success' : 'button btn-danger';
    }

    modal.classList.add('active');
}
window.openRecDecisionModal = openRecDecisionModal;

function closeRecDecisionModal() {
    const modal = document.getElementById('recDecisionModal');
    if (modal) modal.classList.remove('active');
}
window.closeRecDecisionModal = closeRecDecisionModal;

// Status History Modal
async function openStatusHistoryModal(candId) {
    const modal = document.getElementById('statusHistoryModal');
    const body = document.getElementById('statusHistoryModalBody');
    const title = document.getElementById('statusHistoryModalTitle');
    if (!modal || !body) return;

    modal.classList.add('active');
    body.innerHTML = '<p style="color:var(--secondary-text); text-align:center;">Loading lifecycle history...</p>';

    try {
        const cand = await window.api.getCandidate(candId);
        if (title) title.textContent = `Recruitment Lifecycle History — ${cand.name}`;

        const history = cand.status_history || [];
        if (history.length === 0) {
            body.innerHTML = '<p style="text-align:center; color:var(--secondary-text);">No lifecycle history recorded yet.</p>';
            return;
        }

        body.innerHTML = history.slice().reverse().map((item) => {
            const rawStatus = (item.status || item.new_status || 'applied').toLowerCase();
            let statusBadge = `badge-${rawStatus}`;
            if (rawStatus === 'hired' || rawStatus === 'selected') statusBadge = 'badge-hired';

            let dateStr = item.timestamp;
            try {
                const d = new Date(item.timestamp);
                dateStr = d.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (_) {}

            return `
                <div style="border-left: 3px solid var(--primary-blue); padding-left: 14px; margin-bottom: 16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="badge ${statusBadge}">${escapeHtml(rawStatus.toUpperCase())}</span>
                        <span style="font-size:0.78rem; color:var(--secondary-text);">${escapeHtml(dateStr)}</span>
                    </div>
                    <div style="font-size:0.86rem; color:var(--dark-navy); margin-top:6px;">
                        ${escapeHtml(item.remarks || 'No remarks provided.')}
                    </div>
                    <div style="font-size:0.78rem; color:var(--secondary-text); margin-top:2px;">
                        Updated by: <strong>${escapeHtml(item.updated_by || 'Recruiter')}</strong>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        body.innerHTML = `<p style="color:var(--status-red); text-align:center;">Failed to load history: ${escapeHtml(err.message)}</p>`;
    }
}
window.openStatusHistoryModal = openStatusHistoryModal;

function closeStatusHistoryModal() {
    const modal = document.getElementById('statusHistoryModal');
    if (modal) modal.classList.remove('active');
}
window.closeStatusHistoryModal = closeStatusHistoryModal;

// View Feedback Modal
async function openRecViewFeedbackModal(interviewId) {
    const modal = document.getElementById('recViewFeedbackModal');
    const body = document.getElementById('recViewFeedbackBody');
    if (!modal || !body) return;

    modal.classList.add('active');
    body.innerHTML = '<p style="color:var(--secondary-text); text-align:center;">Loading scorecard...</p>';

    try {
        const fb = await window.api.getFeedbackByInterview(interviewId);
        body.innerHTML = `
            <div style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                    <div><strong>Session:</strong> #${escapeHtml(fb.interview_id)}</div>
                    <div><strong>Submitted:</strong> ${new Date(fb.created_at).toLocaleDateString()}</div>
                </div>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-bottom:16px; text-align:center;">
                    <div style="background:var(--hover-bg); padding:10px; border-radius:8px;">
                        <div style="font-size:0.75rem; color:var(--secondary-text);">Technical</div>
                        <div style="font-size:1.2rem; font-weight:700; color:var(--primary-blue);">${fb.technical_score}/10</div>
                    </div>
                    <div style="background:var(--hover-bg); padding:10px; border-radius:8px;">
                        <div style="font-size:0.75rem; color:var(--secondary-text);">Communication</div>
                        <div style="font-size:1.2rem; font-weight:700; color:var(--primary-blue);">${fb.communication_score}/10</div>
                    </div>
                    <div style="background:var(--hover-bg); padding:10px; border-radius:8px;">
                        <div style="font-size:0.75rem; color:var(--secondary-text);">Problem Solving</div>
                        <div style="font-size:1.2rem; font-weight:700; color:var(--primary-blue);">${fb.problem_solving_score}/10</div>
                    </div>
                </div>
                ${fb.strengths ? `<div style="margin-bottom:10px;"><strong>Strengths:</strong><p style="margin:2px 0; color:var(--dark-navy);">${escapeHtml(fb.strengths)}</p></div>` : ''}
                ${fb.weaknesses ? `<div style="margin-bottom:10px;"><strong>Areas for Growth:</strong><p style="margin:2px 0; color:var(--dark-navy);">${escapeHtml(fb.weaknesses)}</p></div>` : ''}
                ${fb.comments ? `<div><strong>Comments:</strong><p style="margin:2px 0; color:var(--dark-navy);">${escapeHtml(fb.comments)}</p></div>` : ''}
            </div>
        `;
    } catch (err) {
        body.innerHTML = `<p style="color:var(--status-red); text-align:center;">Failed to load evaluation scorecard: ${escapeHtml(err.message)}</p>`;
    }
}
window.openRecViewFeedbackModal = openRecViewFeedbackModal;

function closeRecViewFeedbackModal() {
    const modal = document.getElementById('recViewFeedbackModal');
    if (modal) modal.classList.remove('active');
}
window.closeRecViewFeedbackModal = closeRecViewFeedbackModal;

/**
 * =============================================================================
 * 7. MANDATORY FIRST-LOGIN PASSWORD CHANGE GUARD
 * =============================================================================
 */
function checkFirstLoginPasswordStatus() {
    const modal = document.getElementById('firstLoginPasswordModal');
    if (!modal) return;
    const user = (window.api && window.api.getCurrentUser()) || {};
    const mustChange = Boolean(user && user.must_change_password) || sessionStorage.getItem('must_change_password') === 'true';
    if (mustChange) {
        modal.classList.add('active');
    } else {
        modal.classList.remove('active');
    }
}
window.checkFirstLoginPasswordStatus = checkFirstLoginPasswordStatus;

function showFirstLoginAlert(msg, type = 'error') {
    const alertEl = document.getElementById('firstLoginAlert');
    if (!alertEl) return;
    alertEl.className = `alert alert-${type}`;
    alertEl.textContent = msg;
    alertEl.style.display = 'block';
}

/**
 * =============================================================================
 * 8. AI EVALUATION REPORT MODAL FOR ASSIGNED CANDIDATES
 * =============================================================================
 */
async function openRecReportModal(candId, candName) {
    const modal = document.getElementById('recReportModal');
    const body = document.getElementById('recReportModalBody');
    const title = document.getElementById('recReportModalTitle');
    const subtitle = document.getElementById('recReportModalSubtitle');
    if (!modal || !body) return;

    modal.classList.add('active');
    if (title) title.textContent = `AI Evaluation Report — ${escapeHtml(candName)}`;
    if (subtitle) subtitle.textContent = `Candidate ID #${candId} • Generative AI Executive Synthesis`;
    body.innerHTML = '<p style="color:var(--secondary-text); text-align:center; padding:24px;">Synthesizing AI Evaluation Report...</p>';

    try {
        let report = null;
        try {
            report = await window.api.getReport(candId);
        } catch (_) {}

        if (!report || !report.content) {
            body.innerHTML = `
                <div style="text-align:center; padding:32px 16px;">
                    <div style="font-size:2.2rem; margin-bottom:10px;">📄</div>
                    <h4 style="margin:0 0 8px; color:var(--dark-navy);">No AI Report Generated Yet</h4>
                    <p style="font-size:0.88rem; color:var(--secondary-text); margin-bottom:18px;">
                        Synthesize an automated GenAI executive summary and competency evaluation for this assigned candidate.
                    </p>
                    <button type="button" class="button btn-primary" id="btnSynthesizeReport" onclick="synthesizeRecruiterReport('${candId}', '${escapeHtml(candName)}')">
                        <span>✨</span> Generate AI Evaluation Report
                    </button>
                </div>
            `;
            return;
        }

        renderRecReportContent(report, candId, candName);
    } catch (err) {
        body.innerHTML = `<p style="color:var(--status-red); text-align:center; padding:20px;">Failed to load report: ${escapeHtml(err.message)}</p>`;
    }
}
window.openRecReportModal = openRecReportModal;

function closeRecReportModal() {
    const modal = document.getElementById('recReportModal');
    if (modal) modal.classList.remove('active');
}
window.closeRecReportModal = closeRecReportModal;

async function synthesizeRecruiterReport(candId, candName) {
    const body = document.getElementById('recReportModalBody');
    if (body) {
        body.innerHTML = '<p style="color:var(--secondary-text); text-align:center; padding:28px;">Generating candidate evaluation report with LLM integration...</p>';
    }

    try {
        const report = await window.api.generateReport(candId);
        showAlert(`AI Evaluation Report generated for ${candName}!`, 'success');
        renderRecReportContent(report, candId, candName);
    } catch (err) {
        showAlert(err.message || 'Failed to synthesize AI report.', 'error');
        if (body) {
            body.innerHTML = `
                <div style="text-align:center; padding:32px 16px;">
                    <div style="font-size:2.2rem; margin-bottom:10px;">⚠️</div>
                    <h4 style="margin:0 0 8px; color:var(--dark-navy);">Unable to Generate Report</h4>
                    <p style="font-size:0.88rem; color:var(--secondary-text); margin-bottom:18px; max-width:440px; margin-left:auto; margin-right:auto; line-height:1.45;">
                        ${escapeHtml(err.message || 'Error occurred while generating report.')}
                    </p>
                    <button type="button" class="button btn-secondary" onclick="closeRecReportModal()">Close</button>
                </div>
            `;
        }
    }
}
window.synthesizeRecruiterReport = synthesizeRecruiterReport;

function renderRecReportContent(report, candId, candName) {
    const body = document.getElementById('recReportModalBody');
    if (!body) return;

    const content = report.content || {};
    const scores = content.competency_scores || content.scores || {};
    const rec = content.recommendation || report.recommendation || 'Pending Evaluation';

    let recBadgeClass = 'badge-shortlisted';
    const recLower = rec.toLowerCase();
    if (recLower.includes('hire') || recLower.includes('recommend')) recBadgeClass = 'badge-hired';
    if (recLower.includes('reject') || recLower.includes('not recommend')) recBadgeClass = 'badge-rejected';

    const techStr = (scores.technical !== undefined && scores.technical !== null) ? `${scores.technical}/10` : 'Pending';
    const commStr = (scores.communication !== undefined && scores.communication !== null) ? `${scores.communication}/10` : 'Pending';
    const probStr = (scores.problem_solving !== undefined && scores.problem_solving !== null) ? `${scores.problem_solving}/10` : 'Pending';
    const overallStr = (content.overall_score !== undefined && content.overall_score !== null) ? `${content.overall_score}/10` : (report.overall_score ? `${report.overall_score}/10` : 'Pending');

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:12px 16px;">
                <div>
                    <strong style="font-size:1.05rem; color:var(--dark-navy);">${escapeHtml(candName)}</strong>
                    <div style="font-size:0.82rem; color:var(--secondary-text);">Candidate ID #${candId}</div>
                </div>
                <div>
                    <span class="badge ${recBadgeClass}" style="font-size:0.85rem; padding:4px 10px;">${escapeHtml(rec.toUpperCase())}</span>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; text-align:center;">
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:10px;">
                    <div style="font-size:0.72rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Technical</div>
                    <div style="font-size:1.3rem; font-weight:800; color:#1769C2; margin-top:2px;">${techStr}</div>
                </div>
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:10px;">
                    <div style="font-size:0.72rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Communication</div>
                    <div style="font-size:1.3rem; font-weight:800; color:#16A36A; margin-top:2px;">${commStr}</div>
                </div>
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:10px;">
                    <div style="font-size:0.72rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Problem Solving</div>
                    <div style="font-size:1.3rem; font-weight:800; color:#8B5CF6; margin-top:2px;">${probStr}</div>
                </div>
                <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:10px;">
                    <div style="font-size:0.72rem; font-weight:700; color:#1E40AF; text-transform:uppercase;">Overall</div>
                    <div style="font-size:1.3rem; font-weight:800; color:#1D4ED8; margin-top:2px;">${overallStr}</div>
                </div>
            </div>

            ${content.executive_summary || content.summary ? `
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                    <strong style="font-size:0.82rem; color:var(--dark-navy); text-transform:uppercase;">Executive Summary:</strong>
                    <p style="font-size:0.88rem; color:var(--dark-text); margin:6px 0 0; line-height:1.45;">${escapeHtml(content.executive_summary || content.summary)}</p>
                </div>
            ` : ''}

            ${Array.isArray(content.strengths) && content.strengths.length > 0 ? `
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                    <strong style="font-size:0.82rem; color:#065F46; text-transform:uppercase;">Strengths:</strong>
                    <ul style="margin:6px 0 0; padding-left:18px; font-size:0.88rem; color:var(--dark-navy);">
                        ${content.strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            ${Array.isArray(content.growth_areas) && content.growth_areas.length > 0 ? `
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                    <strong style="font-size:0.82rem; color:#991B1B; text-transform:uppercase;">Areas for Growth:</strong>
                    <ul style="margin:6px 0 0; padding-left:18px; font-size:0.88rem; color:var(--dark-navy);">
                        ${content.growth_areas.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
                <span style="font-size:0.78rem; color:var(--secondary-text);">
                    Report Date: ${report.created_at ? new Date(report.created_at).toLocaleString() : 'Just now'}
                    ${content.ai_provider ? ` • <strong style="color:var(--primary-blue);">${escapeHtml(content.ai_provider)}</strong>` : ''}
                </span>
                <button type="button" class="button btn-secondary btn-sm" onclick="synthesizeRecruiterReport('${candId}', '${escapeHtml(candName)}')">
                    <span>↻</span> Regenerate Report
                </button>
            </div>
        </div>
    `;
}

/**
 * =============================================================================
 * 9. ML SELECTION PREDICTION MODAL FOR ASSIGNED CANDIDATES
 * =============================================================================
 */
async function openRecPredictionModal(candId, candName) {
    const modal = document.getElementById('recPredictionModal');
    const body = document.getElementById('recPredictionModalBody');
    const title = document.getElementById('recPredictionModalTitle');
    const subtitle = document.getElementById('recPredictionModalSubtitle');
    if (!modal || !body) return;

    modal.classList.add('active');
    if (title) title.textContent = `ML Selection Prediction — ${escapeHtml(candName)}`;
    if (subtitle) subtitle.textContent = `Candidate ID #${candId} • Random Forest Classifier (94% Accuracy)`;
    body.innerHTML = '<p style="color:var(--secondary-text); text-align:center; padding:24px;">Loading candidate prediction features...</p>';

    try {
        const featData = await window.api.getCandidatePredictionFeatures(candId);
        const prefill = featData.prefill_values || {};
        const profile = featData.profile_data || {};
        const evalData = featData.evaluation_data || {};

        const edu = prefill.education || profile.education || 'bachelor';
        const exp = (prefill.years_experience !== null && prefill.years_experience !== undefined) ? prefill.years_experience : (profile.years_experience || 2);
        const skill = (prefill.skill_score !== null && prefill.skill_score !== undefined) ? prefill.skill_score : 7;
        const tech = (prefill.technical_score !== null && prefill.technical_score !== undefined) ? prefill.technical_score : 7;
        const comm = (prefill.communication_rating !== null && prefill.communication_rating !== undefined) ? prefill.communication_rating : 7;
        const perf = (prefill.prev_performance !== null && prefill.prev_performance !== undefined) ? prefill.prev_performance : 7;

        body.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:12px 14px; font-size:0.86rem; color:#1E40AF;">
                    <strong>Features extracted from MongoDB:</strong> ${evalData.completed_evaluations || 0} evaluation scorecard(s) found.
                </div>

                <form id="recPredForm" onsubmit="event.preventDefault(); runRecruiterPrediction('${candId}', '${escapeHtml(candName)}');">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
                        <div class="form-group">
                            <label style="font-size:0.82rem; font-weight:600; color:var(--dark-navy);">Education Level</label>
                            <select id="recPredEdu" style="width:100%; border-radius:6px; border:1px solid var(--border-color); padding:8px; font-size:0.85rem;">
                                <option value="highschool" ${edu === 'highschool' ? 'selected' : ''}>High School</option>
                                <option value="bachelor" ${edu === 'bachelor' ? 'selected' : ''}>Bachelor's Degree</option>
                                <option value="master" ${edu === 'master' ? 'selected' : ''}>Master's Degree</option>
                                <option value="phd" ${edu === 'phd' ? 'selected' : ''}>PhD</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label style="font-size:0.82rem; font-weight:600; color:var(--dark-navy);">Experience (Years)</label>
                            <input type="number" id="recPredExp" value="${exp}" min="0" max="40" style="width:100%; border-radius:6px; border:1px solid var(--border-color); padding:8px; font-size:0.85rem;" required />
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
                        <div class="form-group">
                            <label style="font-size:0.82rem; font-weight:600; color:var(--dark-navy);">Skill Score (1-10)</label>
                            <input type="number" id="recPredSkill" value="${skill}" min="1" max="10" style="width:100%; border-radius:6px; border:1px solid var(--border-color); padding:8px; font-size:0.85rem;" required />
                        </div>
                        <div class="form-group">
                            <label style="font-size:0.82rem; font-weight:600; color:var(--dark-navy);">Technical Score (1-10)</label>
                            <input type="number" id="recPredTech" value="${tech}" min="1" max="10" style="width:100%; border-radius:6px; border:1px solid var(--border-color); padding:8px; font-size:0.85rem;" required />
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
                        <div class="form-group">
                            <label style="font-size:0.82rem; font-weight:600; color:var(--dark-navy);">Communication Rating (1-10)</label>
                            <input type="number" id="recPredComm" value="${comm}" min="1" max="10" style="width:100%; border-radius:6px; border:1px solid var(--border-color); padding:8px; font-size:0.85rem;" required />
                        </div>
                        <div class="form-group">
                            <label style="font-size:0.82rem; font-weight:600; color:var(--dark-navy);">Previous Performance (1-10)</label>
                            <input type="number" id="recPredPerf" value="${perf}" min="1" max="10" style="width:100%; border-radius:6px; border:1px solid var(--border-color); padding:8px; font-size:0.85rem;" required />
                        </div>
                    </div>

                    <button type="submit" class="button btn-primary" id="btnRunRecPred" style="width:100%;">
                        <span>⚡</span> Run ML Selection Model
                    </button>
                </form>

                <div id="recPredResultContainer" style="display:none; margin-top:10px;"></div>
            </div>
        `;
    } catch (err) {
        body.innerHTML = `<p style="color:var(--status-red); text-align:center; padding:20px;">Failed to load features: ${escapeHtml(err.message)}</p>`;
    }
}
window.openRecPredictionModal = openRecPredictionModal;

function closeRecPredictionModal() {
    const modal = document.getElementById('recPredictionModal');
    if (modal) modal.classList.remove('active');
}
window.closeRecPredictionModal = closeRecPredictionModal;

async function runRecruiterPrediction(candId, candName) {
    const btn = document.getElementById('btnRunRecPred');
    const resultBox = document.getElementById('recPredResultContainer');
    if (!resultBox) return;

    const edu = document.getElementById('recPredEdu')?.value;
    const exp = parseFloat(document.getElementById('recPredExp')?.value) || 0;
    const skill = parseFloat(document.getElementById('recPredSkill')?.value) || 7;
    const tech = parseFloat(document.getElementById('recPredTech')?.value) || 7;
    const comm = parseFloat(document.getElementById('recPredComm')?.value) || 7;
    const perf = parseFloat(document.getElementById('recPredPerf')?.value) || 7;

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Running Random Forest Model...';
    }

    try {
        const payload = {
            candidate_id: candId,
            education: edu,
            years_experience: exp,
            skill_score: skill,
            technical_score: tech,
            communication_rating: comm,
            prev_performance: perf
        };

        const res = await window.api.predictSelection(payload);
        const predClass = res.class || (res.prediction === 1 ? 'Highly Likely to Select' : 'Low Selection Probability');
        const isHighlyLikely = predClass.toLowerCase().includes('highly');
        const isModerately = predClass.toLowerCase().includes('moderately');
        const isPositive = isHighlyLikely || isModerately;

        let statusColor = isHighlyLikely ? '#047857' : (isModerately ? '#1D4ED8' : '#DC2626');
        let statusBg = isHighlyLikely ? '#ECFDF5' : (isModerately ? '#EFF6FF' : '#FEF2F2');
        let statusBorder = isHighlyLikely ? '#A7F3D0' : (isModerately ? '#BFDBFE' : '#FECACA');
        let badgeLabel = isHighlyLikely ? 'RECOMMEND HIRE' : (isModerately ? 'CONSIDER WITH REVIEW' : 'DO NOT HIRE');

        const probs = res.probabilities || {};
        const highlyProb = probs['Highly Likely to Select'] !== undefined ? (probs['Highly Likely to Select'] * 100).toFixed(1) : '0.0';
        const modProb = probs['Moderately Likely to Select'] !== undefined ? (probs['Moderately Likely to Select'] * 100).toFixed(1) : '0.0';
        const lowProb = probs['Low Selection Probability'] !== undefined ? (probs['Low Selection Probability'] * 100).toFixed(1) : '0.0';

        const topProb = res.probability !== undefined ? (res.probability * 100).toFixed(1) : (isHighlyLikely ? highlyProb : (isModerately ? modProb : lowProb));

        resultBox.style.display = 'block';
        resultBox.innerHTML = `
            <div style="background:${statusBg}; border:1px solid ${statusBorder}; border-radius:10px; padding:16px; margin-top:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-size:0.75rem; font-weight:700; color:${statusColor}; text-transform:uppercase; letter-spacing:0.5px;">Random Forest Classification</span>
                    <span class="badge ${isPositive ? 'badge-hired' : 'badge-rejected'}" style="font-size:0.8rem; padding:3px 8px;">${badgeLabel}</span>
                </div>
                <div style="font-size:1.4rem; font-weight:800; color:${statusColor}; margin-bottom:4px;">
                    ${escapeHtml(predClass)}
                </div>
                <div style="font-size:0.92rem; font-weight:600; color:var(--dark-navy); margin-bottom:12px;">
                    Model Confidence: <strong>${topProb}%</strong>
                </div>

                <!-- Probability breakdown for all 3 classes -->
                <div style="background:var(--card-bg, #ffffff); border:1px solid var(--border-color); border-radius:8px; padding:10px; font-size:0.82rem; margin-bottom:10px;">
                    <div style="font-weight:600; margin-bottom:6px; color:var(--dark-navy);">Class Probability Distribution:</div>
                    <div style="margin-bottom:6px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                            <span>Highly Likely to Select</span>
                            <strong>${highlyProb}%</strong>
                        </div>
                        <div style="background:#E2E8F0; height:6px; border-radius:3px; overflow:hidden;">
                            <div style="background:#16A36A; width:${highlyProb}%; height:100%;"></div>
                        </div>
                    </div>
                    <div style="margin-bottom:6px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                            <span>Moderately Likely to Select</span>
                            <strong>${modProb}%</strong>
                        </div>
                        <div style="background:#E2E8F0; height:6px; border-radius:3px; overflow:hidden;">
                            <div style="background:#3B82C4; width:${modProb}%; height:100%;"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                            <span>Low Selection Probability</span>
                            <strong>${lowProb}%</strong>
                        </div>
                        <div style="background:#E2E8F0; height:6px; border-radius:3px; overflow:hidden;">
                            <div style="background:#E5484D; width:${lowProb}%; height:100%;"></div>
                        </div>
                    </div>
                </div>

                <div style="font-size:0.75rem; color:var(--secondary-text); text-align:right;">
                    Model: ${escapeHtml(res.model_algorithm || 'Scikit-Learn RandomForestClassifier')}
                </div>
            </div>
        `;
    } catch (err) {
        resultBox.style.display = 'block';
        resultBox.innerHTML = `<div class="alert alert-error" style="display:block;">Prediction failed: ${escapeHtml(err.message)}</div>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>⚡</span> Run ML Selection Model';
        }
    }
}
window.runRecruiterPrediction = runRecruiterPrediction;
