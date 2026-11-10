/**
 * dashboard.js - Admin Dashboard Controller for AI Interview Management System
 * Connects UI to FastAPI backend via api.js
 * Enterprise UI/UX Edition
 */

// Cache of loaded entities
let candidatesCache = [];
let interviewsCache = [];
let usersCache = [];
let feedbackHistoryCache = [];

document.addEventListener('DOMContentLoaded', () => {
    // 1. Authentication Guard
    if (!window.api || !window.api.isAuthenticated()) {
        if (window.api && typeof window.api.handleSessionExpiration === 'function') {
            window.api.handleSessionExpiration('Please sign in to access the dashboard.');
        } else {
            window.location.href = 'index.html';
        }
        return;
    }

    // Set User Profile in Top Navbar & Welcome Header
    const currentUser = window.api.getCurrentUser();
    if (currentUser) {
        const userRoleLower = (currentUser.role || '').toLowerCase();
        if (userRoleLower === 'candidate') {
            window.location.href = 'candidate.html';
            return;
        }
        if (userRoleLower === 'recruiter') {
            window.location.href = 'recruiter.html';
            return;
        }

        const username = currentUser.username || 'Admin';
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

        // Show/hide Admin-only tabs
        const navRecruiters = document.getElementById('nav-recruiters');
        if (navRecruiters) {
            navRecruiters.style.display = (userRoleLower === 'admin') ? 'inline-flex' : 'none';
        }
    } else {
        // If current user is null despite passing guard, force login redirect
        window.api.handleSessionExpiration('Your session has expired. Please sign in again.');
        return;
    }

    // Mobile Navigation Menu Toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navCenterMenu = document.getElementById('navCenterMenu');
    if (mobileMenuBtn && navCenterMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            navCenterMenu.classList.toggle('mobile-open');
        });
    }

    // Periodic session check every 30 seconds to catch token expiry proactively
    setInterval(() => {
        if (!window.api || !window.api.isAuthenticated()) {
            window.api.handleSessionExpiration('Your session has expired. Please sign in again.');
        }
    }, 30000);

    // 2. Setup Navigation
    setupNavigation();

    // 3. Setup Form Listeners & Feature Handlers
    setupFormListeners();
    setupNotificationEvents();
    setupExportReportEvents();
    setupRecruiterEvents();

    // 4. Initial Data Load
    loadDashboardStats();
    loadCandidates();
    loadInterviews();
    populateInterviewerDropdown();
    loadNotifications();

    // Periodic notifications polling
    setInterval(loadNotifications, 20000);

    // Check URL hash for initial tab
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);
});

/**
 * Navigation & Tab Switching
 */
function setupNavigation() {
    const navLinks = [
        { id: 'nav-dashboard', section: 'dashboard', title: 'Dashboard Overview' },
        { id: 'nav-candidates', section: 'candidates', title: 'Manage Candidates' },
        { id: 'nav-interviews', section: 'interviews', title: 'Schedule Interviews' },
        { id: 'nav-feedback', section: 'feedback', title: 'Interview Feedback' },
        { id: 'nav-predictions', section: 'predictions', title: 'Candidate Predictions' },
        { id: 'nav-reports', section: 'reports', title: 'AI Candidate Reports' },
        { id: 'nav-recruiters', section: 'recruiters', title: 'Recruiter Management' }
    ];

    navLinks.forEach((item) => {
        const link = document.getElementById(item.id);
        if (link) {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navigateTo(item.section);
            });
        }
    });

    // Logout
    const logoutBtn = document.getElementById('nav-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to sign out?')) {
                window.api.logout();
                window.location.href = 'index.html';
            }
        });
    }
}

function navigateTo(sectionName) {
    // Check authentication before navigating to any section
    if (!window.api || !window.api.isAuthenticated()) {
        if (window.api && typeof window.api.handleSessionExpiration === 'function') {
            window.api.handleSessionExpiration('Your session has expired. Please sign in again.');
        } else {
            window.location.href = 'index.html';
        }
        return;
    }

    // Close mobile nav if open
    const navMenu = document.getElementById('navCenterMenu');
    if (navMenu) navMenu.classList.remove('mobile-open');

    // Update active nav link
    const links = document.querySelectorAll('.nav-link-item');
    links.forEach((l) => l.classList.remove('active'));

    const activeLink = document.getElementById(`nav-${sectionName}`);
    if (activeLink) activeLink.classList.add('active');

    // Update active content section
    const sections = document.querySelectorAll('.content-section');
    sections.forEach((s) => s.classList.remove('active'));

    const activeSection = document.getElementById(`section-${sectionName}`);
    if (activeSection) {
        activeSection.classList.add('active');
    }

    // Update page title & subtitle
    const titleEl = document.getElementById('pageTitle');
    const titles = {
        dashboard: 'Dashboard Overview',
        candidates: 'Candidate Management',
        interviews: 'Schedule & Manage Interviews',
        feedback: 'Interview Feedback & Scoring',
        predictions: 'Machine Learning Candidate Prediction',
        reports: 'AI-Generated Candidate Reports',
        recruiters: 'Recruiter Account Management'
    };
    if (titleEl && titles[sectionName]) {
        titleEl.textContent = titles[sectionName];
    }

    const subtitles = {
        dashboard: 'Real-time recruitment analytics and evaluation pipeline',
        candidates: 'Register, edit and track candidates across the hiring pipeline',
        interviews: 'Schedule interview rounds and assign internal evaluators',
        feedback: 'Submit qualitative notes and structured quantitative scoring',
        predictions: 'Estimate hiring probability using trained Random Forest pipeline',
        reports: 'Synthesize multi-round evaluations into structured GenAI reports',
        recruiters: 'Provision recruiter logins and oversee recruitment operations team'
    };
    const subTitleEl = document.getElementById('headerSubtitle');
    if (subTitleEl && subtitles[sectionName]) {
        subTitleEl.textContent = subtitles[sectionName];
    }

    window.location.hash = sectionName;

    // Reset viewport scroll to top so sticky header never clips card headings
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger section-specific data loads
    if (sectionName === 'dashboard') {
        loadDashboardStats();
    } else if (sectionName === 'candidates') {
        loadCandidates();
    } else if (sectionName === 'interviews') {
        loadInterviews();
        populateCandidateDropdowns();
        populateInterviewerDropdown();
    } else if (sectionName === 'feedback') {
        loadFeedbackHistory();
    } else if (sectionName === 'predictions') {
        populateCandidateDropdowns();
        handlePredictionCandidateChange();
    } else if (sectionName === 'reports') {
        populateCandidateDropdowns();
    } else if (sectionName === 'recruiters') {
        loadRecruiters();
    }
}

// Expose navigateTo globally for inline HTML clicks
window.navigateTo = navigateTo;

/**
 * Toast / Alert Notifications
 */
function showAlert(message, type = 'success', duration = 4000) {
    const alertEl = document.getElementById('statusAlert');
    if (!alertEl) return;

    alertEl.className = `alert alert-${type}`;
    alertEl.textContent = message;
    alertEl.style.display = 'flex';

    if (alertEl.timeoutId) clearTimeout(alertEl.timeoutId);
    alertEl.timeoutId = setTimeout(() => {
        alertEl.style.display = 'none';
    }, duration);
}

/**
 * Helper to extract a timestamp Date from a candidate or interview record
 */
function getEntityDate(record) {
    if (!record) return null;
    if (record.scheduled_at) {
        const d = new Date(record.scheduled_at);
        if (!isNaN(d.getTime())) return d;
    }
    if (record.created_at) {
        const d = new Date(record.created_at);
        if (!isNaN(d.getTime())) return d;
    }
    if (record.id && typeof record.id === 'string' && record.id.length === 24) {
        try {
            const timestamp = parseInt(record.id.substring(0, 8), 16) * 1000;
            const d = new Date(timestamp);
            if (!isNaN(d.getTime())) return d;
        } catch (e) {}
    }
    return null;
}

/**
 * 1. DASHBOARD STATS & PIPELINE FUNNEL (With Date Range Filtering)
 */
async function loadDashboardStats() {
    try {
        const [statsResult, candsResult, intsResult] = await Promise.allSettled([
            window.api.getDashboardStats(),
            (!candidatesCache || candidatesCache.length === 0) ? window.api.getCandidates(0, 200) : Promise.resolve(candidatesCache),
            (!interviewsCache || interviewsCache.length === 0) ? window.api.getInterviews(0, 200) : Promise.resolve(interviewsCache)
        ]);

        if (candsResult.status === 'fulfilled' && Array.isArray(candsResult.value)) {
            candidatesCache = candsResult.value;
        }
        if (intsResult.status === 'fulfilled' && Array.isArray(intsResult.value)) {
            interviewsCache = intsResult.value;
        }

        const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
        applyDashboardDateFilter(stats);
    } catch (err) {
        console.error('Failed to load dashboard stats:', err);
    }
}

function applyDashboardDateFilter(rawStats = null) {
    const filterSelect = document.getElementById('dateFilterSelect');
    const filterVal = filterSelect ? filterSelect.value : '30';

    let filteredCands = Array.isArray(candidatesCache) ? [...candidatesCache] : [];
    let filteredInts = Array.isArray(interviewsCache) ? [...interviewsCache] : [];

    if (filterVal !== 'all') {
        const days = parseInt(filterVal, 10) || 30;
        const now = Date.now();
        const cutoffTime = now - (days * 24 * 60 * 60 * 1000);

        filteredCands = filteredCands.filter((c) => {
            const d = getEntityDate(c);
            return d ? d.getTime() >= cutoffTime : true;
        });

        filteredInts = filteredInts.filter((i) => {
            const d = getEntityDate(i);
            return d ? d.getTime() >= cutoffTime : true;
        });
    }

    const totalCandidates = filteredCands.length;
    const totalInterviews = filteredInts.length;
    const appliedCandidates = filteredCands.filter((c) => (c.status || '').toLowerCase() === 'applied').length;
    const shortlistedCandidates = filteredCands.filter((c) => (c.status || '').toLowerCase() === 'shortlisted').length;
    const scheduledInterviews = filteredInts.filter((i) => (i.status || '').toLowerCase() === 'scheduled').length;
    const completedInterviews = filteredInts.filter((i) => (i.status || '').toLowerCase() === 'completed').length;
    const selectedCandidates = filteredCands.filter((c) => ['hired', 'selected'].includes((c.status || '').toLowerCase())).length;
    const rejectedCandidates = filteredCands.filter((c) => (c.status || '').toLowerCase() === 'rejected').length;

    const totalRecruiters = (rawStats && rawStats.total_recruiters !== undefined) ? rawStats.total_recruiters : (usersCache.length || 0);
    const pendingFeedback = (rawStats && rawStats.pending_feedback !== undefined) ? rawStats.pending_feedback : 0;

    const totalCandEl = document.getElementById('stat-total-candidates');
    const appliedCandEl = document.getElementById('stat-applied-candidates');
    const shortCandEl = document.getElementById('stat-shortlisted-candidates');
    const schedIntEl = document.getElementById('stat-scheduled-interviews');
    const compIntEl = document.getElementById('stat-completed-interviews');
    const selCandEl = document.getElementById('stat-selected-candidates');
    const rejCandEl = document.getElementById('stat-rejected-candidates');
    const totalRecEl = document.getElementById('stat-total-recruiters');
    const pendFbEl = document.getElementById('stat-pending-feedback');

    if (totalCandEl) totalCandEl.textContent = totalCandidates;
    if (appliedCandEl) appliedCandEl.textContent = appliedCandidates;
    if (shortCandEl) shortCandEl.textContent = shortlistedCandidates;
    if (schedIntEl) schedIntEl.textContent = scheduledInterviews;
    if (compIntEl) compIntEl.textContent = completedInterviews;
    if (selCandEl) selCandEl.textContent = selectedCandidates;
    if (rejCandEl) rejCandEl.textContent = rejectedCandidates;
    if (totalRecEl) totalRecEl.textContent = totalRecruiters;
    if (pendFbEl) pendFbEl.textContent = pendingFeedback;

    // Legacy hidden compatibility hooks
    const totalIntEl = document.getElementById('stat-total-interviews');
    const pendIntEl = document.getElementById('stat-pending-interviews');
    if (totalIntEl) totalIntEl.textContent = totalInterviews;
    if (pendIntEl) pendIntEl.textContent = scheduledInterviews;

    updatePipelineMetrics(totalCandidates, {
        selected_candidates: selectedCandidates,
        rejected_candidates: rejectedCandidates,
        completed_interviews: completedInterviews,
        scheduled_interviews: scheduledInterviews
    }, totalInterviews, filteredCands, filterVal);
}
window.applyDashboardDateFilter = applyDashboardDateFilter;

function updatePipelineMetrics(totalCandidates, stats, totalInterviews, candidateList = candidatesCache, filterVal = '30') {
    const list = Array.isArray(candidateList) ? candidateList : [];
    const counts = {
        applied: list.filter((c) => (c.status || '').toLowerCase() === 'applied').length,
        shortlisted: list.filter((c) => (c.status || '').toLowerCase() === 'shortlisted').length,
        scheduled: list.filter((c) => (c.status || '').toLowerCase() === 'scheduled').length,
        interviewed: list.filter((c) => (c.status || '').toLowerCase() === 'interviewed').length,
        selected: stats?.selected_candidates ?? list.filter((c) => ['hired', 'selected'].includes((c.status || '').toLowerCase())).length,
        rejected: stats?.rejected_candidates ?? list.filter((c) => (c.status || '').toLowerCase() === 'rejected').length
    };

    const total = totalCandidates > 0 ? totalCandidates : 1;

    const stages = [
        { key: 'applied', count: counts.applied },
        { key: 'shortlisted', count: counts.shortlisted },
        { key: 'scheduled', count: counts.scheduled },
        { key: 'interviewed', count: counts.interviewed },
        { key: 'selected', count: counts.selected },
        { key: 'rejected', count: counts.rejected }
    ];

    stages.forEach((st) => {
        const pct = Math.round((st.count / total) * 100);
        const countEl = document.getElementById(`pipe-${st.key}-count`);
        const barEl = document.getElementById(`pipe-${st.key}-bar`);
        if (countEl) countEl.textContent = `${st.count} (${pct}%)`;
        if (barEl) barEl.style.width = `${Math.min(pct, 100)}%`;

        // Update top segmented bar
        const segEl = document.getElementById(`seg-${st.key}`);
        if (segEl) {
            segEl.style.width = `${Math.max(pct, st.count > 0 ? 8 : 0)}%`;
        }
    });

    const completionRate = totalInterviews > 0
        ? Math.round(((stats.completed_interviews || 0) / totalInterviews) * 100)
        : 0;
    const selectionRate = totalCandidates > 0
        ? Math.round((counts.selected / totalCandidates) * 100)
        : 0;

    const compRateEl = document.getElementById('analytics-completion-rate');
    const selRateEl = document.getElementById('analytics-selection-rate');
    const activeTotalBadge = document.getElementById('pipelineActiveTotalBadge');
    const kpiSelectionRate = document.getElementById('stat-selection-rate-kpi');
    const meterCompletionFill = document.getElementById('meterCompletionFill');
    const meterSelectionFill = document.getElementById('meterSelectionFill');

    if (compRateEl) compRateEl.textContent = `${completionRate}%`;
    if (meterCompletionFill) meterCompletionFill.style.width = `${completionRate}%`;

    if (selRateEl) selRateEl.textContent = `${selectionRate}%`;
    if (meterSelectionFill) meterSelectionFill.style.width = `${selectionRate}%`;

    if (kpiSelectionRate) kpiSelectionRate.textContent = `${selectionRate}%`;

    if (activeTotalBadge) {
        const filterLabel = filterVal === 'all' ? 'All Time' : (filterVal === '7' ? 'Last 7 Days' : filterVal === '90' ? 'Last 90 Days' : 'Last 30 Days');
        activeTotalBadge.textContent = `${totalCandidates} Candidates Total (${filterLabel})`;
    }
}

/**
 * 2. MANAGE CANDIDATES
 */
async function loadCandidates() {
    const tbody = document.getElementById('candidatesTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#718096; padding:24px;">Loading candidates...</td></tr>';
    }

    try {
        const candidates = await window.api.getCandidates(0, 200);
        candidatesCache = candidates || [];
        renderCandidatesTable(candidatesCache);
        populateCandidateDropdowns();
    } catch (err) {
        console.error('Error fetching candidates:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#e53e3e; padding:24px;">Failed to load candidates: ${escapeHtml(err.message)}</td></tr>`;
        }
    }
}

function renderCandidatesTable(candidates) {
    const tbody = document.getElementById('candidatesTableBody');
    if (!tbody) return;

    // Client-side search and status filtering
    const searchVal = (document.getElementById('candSearchInput')?.value || '').trim().toLowerCase();
    const filterStatus = (document.getElementById('candStatusFilter')?.value || '').trim().toLowerCase();

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
        const emptyMsg = (searchVal || filterStatus)
            ? 'No candidates match your search filters.'
            : 'No candidates registered in system yet.';
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#718096; padding:32px;"><div style="font-size:1.3rem; margin-bottom:6px;">🔍</div>${escapeHtml(emptyMsg)}</td></tr>`;
        return;
    }

    const currentUser = window.api.getCurrentUser();
    const isAdmin = currentUser && currentUser.role === 'admin';

    tbody.innerHTML = list.map((cand) => {
        const rawStatus = (cand.status || 'applied').toLowerCase();
        let statusClass = `badge-${rawStatus}`;
        if (rawStatus === 'hired' || rawStatus === 'selected') statusClass = 'badge-hired';

        // Contextual stage progression and decision actions
        let stageActionBtns = '';
        if (rawStatus === 'applied') {
            stageActionBtns = `
                <button type="button" class="button btn-success btn-sm" onclick="shortlistCandidatePrompt('${cand.id}', '${escapeHtml(cand.name)}')" title="Shortlist for interview">Shortlist</button>
                <button type="button" class="button btn-secondary btn-sm" onclick="openDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'rejected')" title="Reject Application">Reject</button>
            `;
        } else if (rawStatus === 'shortlisted') {
            stageActionBtns = `
                <button type="button" class="button btn-primary btn-sm" onclick="scheduleForCandidate('${cand.id}')" title="Schedule interview session">Schedule</button>
                <button type="button" class="button btn-secondary btn-sm" onclick="openDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'rejected')" title="Reject Application">Reject</button>
            `;
        } else if (rawStatus === 'scheduled') {
            stageActionBtns = `
                <button type="button" class="button btn-secondary btn-sm" onclick="navigateTo('interviews')" title="View interview schedule">Session</button>
                <button type="button" class="button btn-secondary btn-sm" onclick="openDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'rejected')" title="Reject Application">Reject</button>
            `;
        } else if (rawStatus === 'interviewed') {
            stageActionBtns = `
                <button type="button" class="button btn-success btn-sm" onclick="openDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'selected')" title="Select Candidate">⭐ Select</button>
                <button type="button" class="button btn-danger btn-sm" onclick="openDecisionModal('${cand.id}', '${escapeHtml(cand.name)}', 'rejected')" title="Reject Candidate">Reject</button>
            `;
        } else if (['selected', 'hired'].includes(rawStatus)) {
            stageActionBtns = `<span class="badge badge-hired">Selected</span>`;
        } else if (rawStatus === 'rejected') {
            stageActionBtns = `<span class="badge badge-rejected">Closed</span>`;
        }

        const editBtn = isAdmin
            ? `<button type="button" class="button btn-secondary btn-sm" onclick="openEditCandidateModal('${cand.id}')" title="Administrative Status Correction">Edit</button>`
            : '';

        const assignBtn = isAdmin
            ? `<button type="button" class="button btn-secondary btn-sm" onclick="openAssignRecruiterModal('${cand.id}', '${escapeHtml(cand.name)}', '${cand.assigned_recruiter_id || ''}')" title="Assign Recruiter">👤 Assign</button>`
            : '';

        const deleteBtn = isAdmin
            ? `<button type="button" class="button btn-danger btn-sm" onclick="deleteCandidatePrompt('${cand.id}', '${escapeHtml(cand.name)}')" title="Delete Candidate Record">Delete</button>`
            : '';

        const recruiterBadge = cand.assigned_recruiter_name
            ? `<span class="badge badge-shortlisted" style="font-size:0.75rem;">👤 ${escapeHtml(cand.assigned_recruiter_name)}</span>`
            : `<span class="badge badge-applied" style="font-size:0.75rem; color:#94A3B8; background:#F8FAFC; border-color:#E2E8F0;">Unassigned</span>`;

        return `
            <tr>
                <td><strong style="color:var(--dark-navy);">#${cand.id}</strong></td>
                <td>
                    <div style="font-weight:600; color:var(--dark-navy);">${escapeHtml(cand.name)}</div>
                </td>
                <td><span style="color:var(--text-secondary);">${escapeHtml(cand.email)}</span></td>
                <td>${recruiterBadge}</td>
                <td><span class="badge ${statusClass}">${escapeHtml(cand.status || 'applied')}</span></td>
                <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        ${stageActionBtns}
                        ${assignBtn}
                        <button type="button" class="button btn-secondary btn-sm" onclick="openStatusHistoryModal('${cand.id}')" title="View Lifecycle History">History</button>
                        ${editBtn}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function populateCandidateDropdowns() {
    const selects = [
        document.getElementById('interviewCandidateSelect'),
        document.getElementById('predCandidateSelect'),
        document.getElementById('reportCandidateSelect')
    ];

    selects.forEach((select) => {
        if (!select) return;
        const currentVal = select.value;
        let html = '<option value="">-- Select Candidate --</option>';
        candidatesCache.forEach((cand) => {
            html += `<option value="${cand.id}">${escapeHtml(cand.name)} (${escapeHtml(cand.email)})</option>`;
        });
        select.innerHTML = html;
        if (currentVal) select.value = currentVal;
    });
}

async function deleteCandidatePrompt(id, name) {
    if (!confirm(`Are you sure you want to permanently delete candidate "${name}" (ID #${id})?`)) {
        return;
    }

    try {
        await window.api.deleteCandidate(id);
        showAlert(`Candidate "${name}" deleted successfully.`, 'success');
        loadCandidates();
        loadDashboardStats();
    } catch (err) {
        showAlert(err.message || 'Failed to delete candidate.', 'error');
    }
}
window.deleteCandidatePrompt = deleteCandidatePrompt;

function openEditCandidateModal(id) {
    const candidate = candidatesCache.find((c) => String(c.id) === String(id));
    if (!candidate) return;

    document.getElementById('editCandId').value = candidate.id;
    document.getElementById('editCandName').value = candidate.name;
    document.getElementById('editCandEmail').value = candidate.email;
    document.getElementById('editCandPhone').value = candidate.phone || '';
    document.getElementById('editCandStatus').value = candidate.status || 'applied';
    const remarksEl = document.getElementById('editCandRemarks');
    if (remarksEl) remarksEl.value = '';

    const modal = document.getElementById('editCandidateModal');
    if (modal) modal.classList.add('active');
}
window.openEditCandidateModal = openEditCandidateModal;

function closeEditModal() {
    const modal = document.getElementById('editCandidateModal');
    if (modal) modal.classList.remove('active');
}
window.closeEditModal = closeEditModal;

/**
 * 3. SCHEDULE INTERVIEWS
 */
async function populateInterviewerDropdown() {
    const select = document.getElementById('interviewInterviewerSelect');
    if (!select) return;

    try {
        let recruiters = [];
        try {
            recruiters = await window.api.getRecruiters();
        } catch (e) {
            console.warn('Failed to load recruiters list:', e);
        }

        let html = '<option value="">-- Select Recruiter / Evaluator --</option>';
        if (Array.isArray(recruiters) && recruiters.length > 0) {
            recruiters.forEach((r) => {
                html += `<option value="${r.id}">${escapeHtml(r.username)} (Recruiter)</option>`;
            });
        }
        select.innerHTML = html;
    } catch (err) {
        console.warn('Could not populate interviewer select:', err);
    }
}

async function loadInterviews() {
    const tbody = document.getElementById('interviewsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#718096; padding:24px;">Loading interviews...</td></tr>';
    }

    try {
        const interviews = await window.api.getInterviews(0, 200);
        interviewsCache = interviews || [];
        renderInterviewsTable(interviewsCache);
    } catch (err) {
        console.error('Failed to load interviews:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#e53e3e; padding:24px;">Failed to load interviews: ${escapeHtml(err.message)}</td></tr>`;
        }
    }
}

function renderInterviewsTable(interviews) {
    const tbody = document.getElementById('interviewsTableBody');
    if (!tbody) return;

    if (!interviews || interviews.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#718096; padding:32px;"><div style="font-size:1.3rem; margin-bottom:6px;">📅</div>No interviews scheduled yet.</td></tr>';
        return;
    }

    const currentUser = window.api.getCurrentUser();
    const isAdmin = currentUser && currentUser.role === 'admin';

    tbody.innerHTML = interviews.map((item) => {
        const candidate = candidatesCache.find((c) => String(c.id) === String(item.candidate_id));
        const candLabel = candidate ? `${escapeHtml(candidate.name)} (#${item.candidate_id})` : `Candidate #${item.candidate_id}`;

        const intLabel = item.interviewer_name || (item.interviewer_id ? `User #${item.interviewer_id}` : 'Assigned Recruiter');

        let dateDisplay = item.scheduled_at;
        try {
            dateDisplay = new Date(item.scheduled_at).toLocaleString();
        } catch (e) {}

        const statusClass = `badge-${item.status || 'scheduled'}`;
        const rawStatus = (item.status || 'scheduled').toLowerCase();

        // Action buttons based strictly on session status:
        // - Scheduled: Complete, Cancel.
        // - Completed: View Feedback.
        // - Cancelled: View Details.
        let sessionActionBtns = '';
        if (rawStatus === 'scheduled') {
            sessionActionBtns = `
                <button type="button" class="button btn-success btn-sm" onclick="completeInterviewPrompt('${item.id}', '${item.candidate_id}', ${item.round})" title="Complete Interview Session">✓ Complete</button>
                <button type="button" class="button btn-secondary btn-sm" onclick="cancelInterviewPrompt('${item.id}')" title="Cancel Interview">Cancel</button>
            `;
        } else if (rawStatus === 'completed') {
            sessionActionBtns = `
                <button type="button" class="button btn-secondary btn-sm" onclick="viewInterviewFeedback('${item.id}')" title="View Evaluation Feedback">View Feedback</button>
            `;
            if (!item.has_feedback) {
                sessionActionBtns += `
                    <button type="button" class="button btn-primary btn-sm" onclick="openSubmitFeedbackForInterview('${item.id}')" title="Submit Evaluator Scorecard">Submit Feedback</button>
                `;
            }
        } else if (rawStatus === 'cancelled') {
            sessionActionBtns = `
                <button type="button" class="button btn-secondary btn-sm" onclick="viewInterviewDetails('${item.id}')" title="View Cancellation Details">View Details</button>
            `;
        }

        // Deletion is strictly restricted to Admin with confirmation
        const deleteBtn = isAdmin
            ? `<button type="button" class="button btn-danger btn-sm" onclick="deleteInterviewPrompt('${item.id}')" title="Delete Interview Record">Delete</button>`
            : '';

        return `
            <tr>
                <td><strong style="color:var(--dark-navy);">#${item.id}</strong></td>
                <td><strong>${candLabel}</strong></td>
                <td><span style="color:var(--text-secondary);">${escapeHtml(intLabel)}</span></td>
                <td>${escapeHtml(dateDisplay)}</td>
                <td><span class="score-pill">Round ${item.round}</span></td>
                <td><span class="badge ${statusClass}">${escapeHtml(rawStatus.toUpperCase())}</span></td>
                <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        ${sessionActionBtns}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function updateInterviewStatus(id, newStatus) {
    try {
        await window.api.updateInterview(id, { status: newStatus });
        showAlert(`Interview #${id} marked as ${newStatus}.`, 'success');
        loadInterviews();
        loadDashboardStats();
    } catch (err) {
        showAlert(err.message || 'Failed to update interview status.', 'error');
    }
}
window.updateInterviewStatus = updateInterviewStatus;

async function deleteInterviewPrompt(id) {
    const currentUser = window.api.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') {
        showAlert('Permission denied: Only administrators can delete interview records.', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to permanently delete interview session #${id}? This action cannot be undone.`)) return;

    try {
        await window.api.deleteInterview(id);
        showAlert(`Interview session #${id} deleted successfully.`, 'success');
        loadInterviews();
        loadDashboardStats();
    } catch (err) {
        showAlert(err.message || 'Failed to delete interview.', 'error');
    }
}
window.deleteInterviewPrompt = deleteInterviewPrompt;

/**
 * ==========================================================================
 * Candidate Stage Management & Hiring Decision Handlers
 * ==========================================================================
 */
async function shortlistCandidatePrompt(id, name) {
    if (!confirm(`Shortlist candidate "${name}" (ID #${id}) for interview scheduling?`)) {
        return;
    }

    try {
        await window.api.updateCandidate(id, {
            status: 'shortlisted',
            remarks: 'Candidate successfully shortlisted for interview rounds after profile screening.'
        });
        showAlert(`Candidate "${name}" shortlisted successfully!`, 'success');
        loadCandidates();
        loadDashboardStats();
        loadNotifications();
    } catch (err) {
        showAlert(err.message || 'Failed to shortlist candidate.', 'error');
    }
}
window.shortlistCandidatePrompt = shortlistCandidatePrompt;

function scheduleForCandidate(id) {
    navigateTo('interviews');
    const select = document.getElementById('interviewCandidateSelect');
    if (select) {
        select.value = id;
    }
    const form = document.getElementById('scheduleInterviewForm');
    if (form) {
        form.scrollIntoView({ behavior: 'smooth' });
    }
}
window.scheduleForCandidate = scheduleForCandidate;

function openDecisionModal(candId, name, action) {
    const modal = document.getElementById('decisionModal');
    const title = document.getElementById('decisionModalTitle');
    const prompt = document.getElementById('decisionCandidatePrompt');
    const candIdInput = document.getElementById('decisionCandId');
    const actionInput = document.getElementById('decisionAction');
    const remarksInput = document.getElementById('decisionRemarks');
    const confirmBtn = document.getElementById('btnConfirmDecision');

    if (!modal) return;

    candIdInput.value = candId;
    actionInput.value = action;
    remarksInput.value = '';

    const isSelect = action === 'selected';
    title.textContent = isSelect ? 'Final Hiring Decision: Select Candidate' : 'Final Hiring Decision: Reject Candidate';
    prompt.textContent = isSelect
        ? `Are you sure you want to finalize the hiring decision to SELECT "${name}" (ID #${candId})? This will update candidate status to Selected and send an offer notification.`
        : `Are you sure you want to REJECT "${name}" (ID #${candId})? This will conclude their recruitment process and notify the candidate.`;

    if (confirmBtn) {
        confirmBtn.textContent = isSelect ? 'Confirm Selection' : 'Confirm Rejection';
        confirmBtn.className = isSelect ? 'button btn-success' : 'button btn-danger';
    }

    modal.classList.add('active');
}
window.openDecisionModal = openDecisionModal;

function closeDecisionModal() {
    const modal = document.getElementById('decisionModal');
    if (modal) modal.classList.remove('active');
}
window.closeDecisionModal = closeDecisionModal;

/**
 * Assign Recruiter Modal Controls (Admin Only)
 */
async function openAssignRecruiterModal(candId, candName, currentRecId) {
    const modal = document.getElementById('assignRecruiterModal');
    const candIdInput = document.getElementById('assignCandId');
    const promptEl = document.getElementById('assignCandidatePrompt');
    const selectEl = document.getElementById('assignRecruiterSelect');
    if (!modal || !candIdInput || !selectEl) return;

    candIdInput.value = candId;
    if (promptEl) {
        promptEl.innerHTML = `Assign candidate <strong>${escapeHtml(candName)}</strong> (#${candId}) to a recruiter:`;
    }

    selectEl.innerHTML = '<option value="">Loading recruiters...</option>';

    try {
        const recruiters = await window.api.getRecruiters();
        let html = '<option value="">-- Select Recruiter --</option>';
        if (Array.isArray(recruiters)) {
            recruiters.forEach((r) => {
                const isSelected = (String(r.id) === String(currentRecId) || String(r._id) === String(currentRecId)) ? 'selected' : '';
                html += `<option value="${r.id || r._id}" ${isSelected}>${escapeHtml(r.username || r.name)} (${escapeHtml(r.role || 'recruiter')})</option>`;
            });
        }
        selectEl.innerHTML = html;
    } catch (err) {
        selectEl.innerHTML = '<option value="">Failed to load recruiters</option>';
        showAlert('Could not load recruiters list.', 'error');
    }

    modal.classList.add('active');
}
window.openAssignRecruiterModal = openAssignRecruiterModal;

function closeAssignRecruiterModal() {
    const modal = document.getElementById('assignRecruiterModal');
    if (modal) modal.classList.remove('active');
}
window.closeAssignRecruiterModal = closeAssignRecruiterModal;

async function handleAssignRecruiterSubmit(e) {
    e.preventDefault();
    const candId = document.getElementById('assignCandId')?.value;
    const recruiterId = document.getElementById('assignRecruiterSelect')?.value;
    const btn = document.getElementById('btnConfirmAssign');

    if (!candId) return;

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
    }

    try {
        await window.api.assignCandidateRecruiter(candId, recruiterId);
        showAlert('Candidate recruiter assignment updated successfully!', 'success');
        closeAssignRecruiterModal();
        loadCandidates();
    } catch (err) {
        showAlert(err.message || 'Failed to assign recruiter.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Save Assignment';
        }
    }
}
window.handleAssignRecruiterSubmit = handleAssignRecruiterSubmit;

async function unassignRecruiterAction() {
    const candId = document.getElementById('assignCandId')?.value;
    if (!candId) return;
    if (!confirm('Are you sure you want to clear recruiter assignment for this candidate?')) return;

    try {
        await window.api.assignCandidateRecruiter(candId, null);
        showAlert('Candidate recruiter assignment cleared.', 'info');
        closeAssignRecruiterModal();
        loadCandidates();
    } catch (err) {
        showAlert(err.message || 'Failed to clear assignment.', 'error');
    }
}
window.unassignRecruiterAction = unassignRecruiterAction;

/**
 * ==========================================================================
 * Interview Session Workflow Actions (Complete, Cancel, Feedback, Details)
 * ==========================================================================
 */
async function completeInterviewPrompt(id, candId, round) {
    if (!confirm(`Mark Round ${round} interview session #${id} as completed?`)) {
        return;
    }

    try {
        await window.api.updateInterview(id, { status: 'completed' });
        showAlert(`Interview session #${id} marked as completed! Designated recruiter evaluator can now submit the evaluation scorecard.`, 'success', 5000);
        loadInterviews();
        loadCandidates();
        loadDashboardStats();
        loadNotifications();
    } catch (err) {
        showAlert(err.message || 'Failed to complete interview.', 'error');
    }
}
window.completeInterviewPrompt = completeInterviewPrompt;

async function cancelInterviewPrompt(id) {
    const reason = prompt(`Are you sure you want to cancel interview #${id}? Please enter cancellation reason:`, 'Scheduling conflict');
    if (reason === null) return;

    try {
        await window.api.updateInterview(id, { status: 'cancelled' });
        showAlert(`Interview session #${id} has been cancelled.`, 'success');
        loadInterviews();
        loadCandidates();
        loadDashboardStats();
        loadNotifications();
    } catch (err) {
        showAlert(err.message || 'Failed to cancel interview.', 'error');
    }
}
window.cancelInterviewPrompt = cancelInterviewPrompt;

function openSubmitFeedbackForInterview(id) {
    navigateTo('feedback');
}
window.openSubmitFeedbackForInterview = openSubmitFeedbackForInterview;

async function viewInterviewFeedback(interviewId) {
    const modal = document.getElementById('viewFeedbackModal');
    const body = document.getElementById('viewFeedbackModalBody');
    const title = document.getElementById('viewFeedbackModalTitle');
    if (!modal || !body) return;

    modal.classList.add('active');
    if (title) title.textContent = `Interview Feedback (Session #${interviewId})`;
    body.innerHTML = '<p style="color:var(--secondary-text); text-align:center; padding:24px;">Loading feedback records...</p>';

    try {
        const feedback = await window.api.getFeedbackByInterview(interviewId);
        if (!feedback || !feedback.id) {
            body.innerHTML = `
                <div style="text-align:center; padding:32px 16px; color:var(--secondary-text);">
                    <div style="font-size:2rem; margin-bottom:8px;">⏳</div>
                    <div style="font-weight:600; color:var(--dark-navy); margin-bottom:6px;">Evaluation Pending</div>
                    <p style="font-size:0.88rem; margin-bottom:16px;">Feedback has not been submitted for this interview yet.</p>
                    <button type="button" class="button" onclick="closeViewFeedbackModal(); openSubmitFeedbackForInterview('${interviewId}')">Submit Feedback Now</button>
                </div>
            `;
            return;
        }

        body.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px;">
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:12px; text-align:center;">
                        <div style="font-size:0.74rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Technical</div>
                        <div style="font-size:1.4rem; font-weight:800; color:#1769C2; margin-top:4px;">${feedback.technical_score}/10</div>
                    </div>
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:12px; text-align:center;">
                        <div style="font-size:0.74rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Communication</div>
                        <div style="font-size:1.4rem; font-weight:800; color:#16A36A; margin-top:4px;">${feedback.communication_score}/10</div>
                    </div>
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:12px; text-align:center;">
                        <div style="font-size:0.74rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Problem Solving</div>
                        <div style="font-size:1.4rem; font-weight:800; color:#8B5CF6; margin-top:4px;">${feedback.problem_solving_score}/10</div>
                    </div>
                </div>

                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                    <strong style="font-size:0.82rem; color:#065F46; text-transform:uppercase;">Key Strengths:</strong>
                    <p style="font-size:0.88rem; color:var(--dark-navy); margin:6px 0 0;">${escapeHtml(feedback.strengths || 'Not specified')}</p>
                </div>

                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                    <strong style="font-size:0.82rem; color:#991B1B; text-transform:uppercase;">Areas for Growth:</strong>
                    <p style="font-size:0.88rem; color:var(--dark-navy); margin:6px 0 0;">${escapeHtml(feedback.weaknesses || 'Not specified')}</p>
                </div>

                ${feedback.comments ? `
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                        <strong style="font-size:0.82rem; color:var(--dark-navy); text-transform:uppercase;">Evaluator Comments:</strong>
                        <p style="font-size:0.88rem; color:var(--dark-text); margin:6px 0 0; line-height:1.45;">${escapeHtml(feedback.comments)}</p>
                    </div>
                ` : ''}
            </div>
        `;
    } catch (err) {
        body.innerHTML = `<p style="color:var(--status-red); text-align:center;">Failed to load feedback: ${escapeHtml(err.message)}</p>`;
    }
}
window.viewInterviewFeedback = viewInterviewFeedback;

function closeViewFeedbackModal() {
    const modal = document.getElementById('viewFeedbackModal');
    if (modal) modal.classList.remove('active');
}
window.closeViewFeedbackModal = closeViewFeedbackModal;

async function viewInterviewDetails(interviewId) {
    const modal = document.getElementById('viewInterviewDetailsModal');
    const body = document.getElementById('viewInterviewDetailsBody');
    const title = document.getElementById('viewInterviewDetailsTitle');
    if (!modal || !body) return;

    modal.classList.add('active');
    if (title) title.textContent = `Interview Details (#${interviewId})`;

    const inv = interviewsCache.find(i => String(i.id) === String(interviewId));
    if (!inv) {
        body.innerHTML = '<p style="text-align:center;">Interview not found.</p>';
        return;
    }

    const candidate = candidatesCache.find(c => String(c.id) === String(inv.candidate_id));
    const candName = candidate ? candidate.name : `Candidate #${inv.candidate_id}`;

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
            <div><strong>Candidate:</strong> ${escapeHtml(candName)}</div>
            <div><strong>Session Round:</strong> Round ${inv.round}</div>
            <div><strong>Scheduled At:</strong> ${inv.scheduled_at ? new Date(inv.scheduled_at).toLocaleString() : '—'}</div>
            <div><strong>Assigned Evaluator:</strong> ${escapeHtml(inv.interviewer_name || 'Assigned Recruiter')}</div>
            <div><strong>Status:</strong> <span class="badge badge-${inv.status || 'scheduled'}">${escapeHtml((inv.status || '').toUpperCase())}</span></div>
        </div>
    `;
}
window.viewInterviewDetails = viewInterviewDetails;

function closeInterviewDetailsModal() {
    const modal = document.getElementById('viewInterviewDetailsModal');
    if (modal) modal.classList.remove('active');
}
window.closeInterviewDetailsModal = closeInterviewDetailsModal;

/**
 * 4. INTERVIEW FEEDBACK
 */
async function loadFeedbackInterviews() {
    const select = document.getElementById('feedbackInterviewSelect');
    if (!select) return;

    try {
        const interviews = await window.api.getInterviews(0, 100);
        let html = '<option value="">-- Select Interview --</option>';
        interviews.forEach((inv) => {
            const cand = candidatesCache.find((c) => String(c.id) === String(inv.candidate_id));
            const candName = cand ? cand.name : `Candidate #${inv.candidate_id}`;
            html += `<option value="${inv.id}">Interview #${inv.id} - ${escapeHtml(candName)} (Round ${inv.round}, ${inv.status})</option>`;
        });
        select.innerHTML = html;
    } catch (err) {
        console.error('Failed to populate feedback interview dropdown:', err);
    }
}

async function loadFeedbackHistory() {
    const tbody = document.getElementById('feedbackTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:#718096; padding:28px;">Loading verified recruiter feedback records...</td></tr>';

    try {
        const feedbacks = await window.api.apiRequest('/feedback/', { method: 'GET' });
        feedbackHistoryCache = Array.isArray(feedbacks) ? feedbacks : [];
        filterAndRenderFeedbackTable();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:#EF4444; padding:24px;">Failed to load feedback records: ${escapeHtml(err.message)}</td></tr>`;
    }
}
window.loadFeedbackHistory = loadFeedbackHistory;

function filterAndRenderFeedbackTable() {
    const tbody = document.getElementById('feedbackTableBody');
    if (!tbody) return;

    const searchVal = (document.getElementById('fbSearchInput')?.value || '').trim().toLowerCase();
    const roundVal = (document.getElementById('fbRoundFilter')?.value || '').trim();

    let list = Array.isArray(feedbackHistoryCache) ? [...feedbackHistoryCache] : [];

    if (searchVal) {
        list = list.filter((fb) =>
            (fb.candidate_name || '').toLowerCase().includes(searchVal) ||
            (fb.candidate_email || '').toLowerCase().includes(searchVal) ||
            (fb.evaluator_name || '').toLowerCase().includes(searchVal) ||
            String(fb.interview_id || '').toLowerCase().includes(searchVal) ||
            String(fb.candidate_id || '').toLowerCase().includes(searchVal)
        );
    }

    if (roundVal) {
        list = list.filter((fb) => String(fb.round || 1) === roundVal);
    }

    if (list.length === 0) {
        const msg = (searchVal || roundVal)
            ? 'No verified evaluation scorecards match your search criteria.'
            : 'No evaluation feedback scorecards submitted by recruiters yet.';
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align:center; color:#718096; padding:36px;">
                    <div style="font-size:1.4rem; margin-bottom:6px;">📝</div>
                    ${escapeHtml(msg)}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = list.map((fb) => {
        const candName = fb.candidate_name || `Candidate #${fb.candidate_id || '—'}`;
        const candEmail = fb.candidate_email || '—';
        const evalName = fb.evaluator_name || 'Assigned Recruiter';
        const roundNum = fb.round || 1;
        const avgScore = ((fb.technical_score + fb.communication_score + fb.problem_solving_score) / 3).toFixed(1);

        let dateStr = fb.created_at;
        try {
            const d = new Date(fb.created_at);
            dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (_) {}

        return `
            <tr>
                <td>
                    <div style="font-weight:600; color:var(--dark-navy);">${escapeHtml(candName)}</div>
                    <div style="font-size:0.78rem; color:var(--secondary-text);">${escapeHtml(candEmail)}</div>
                </td>
                <td>
                    <strong>Session #${fb.interview_id}</strong>
                    <div style="font-size:0.78rem; color:var(--secondary-text);">Round ${roundNum}</div>
                </td>
                <td>
                    <span style="font-weight:500; color:var(--dark-navy);">${escapeHtml(evalName)}</span>
                </td>
                <td><span class="badge badge-shortlisted">${fb.technical_score}/10</span></td>
                <td><span class="badge badge-shortlisted">${fb.communication_score}/10</span></td>
                <td><span class="badge badge-shortlisted">${fb.problem_solving_score}/10</span></td>
                <td>
                    <span class="badge badge-hired" style="font-weight:700;">${avgScore}/10</span>
                </td>
                <td>
                    <div style="font-size:0.82rem; max-width:240px; line-height:1.35;">
                        ${fb.strengths ? `<div style="color:#065F46; margin-bottom:2px;"><strong>Strengths:</strong> ${escapeHtml(fb.strengths)}</div>` : ''}
                        ${fb.weaknesses ? `<div style="color:#991B1B;"><strong>Growth:</strong> ${escapeHtml(fb.weaknesses)}</div>` : ''}
                        ${!fb.strengths && !fb.weaknesses ? `<span style="color:var(--secondary-text);">None recorded</span>` : ''}
                    </div>
                </td>
                <td><span style="font-size:0.82rem; color:var(--secondary-text);">${escapeHtml(dateStr)}</span></td>
                <td style="text-align:right;">
                    <button type="button" class="button btn-secondary btn-sm" onclick="openAdminScorecardModal('${fb.id || fb._id || fb.interview_id}')" title="Inspect Full Scorecard">View</button>
                </td>
            </tr>
        `;
    }).join('');
}
window.filterAndRenderFeedbackTable = filterAndRenderFeedbackTable;

function openAdminScorecardModal(fbId) {
    const modal = document.getElementById('viewFeedbackModal');
    const body = document.getElementById('viewFeedbackModalBody');
    const title = document.getElementById('viewFeedbackModalTitle');
    if (!modal || !body) return;

    modal.classList.add('active');
    if (title) title.textContent = 'Recruiter Evaluation Scorecard';
    body.innerHTML = '<p style="color:var(--secondary-text); text-align:center; padding:24px;">Loading feedback scorecard...</p>';

    const fb = feedbackHistoryCache.find((f) => String(f.id) === String(fbId) || String(f._id) === String(fbId) || String(f.interview_id) === String(fbId));
    if (!fb) {
        body.innerHTML = '<p style="color:var(--status-red); text-align:center;">Scorecard record not found.</p>';
        return;
    }

    const candName = fb.candidate_name || 'Candidate';
    const evalName = fb.evaluator_name || 'Assigned Recruiter';
    const roundNum = fb.round || 1;
    const avgScore = ((fb.technical_score + fb.communication_score + fb.problem_solving_score) / 3).toFixed(1);

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:12px 16px;">
                <div>
                    <strong style="font-size:1.05rem; color:var(--dark-navy);">${escapeHtml(candName)}</strong>
                    <div style="font-size:0.82rem; color:var(--secondary-text);">${escapeHtml(fb.candidate_email || '')}</div>
                </div>
                <div style="text-align:right;">
                    <span class="badge badge-shortlisted">Round ${roundNum}</span>
                    <div style="font-size:0.8rem; color:var(--secondary-text); margin-top:2px;">Evaluator: <strong>${escapeHtml(evalName)}</strong></div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; text-align:center;">
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:10px;">
                    <div style="font-size:0.72rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Technical</div>
                    <div style="font-size:1.3rem; font-weight:800; color:#1769C2; margin-top:2px;">${fb.technical_score}/10</div>
                </div>
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:10px;">
                    <div style="font-size:0.72rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Communication</div>
                    <div style="font-size:1.3rem; font-weight:800; color:#16A36A; margin-top:2px;">${fb.communication_score}/10</div>
                </div>
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:10px;">
                    <div style="font-size:0.72rem; font-weight:700; color:var(--secondary-text); text-transform:uppercase;">Problem Solving</div>
                    <div style="font-size:1.3rem; font-weight:800; color:#8B5CF6; margin-top:2px;">${fb.problem_solving_score}/10</div>
                </div>
                <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:10px;">
                    <div style="font-size:0.72rem; font-weight:700; color:#1E40AF; text-transform:uppercase;">Average</div>
                    <div style="font-size:1.3rem; font-weight:800; color:#1D4ED8; margin-top:2px;">${avgScore}/10</div>
                </div>
            </div>

            <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                <strong style="font-size:0.82rem; color:#065F46; text-transform:uppercase;">Key Strengths:</strong>
                <p style="font-size:0.88rem; color:var(--dark-navy); margin:6px 0 0;">${escapeHtml(fb.strengths || 'None recorded')}</p>
            </div>

            <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                <strong style="font-size:0.82rem; color:#991B1B; text-transform:uppercase;">Areas for Growth:</strong>
                <p style="font-size:0.88rem; color:var(--dark-navy); margin:6px 0 0;">${escapeHtml(fb.weaknesses || 'None recorded')}</p>
            </div>

            ${fb.comments ? `
                <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:14px;">
                    <strong style="font-size:0.82rem; color:var(--dark-navy); text-transform:uppercase;">Evaluator Comments:</strong>
                    <p style="font-size:0.88rem; color:var(--dark-text); margin:6px 0 0; line-height:1.45;">${escapeHtml(fb.comments)}</p>
                </div>
            ` : ''}

            <div style="font-size:0.78rem; color:var(--secondary-text); text-align:right;">
                Submitted on: ${fb.created_at ? new Date(fb.created_at).toLocaleString() : '—'}
            </div>
        </div>
    `;
}
window.openAdminScorecardModal = openAdminScorecardModal;

/**
 * 5. CANDIDATE PREDICTIONS (ML)
 */
async function handlePredictionCandidateChange() {
    const select = document.getElementById('predCandidateSelect');
    const candId = select ? select.value.trim() : '';
    const badgeEl = document.getElementById('predCandidateSourceBadge');
    const freshnessEl = document.getElementById('predDataFreshnessNotice');

    const skillInput = document.getElementById('predSkillScore');
    const expInput = document.getElementById('predExperience');
    const techInput = document.getElementById('predTechScore');
    const commInput = document.getElementById('predCommRating');
    const perfInput = document.getElementById('predPrevPerf');
    const eduSelect = document.getElementById('predEducation');

    const skillSource = document.getElementById('predSkillScoreSource');
    const expSource = document.getElementById('predExpSource');
    const techSource = document.getElementById('predTechSource');
    const commSource = document.getElementById('predCommSource');
    const perfSource = document.getElementById('predPerfSource');
    const eduSource = document.getElementById('predEduSource');

    if (!candId) {
        if (badgeEl) badgeEl.textContent = '';
        if (freshnessEl) freshnessEl.textContent = '';
        if (skillInput) skillInput.value = '';
        if (expInput) expInput.value = '';
        if (techInput) techInput.value = '';
        if (commInput) commInput.value = '';
        if (perfInput) perfInput.value = '';
        return;
    }

    if (badgeEl) badgeEl.innerHTML = '<span style="color:var(--text-secondary);">Querying candidate profile and evaluations...</span>';

    try {
        const data = await window.api.getCandidatePredictionFeatures(candId);
        const prefill = data.prefill_values || {};
        const profile = data.profile_data || {};
        const evalData = data.evaluation_data || {};

        if (badgeEl) {
            const count = evalData.completed_evaluations || 0;
            badgeEl.innerHTML = `<strong>${escapeHtml(data.candidate_name)}</strong> &bull; Status: <span class="badge badge-applied">${escapeHtml(profile.status || 'applied')}</span> &bull; <strong>${count}</strong> evaluation scorecard(s) in MongoDB`;
        }

        // Years of experience (profile)
        if (expInput) {
            expInput.value = (prefill.years_experience !== null && prefill.years_experience !== undefined) ? prefill.years_experience : '';
            if (expSource) {
                expSource.innerHTML = (prefill.years_experience !== null && prefill.years_experience !== undefined)
                    ? `<span style="color:#059669;">✓ Sourced from candidate profile (${prefill.years_experience} yrs)</span>`
                    : `<span style="color:#D97706;">⚠️ Profile missing experience: please enter manually</span>`;
            }
        }

        // Education (profile)
        if (eduSelect && prefill.education) {
            eduSelect.value = prefill.education;
            if (eduSource) {
                eduSource.innerHTML = `<span style="color:#059669;">✓ Profile education: ${prefill.education.toUpperCase()}</span>`;
            }
        }

        // Technical Score (evaluation feedback)
        if (techInput) {
            techInput.value = (prefill.technical_score !== null && prefill.technical_score !== undefined) ? prefill.technical_score : '';
            if (techSource) {
                techSource.innerHTML = (prefill.technical_score !== null && prefill.technical_score !== undefined)
                    ? `<span style="color:#059669;">✓ Sourced from ${evalData.completed_evaluations} evaluator scorecard(s): ${prefill.technical_score}/10</span>`
                    : `<span style="color:#D97706;">⚠️ Evaluation pending: please enter manual assessment (1-10)</span>`;
            }
        }

        // Communication Rating (evaluation feedback)
        if (commInput) {
            commInput.value = (prefill.communication_rating !== null && prefill.communication_rating !== undefined) ? prefill.communication_rating : '';
            if (commSource) {
                commSource.innerHTML = (prefill.communication_rating !== null && prefill.communication_rating !== undefined)
                    ? `<span style="color:#059669;">✓ Sourced from ${evalData.completed_evaluations} evaluator scorecard(s): ${prefill.communication_rating}/10</span>`
                    : `<span style="color:#D97706;">⚠️ Evaluation pending: please enter manual assessment (1-10)</span>`;
            }
        }

        // Previous Performance / Problem Solving (evaluation feedback)
        if (perfInput) {
            perfInput.value = (prefill.prev_performance !== null && prefill.prev_performance !== undefined) ? prefill.prev_performance : '';
            if (perfSource) {
                perfSource.innerHTML = (prefill.prev_performance !== null && prefill.prev_performance !== undefined)
                    ? `<span style="color:#059669;">✓ Sourced from problem solving scorecard: ${prefill.prev_performance}/10</span>`
                    : `<span style="color:#D97706;">⚠️ Evaluation pending: please enter manual assessment (1-10)</span>`;
            }
        }

        // Skill Score: request manual recruiter entry if not specified
        if (skillInput) {
            skillInput.value = (prefill.skill_score !== null && prefill.skill_score !== undefined) ? prefill.skill_score : '';
            if (skillSource) {
                skillSource.innerHTML = (prefill.skill_score !== null && prefill.skill_score !== undefined)
                    ? `<span style="color:#059669;">✓ Sourced from candidate assessment (${prefill.skill_score}/10)</span>`
                    : `<span style="color:#D97706;">⚠️ Manual entry required: assess candidate skills on 1 - 10 scale</span>`;
            }
        }

        if (freshnessEl) {
            freshnessEl.innerHTML = `<span style="color:#059669;">✓ Real profile &amp; evaluation data populated. You may adjust any input before predicting.</span>`;
        }
    } catch (err) {
        console.warn('Failed to load candidate features:', err);
        if (badgeEl) badgeEl.innerHTML = `<span style="color:var(--status-red);">Could not load live features: ${escapeHtml(err.message)}</span>`;
    }
}
window.handlePredictionCandidateChange = handlePredictionCandidateChange;

async function handlePredictionSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btnPredict');
    const candSelect = document.getElementById('predCandidateSelect');

    const candidateId = candSelect ? candSelect.value.trim() : '';
    if (!candidateId) {
        showAlert('Please select a target candidate for prediction.', 'error');
        return;
    }

    const skillVal = document.getElementById('predSkillScore').value.trim();
    const expVal = document.getElementById('predExperience').value.trim();
    const techVal = document.getElementById('predTechScore').value.trim();
    const commVal = document.getElementById('predCommRating').value.trim();
    const perfVal = document.getElementById('predPrevPerf').value.trim();
    const eduVal = document.getElementById('predEducation').value;

    if (!skillVal || !expVal || !techVal || !commVal || !perfVal || !eduVal) {
        showAlert('Please provide all 6 prediction inputs before calculating.', 'error');
        return;
    }

    const payload = {
        skill_score: parseInt(skillVal, 10),
        years_experience: parseInt(expVal, 10),
        technical_score: parseInt(techVal, 10),
        communication_rating: parseInt(commVal, 10),
        prev_performance: parseInt(perfVal, 10),
        education: eduVal
    };

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Calculating Prediction...';
    }

    try {
        const response = await window.api.predictCandidate(candidateId, payload);
        renderPredictionResult(response, payload);
        showAlert('ML Prediction calculated successfully!', 'success');
    } catch (err) {
        console.error('Prediction failed:', err);
        showAlert(err.message || 'Prediction failed. Check input values.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>🔮</span> Calculate ML Prediction';
        }
    }
}

function renderPredictionResult(data, inputsUsed = null) {
    const resultBox = document.getElementById('predictionResultBox');
    const badgeEl = document.getElementById('predClassBadge');
    const probContainer = document.getElementById('predProbabilitiesContainer');
    const summaryContainer = document.getElementById('predInputsSummaryContainer');

    if (!resultBox || !badgeEl || !probContainer) return;

    resultBox.style.display = 'block';

    const predClass = data.class || 'Unknown';
    badgeEl.textContent = predClass;

    if (predClass.toLowerCase().includes('highly')) {
        badgeEl.className = 'badge badge-hired';
    } else if (predClass.toLowerCase().includes('moderately')) {
        badgeEl.className = 'badge badge-shortlisted';
    } else {
        badgeEl.className = 'badge badge-rejected';
    }

    // Render probability progress bars from Scikit-Learn
    const probs = data.probabilities || {};
    let totalProb = 0;
    let html = '';

    const orderedKeys = ['Highly Likely to Select', 'Moderately Likely to Select', 'Low Selection Probability'];
    const allKeys = Object.keys(probs);
    const keysToRender = orderedKeys.filter(k => allKeys.includes(k)).concat(allKeys.filter(k => !orderedKeys.includes(k)));

    for (const category of keysToRender) {
        const probVal = probs[category];
        if (probVal === undefined || probVal === null) continue;
        const pNum = Number(probVal);
        totalProb += pNum;
        const pct = (pNum * 100).toFixed(1);

        let barColor = 'linear-gradient(90deg, #1769C2, #3B82C4)';
        let pillColor = '#1769C2';

        if (category.toLowerCase().includes('highly')) {
            barColor = 'linear-gradient(90deg, #10B981, #34D399)';
            pillColor = '#10B981';
        } else if (category.toLowerCase().includes('moderately')) {
            barColor = 'linear-gradient(90deg, #1769C2, #60A5FA)';
            pillColor = '#1769C2';
        } else {
            barColor = 'linear-gradient(90deg, #EF4444, #F87171)';
            pillColor = '#EF4444';
        }

        html += `
            <div class="prob-row" style="margin-bottom:12px;">
                <div class="prob-label" style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.86rem;">
                    <span>${escapeHtml(category)}</span>
                    <span class="prob-pct-pill" style="color:${pillColor}; font-weight:700;">${pct}%</span>
                </div>
                <div class="progress-bar" style="background:#E2E8F0; height:8px; border-radius:4px; overflow:hidden;">
                    <div class="progress-fill" style="width: ${Math.min(100, Math.max(0, pNum * 100))}%; height:100%; background: ${barColor};"></div>
                </div>
            </div>
        `;
    }

    probContainer.innerHTML = html;

    // Display inputs used and model verification
    if (summaryContainer) {
        const inp = inputsUsed || data.input_features || {};
        const sumPct = (totalProb * 100).toFixed(1);
        summaryContainer.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div>
                    <strong>Inputs Evaluated:</strong> 
                    Skill: <strong>${inp.skill_score || '—'}</strong>/10 &bull; 
                    Exp: <strong>${inp.years_experience !== undefined ? inp.years_experience : '—'} yrs</strong> &bull; 
                    Tech: <strong>${inp.technical_score || '—'}</strong>/10 &bull; 
                    Comm: <strong>${inp.communication_rating || '—'}</strong>/10 &bull; 
                    Perf: <strong>${inp.prev_performance || '—'}</strong>/10 &bull; 
                    Edu: <strong>${escapeHtml((inp.education || '—').toUpperCase())}</strong>
                </div>
                <span class="badge badge-shortlisted" style="font-size:0.75rem;">
                    ✓ Probabilities Sum: ${sumPct}% (Model Validated)
                </span>
            </div>
        `;
    }
}

/**
 * 6. AI REPORTS (GenAI)
 */
async function handleGenerateReport() {
    const select = document.getElementById('reportCandidateSelect');
    const candId = select ? select.value.trim() : '';

    if (!candId) {
        showAlert('Please select a target candidate first.', 'error');
        return;
    }

    const btn = document.getElementById('btnGenerateReport');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating AI Report...';
    }

    try {
        const report = await window.api.generateReport(candId);
        renderReportDisplay(report);
        showAlert('AI Report generated successfully!', 'success');
    } catch (err) {
        showAlert(err.message || 'Failed to generate AI report.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>🤖</span> Generate AI Report';
        }
    }
}

async function handleViewLatestReport() {
    const select = document.getElementById('reportCandidateSelect');
    const candId = select ? select.value.trim() : '';

    if (!candId) {
        showAlert('Please select a target candidate first.', 'error');
        return;
    }

    const btn = document.getElementById('btnViewReport');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Fetching Report...';
    }

    try {
        const report = await window.api.getReport(candId);
        renderReportDisplay(report);
        showAlert('Report loaded successfully.', 'info');
    } catch (err) {
        showAlert(err.message || 'No existing report found for this candidate.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>📄</span> Fetch Latest Report';
        }
    }
}

function renderReportDisplay(report) {
    const card = document.getElementById('reportDisplayCard');
    const candNameEl = document.getElementById('reportCandName');
    const dateEl = document.getElementById('reportDate');
    const badgeEl = document.getElementById('reportRecBadge');
    const contentArea = document.getElementById('reportContentArea');

    if (!card || !contentArea) return;

    card.style.display = 'block';

    const cand = candidatesCache.find((c) => String(c.id) === String(report.candidate_id));
    if (candNameEl) candNameEl.textContent = cand ? `${cand.name} (${cand.email})` : `Candidate #${report.candidate_id}`;

    if (dateEl) {
        try {
            const d = new Date(report.created_at);
            const dateStr = !isNaN(d.getTime()) 
                ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                : report.created_at;
            dateEl.textContent = `Generated: ${dateStr}`;
        } catch (e) {
            dateEl.textContent = `Generated: ${report.created_at}`;
        }
    }

    const content = report.content;

    if (typeof content === 'object' && content !== null) {
        const scores = content.average_scores || {};
        const isNullOrEmpty = (v) => v === null || v === undefined || v === '' || String(v).toLowerCase() === 'null';

        const formatScore = (val) => {
            if (isNullOrEmpty(val)) {
                return '<span class="badge badge-applied" style="font-size:0.75rem;">Pending</span>';
            }
            const n = Number(val);
            return isNaN(n) 
                ? '<span class="badge badge-applied" style="font-size:0.75rem;">Pending</span>'
                : `<strong>${n} / 10</strong>`;
        };

        const hasAnyScore = !isNullOrEmpty(scores.technical) || !isNullOrEmpty(scores.communication) || !isNullOrEmpty(scores.problem_solving);
        const completedEvals = content.completed_evaluations || (hasAnyScore ? 1 : 0);

        // Recommendation badge
        let rec = content.recommendation || content.overall_recommendation;
        if (!hasAnyScore || completedEvals === 0) {
            rec = 'Pending Evaluation';
        } else if (!rec) {
            rec = 'Recommended';
        }

        if (badgeEl) {
            badgeEl.textContent = rec.toUpperCase();
            const recLower = rec.toLowerCase();
            if (recLower.includes('strong') || recLower.includes('hire')) {
                badgeEl.className = 'badge badge-hired';
            } else if (recLower.includes('reject') || recLower.includes('needs improvement')) {
                badgeEl.className = 'badge badge-rejected';
            } else if (recLower.includes('pending')) {
                badgeEl.className = 'badge badge-applied';
            } else {
                badgeEl.className = 'badge badge-shortlisted';
            }
        }

        let html = '';

        // If no feedback has been recorded: show prominent Pending Evaluation banner
        if (!hasAnyScore || completedEvals === 0) {
            html += `
                <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:16px; margin-bottom:18px;">
                    <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:var(--dark-navy); margin-bottom:6px;">
                        <span>⏳</span> Evaluation Pending
                    </div>
                    <p style="margin:0; font-size:0.86rem; color:var(--secondary-text); line-height:1.45;">
                        No interview feedback scorecards have been recorded for this candidate yet. Evaluated scores, executive summary, and hiring recommendations will appear automatically after evaluator feedback is submitted.
                    </p>
                </div>
            `;
        }

        // Executive Summary
        if (content.executive_summary || content.summary) {
            html += `
                <div class="report-section">
                    <h4><span>⚡</span> Executive Summary</h4>
                    <p>${escapeHtml(content.executive_summary || content.summary)}</p>
                </div>
            `;
        }

        // Competency scores (replaces raw NULL with Pending badge)
        html += `
            <div class="report-section">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h4 style="margin:0;"><span>📊</span> Evaluated Competency Scores</h4>
                    <span style="font-size:0.78rem; color:var(--muted-text);">${completedEvals} Evaluation(s) Recorded</span>
                </div>
                <div class="report-scores-chips" style="display:flex; gap:12px; flex-wrap:wrap;">
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:8px 14px; font-size:0.85rem;">
                        <span style="color:var(--secondary-text);">Technical:</span> ${formatScore(scores.technical)}
                    </div>
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:8px 14px; font-size:0.85rem;">
                        <span style="color:var(--secondary-text);">Communication:</span> ${formatScore(scores.communication)}
                    </div>
                    <div style="background:#F8FAFC; border:1px solid var(--border-color); border-radius:8px; padding:8px 14px; font-size:0.85rem;">
                        <span style="color:var(--secondary-text);">Problem Solving:</span> ${formatScore(scores.problem_solving)}
                    </div>
                    ${content.overall_score !== null && content.overall_score !== undefined ? `
                        <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:8px 14px; font-size:0.85rem;">
                            <span style="color:#1E40AF; font-weight:700;">Overall:</span> <strong>${content.overall_score}/10 (${content.overall_percentage || Math.round(content.overall_score * 10)}%)</strong>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Strengths (only show if present and has items)
        if (Array.isArray(content.strengths) && content.strengths.length > 0) {
            html += `
                <div class="report-section">
                    <h4><span>✓</span> Identified Strengths</h4>
                    <ul>
                        ${content.strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Growth Areas (only show if present and has items)
        if (Array.isArray(content.growth_areas) && content.growth_areas.length > 0) {
            html += `
                <div class="report-section">
                    <h4><span>🎯</span> Recommended Areas for Growth</h4>
                    <ul>
                        ${content.growth_areas.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        contentArea.innerHTML = html;
    } else {
        if (badgeEl) {
            badgeEl.textContent = 'REPORT READY';
            badgeEl.className = 'badge badge-applied';
        }
        contentArea.innerHTML = `<div class="report-section"><p style="white-space:pre-wrap;">${escapeHtml(String(content))}</p></div>`;
    }
}

/**
 * Setup Event Listeners for All Forms & Filters
 */
function setupFormListeners() {
    // Date Range Filter Dropdown
    const dateFilterSelect = document.getElementById('dateFilterSelect');
    if (dateFilterSelect) {
        dateFilterSelect.addEventListener('change', () => {
            applyDashboardDateFilter();
        });
    }

    // 1. Add Candidate
    const addCandForm = document.getElementById('addCandidateForm');
    if (addCandForm) {
        addCandForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnAddCandidate');
            const name = document.getElementById('candName').value.trim();
            const email = document.getElementById('candEmail').value.trim();
            const phone = document.getElementById('candPhone').value.trim();

            if (!name || !email) {
                showAlert('Name and Email are required.', 'error');
                return;
            }

            if (btn) btn.disabled = true;

            try {
                await window.api.createCandidate({ name, email, phone });
                showAlert(`Candidate "${name}" registered successfully!`, 'success');
                addCandForm.reset();
                loadCandidates();
                loadDashboardStats();
            } catch (err) {
                showAlert(err.message || 'Failed to register candidate.', 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }



    // Candidate Search & Status Filter
    const searchInput = document.getElementById('candSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderCandidatesTable(candidatesCache);
        });
    }

    const statusFilter = document.getElementById('candStatusFilter');
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            renderCandidatesTable(candidatesCache);
        });
    }

    // 2. Edit Candidate Modal Form
    const editCandForm = document.getElementById('editCandidateForm');
    if (editCandForm) {
        editCandForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editCandId').value.trim();
            const name = document.getElementById('editCandName').value.trim();
            const email = document.getElementById('editCandEmail').value.trim();
            const phone = document.getElementById('editCandPhone').value.trim();
            const status = document.getElementById('editCandStatus').value;
            const remarks = document.getElementById('editCandRemarks')?.value.trim();

            const btn = document.getElementById('btnSaveEditCandidate');
            if (btn) btn.disabled = true;

            try {
                await window.api.updateCandidate(id, { name, email, phone, status, remarks: remarks || undefined });
                showAlert(`Candidate #${id} updated successfully!`, 'success');
                closeEditModal();
                loadCandidates();
                loadDashboardStats();
            } catch (err) {
                showAlert(err.message || 'Failed to update candidate.', 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }



    // Final Hiring Decision Form
    const decisionForm = document.getElementById('decisionForm');
    if (decisionForm) {
        decisionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const candId = document.getElementById('decisionCandId').value;
            const action = document.getElementById('decisionAction').value;
            const remarks = document.getElementById('decisionRemarks').value.trim();
            const btn = document.getElementById('btnConfirmDecision');

            if (!remarks) {
                showAlert('Please provide decision remarks / justification.', 'error');
                return;
            }

            if (btn) btn.disabled = true;

            try {
                await window.api.updateCandidate(candId, { status: action, remarks });
                showAlert(`Candidate #${candId} successfully marked as ${action.toUpperCase()}!`, 'success');
                closeDecisionModal();
                loadCandidates();
                loadDashboardStats();
                loadNotifications();
            } catch (err) {
                showAlert(err.message || 'Failed to finalize candidate decision.', 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }



    // Assign Recruiter Form (Admin)
    const assignRecruiterForm = document.getElementById('assignRecruiterForm');
    if (assignRecruiterForm) {
        assignRecruiterForm.addEventListener('submit', handleAssignRecruiterSubmit);
    }

    // 3. Schedule Interview
    const scheduleForm = document.getElementById('scheduleInterviewForm');
    if (scheduleForm) {
        scheduleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnScheduleInterview');
            const candidateId = document.getElementById('interviewCandidateSelect').value.trim();
            const interviewerVal = document.getElementById('interviewInterviewerSelect').value.trim();
            const interviewerId = interviewerVal || null;
            const rawDateTime = document.getElementById('interviewDateTime').value;
            const round = parseInt(document.getElementById('interviewRound').value, 10) || 1;

            if (!candidateId || !rawDateTime) {
                showAlert('Please select a candidate and date/time.', 'error');
                return;
            }

            const scheduledAt = new Date(rawDateTime).toISOString();

            if (btn) btn.disabled = true;

            try {
                await window.api.scheduleInterview({
                    candidate_id: candidateId,
                    interviewer_id: interviewerId,
                    scheduled_at: scheduledAt,
                    round: round
                });
                showAlert('Interview scheduled successfully!', 'success');
                scheduleForm.reset();
                loadInterviews();
                loadDashboardStats();
            } catch (err) {
                showAlert(err.message || 'Failed to schedule interview.', 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }



    // 4. Recruiter Evaluation Feedback Table Search & Round Filters (Admin Read-Only)
    const fbSearchInput = document.getElementById('fbSearchInput');
    if (fbSearchInput) {
        fbSearchInput.addEventListener('input', () => {
            filterAndRenderFeedbackTable();
        });
    }

    const fbRoundFilter = document.getElementById('fbRoundFilter');
    if (fbRoundFilter) {
        fbRoundFilter.addEventListener('change', () => {
            filterAndRenderFeedbackTable();
        });
    }



    // 5. Prediction Form
    const predForm = document.getElementById('predictionForm');
    if (predForm) {
        predForm.addEventListener('submit', handlePredictionSubmit);
    }

    // 6. AI Reports
    const genReportBtn = document.getElementById('btnGenerateReport');
    if (genReportBtn) genReportBtn.addEventListener('click', handleGenerateReport);

    const viewReportBtn = document.getElementById('btnViewReport');
    if (viewReportBtn) viewReportBtn.addEventListener('click', handleViewLatestReport);
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

/* ==========================================================================
   Candidate Lifecycle & Status History Timeline
   ========================================================================== */
async function openStatusHistoryModal(id) {
    const modal = document.getElementById('statusHistoryModal');
    const body = document.getElementById('statusHistoryBody');
    const title = document.getElementById('historyModalTitle');
    if (!modal || !body) return;

    modal.classList.add('active');
    body.innerHTML = '<p style="color:var(--secondary-text); padding:20px; text-align:center;">Loading lifecycle history...</p>';

    try {
        const candidate = await window.api.getCandidate(id);
        if (title) title.textContent = `${candidate.name || 'Candidate'} — Recruitment Progression`;

        const history = Array.isArray(candidate.status_history) && candidate.status_history.length > 0
            ? [...candidate.status_history].reverse()
            : [
                {
                    status: candidate.status || 'applied',
                    previous_status: null,
                    updated_by: 'System',
                    timestamp: candidate.created_at,
                    remarks: 'Candidate profile registered in pipeline.'
                }
            ];

        body.innerHTML = `
            <div class="status-timeline">
                ${history.map((item, index) => {
                    const rawStatus = (item.status || item.new_status || 'applied').replace('_', ' ').toUpperCase();
                    const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Recent';
                    const updater = item.updated_by || 'Recruiter';
                    const remarks = item.remarks || 'Status progressed.';
                    const isLatest = index === 0;

                    return `
                        <div class="timeline-entry ${isLatest ? 'latest' : ''}">
                            <div class="timeline-entry-dot">${isLatest ? '★' : '•'}</div>
                            <div class="timeline-entry-header">
                                <span class="timeline-entry-status">${escapeHtml(rawStatus)}</span>
                                <span class="timeline-entry-date">${escapeHtml(dateStr)}</span>
                            </div>
                            <div class="timeline-entry-author">Updated by: <strong>${escapeHtml(updater)}</strong></div>
                            <div class="timeline-entry-remarks">${escapeHtml(remarks)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } catch (err) {
        body.innerHTML = `<p style="color:var(--status-red); padding:20px; text-align:center;">Failed to load history: ${escapeHtml(err.message)}</p>`;
    }
}
window.openStatusHistoryModal = openStatusHistoryModal;

function closeStatusHistoryModal() {
    const modal = document.getElementById('statusHistoryModal');
    if (modal) modal.classList.remove('active');
}
window.closeStatusHistoryModal = closeStatusHistoryModal;

/* ==========================================================================
   Recruiter Management (Admin Only)
   ========================================================================== */
let recruitersCache = [];

async function loadRecruiters() {
    const tbody = document.getElementById('recruitersTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#718096; padding:24px;">Loading recruiters...</td></tr>';

    try {
        const recruiters = await window.api.getRecruiters();
        recruitersCache = recruiters || [];
        renderRecruitersTable(recruitersCache);
    } catch (err) {
        console.error('Error fetching recruiters:', err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#e53e3e; padding:24px;">Failed to load recruiters: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderRecruitersTable(recruiters) {
    const tbody = document.getElementById('recruitersTableBody');
    if (!tbody) return;

    if (!Array.isArray(recruiters) || recruiters.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#718096; padding:32px;">No recruiters provisioned yet. Add an account above!</td></tr>';
        return;
    }

    tbody.innerHTML = recruiters.map((rec) => {
        const id = rec.id || rec._id || '';
        const username = rec.username || 'Recruiter';
        const role = (rec.role || 'recruiter').toUpperCase();
        const dateStr = rec.created_at ? new Date(rec.created_at).toLocaleDateString() : 'Active';

        return `
            <tr>
                <td><strong style="color:var(--dark-navy);">#${escapeHtml(id)}</strong></td>
                <td><strong style="color:var(--primary-blue);">${escapeHtml(username)}</strong></td>
                <td><span class="badge badge-shortlisted">${escapeHtml(role)}</span></td>
                <td><span class="badge badge-hired">ACTIVE</span></td>
                <td style="text-align:right;">
                    <button type="button" class="button btn-danger btn-sm" onclick="deleteRecruiterPrompt('${escapeHtml(id)}', '${escapeHtml(username)}')">Revoke Access</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function deleteRecruiterPrompt(id, username) {
    if (!confirm(`Are you sure you want to revoke recruiter access for "${username}"?`)) {
        return;
    }

    try {
        await window.api.deleteUser(id);
        showAlert(`Recruiter "${username}" access revoked.`, 'success');
        loadRecruiters();
    } catch (err) {
        showAlert(err.message || 'Failed to revoke recruiter access.', 'error');
    }
}
window.deleteRecruiterPrompt = deleteRecruiterPrompt;

function setupRecruiterEvents() {
    const form = document.getElementById('createRecruiterForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const usernameInput = document.getElementById('recruiterUsername');
            const passwordInput = document.getElementById('recruiterPassword');
            const btn = document.getElementById('btnCreateRecruiter');

            const username = usernameInput ? usernameInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';

            if (!username || !password) {
                showAlert('Please provide both username and password.', 'error');
                return;
            }

            if (password.length < 6) {
                showAlert('Password must be at least 6 characters.', 'error');
                return;
            }

            if (btn) btn.disabled = true;

            try {
                await window.api.createRecruiter({ username, password });
                showAlert(`Recruiter account "${username}" provisioned successfully!`, 'success');
                form.reset();
                loadRecruiters();
            } catch (err) {
                showAlert(err.message || 'Failed to create recruiter account.', 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }


}

/* ==========================================================================
   Report Export System (CSV Download & Printable Summary)
   ========================================================================== */
function setupExportReportEvents() {
    const exportBtn = document.getElementById('btnExportReport');
    if (exportBtn) {
        exportBtn.addEventListener('click', openExportModal);
    }

    const dateRangeSelect = document.getElementById('exportDateRange');
    const statusSelect = document.getElementById('exportStatusFilter');
    if (dateRangeSelect) dateRangeSelect.addEventListener('change', updateExportPreview);
    if (statusSelect) statusSelect.addEventListener('change', updateExportPreview);

    const btnCsv = document.getElementById('btnExportCsv');
    if (btnCsv) btnCsv.addEventListener('click', handleExportCsv);

    const btnPrint = document.getElementById('btnExportPrint');
    if (btnPrint) btnPrint.addEventListener('click', handleExportPrint);
}

function openExportModal() {
    const modal = document.getElementById('exportReportModal');
    if (modal) modal.classList.add('active');
    updateExportPreview();
}
window.openExportModal = openExportModal;

function closeExportModal() {
    const modal = document.getElementById('exportReportModal');
    if (modal) modal.classList.remove('active');
}
window.closeExportModal = closeExportModal;

async function updateExportPreview() {
    const previewArea = document.getElementById('exportPreviewArea');
    if (!previewArea) return;

    const dateRange = document.getElementById('exportDateRange')?.value || '30';
    const status = document.getElementById('exportStatusFilter')?.value || 'all';

    previewArea.innerHTML = 'Querying recruitment pipeline records...';

    try {
        const data = await window.api.getExportData(dateRange, status);
        const count = data.records?.length || 0;
        const summary = data.summary || {};

        previewArea.innerHTML = `
            <strong>${count} Records Matching Criteria</strong><br/>
            <span style="color:var(--secondary-text);">Applied: ${summary.applied || 0} &bull; Scheduled: ${summary.scheduled || 0} &bull; Interviewed: ${summary.interviewed || 0} &bull; Selected: ${summary.selected || 0} &bull; Rejected: ${summary.rejected || 0}</span>
        `;
    } catch (err) {
        previewArea.innerHTML = `<span style="color:var(--status-red);">Failed to preview export: ${escapeHtml(err.message)}</span>`;
    }
}

async function handleExportCsv() {
    const btn = document.getElementById('btnExportCsv');
    if (btn) btn.disabled = true;

    try {
        const dateRange = document.getElementById('exportDateRange')?.value || '30';
        const status = document.getElementById('exportStatusFilter')?.value || 'all';

        const data = await window.api.getExportData(dateRange, status);
        const rows = data.records || [];

        if (rows.length === 0) {
            showAlert('No records match the selected export filters.', 'warning');
            return;
        }

        const headers = [
            'Candidate ID',
            'Name',
            'Email',
            'Phone',
            'Status',
            'Interviews Total',
            'Interviews Completed',
            'Technical Score',
            'Communication Score',
            'Problem Solving Score',
            'Overall Score',
            'Recommendation',
            'Created Date'
        ];

        const csvLines = [headers.join(',')];

        rows.forEach((r) => {
            const rowValues = [
                `"${r.candidate_id || ''}"`,
                `"${(r.name || '').replace(/"/g, '""')}"`,
                `"${(r.email || '').replace(/"/g, '""')}"`,
                `"${(r.phone || '').replace(/"/g, '""')}"`,
                `"${r.status || ''}"`,
                r.interviews_total || 0,
                r.interviews_completed || 0,
                r.technical_score,
                r.communication_score,
                r.problem_solving_score,
                r.overall_score,
                `"${(r.recommendation || '').replace(/"/g, '""')}"`,
                `"${r.created_date || ''}"`
            ];
            csvLines.push(rowValues.join(','));
        });

        const csvContent = csvLines.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `recruitment_report_${dateStr}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showAlert(`Exported ${rows.length} recruitment records to CSV!`, 'success');
        closeExportModal();
    } catch (err) {
        showAlert(err.message || 'CSV Export failed.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleExportPrint() {
    const btn = document.getElementById('btnExportPrint');
    if (btn) btn.disabled = true;

    try {
        const dateRange = document.getElementById('exportDateRange')?.value || '30';
        const status = document.getElementById('exportStatusFilter')?.value || 'all';

        const data = await window.api.getExportData(dateRange, status);
        const rows = data.records || [];

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            showAlert('Pop-up blocked. Please allow pop-ups for printable report.', 'error');
            return;
        }

        const dateStr = new Date().toLocaleDateString();
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Recruitment Operations Report — ${dateStr}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #172B45; }
                    h1 { margin-bottom: 4px; font-size: 1.5rem; }
                    .meta { color: #718096; margin-bottom: 20px; font-size: 0.9rem; }
                    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 0.85rem; }
                    th, td { border: 1px solid #E2E8F0; padding: 8px 10px; text-align: left; }
                    th { background-color: #F8FAFC; font-weight: 600; }
                    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; }
                </style>
            </head>
            <body>
                <h1>AI Interview Management System — Recruitment Report</h1>
                <div class="meta">Generated: ${dateStr} &bull; Total Candidates: ${rows.length}</div>
                <table>
                    <thead>
                        <tr>
                            <th>Candidate</th>
                            <th>Contact</th>
                            <th>Status</th>
                            <th>Interviews</th>
                            <th>Tech</th>
                            <th>Comm</th>
                            <th>Problem</th>
                            <th>Overall</th>
                            <th>Recommendation</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td><strong>${r.name}</strong></td>
                                <td>${r.email}<br/>${r.phone || '—'}</td>
                                <td>${r.status}</td>
                                <td>${r.interviews_completed}/${r.interviews_total}</td>
                                <td>${r.technical_score}</td>
                                <td>${r.communication_score}</td>
                                <td>${r.problem_solving_score}</td>
                                <td><strong>${r.overall_score}</strong></td>
                                <td>${r.recommendation}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <script>
                    window.onload = function() { window.print(); }
                </script>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        closeExportModal();
    } catch (err) {
        showAlert(err.message || 'Print generation failed.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/* ==========================================================================
   Centralized Notification Center
   ========================================================================== */
function setupNotificationEvents() {
    const bellBtn = document.getElementById('notificationsBellBtn');
    const dropdown = document.getElementById('notificationsDropdown');
    const markAllBtn = document.getElementById('markAllReadBtn');

    if (bellBtn && dropdown) {
        bellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;
            if (isHidden) {
                dropdown.style.display = 'block';
                loadNotifications();
            } else {
                dropdown.style.display = 'none';
            }
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    if (markAllBtn) {
        markAllBtn.addEventListener('click', handleMarkAllNotificationsRead);
    }
}

async function loadNotifications() {
    if (!window.api || !window.api.isAuthenticated()) return;

    const listEl = document.getElementById('notificationsList');
    const badge = document.getElementById('notificationsBadge');

    try {
        const res = await window.api.getNotifications();
        const notifications = res.notifications || [];
        const unreadCount = res.unread_count || 0;

        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        renderNotificationsList(notifications);
    } catch (err) {
        console.warn('Notifications load error:', err);
        if (listEl && listEl.innerHTML.trim() === '') {
            listEl.innerHTML = '<div class="empty-notif" style="color:var(--status-red);">Unable to load notifications. Please check connection.</div>';
        }
    }
}

function renderNotificationsList(notifications) {
    const listEl = document.getElementById('notificationsList');
    if (!listEl) return;

    if (!Array.isArray(notifications) || notifications.length === 0) {
        listEl.innerHTML = '<div class="empty-notif">No new notifications</div>';
        return;
    }

    const iconMap = {
        status_change: '🔄',
        interview: '📅',
        feedback: '⭐',
        hiring_decision: '🏆',
        candidate_registered: '👤',
        account_created: '🔑',
        report: '📄',
        general: '🔔'
    };

    listEl.innerHTML = notifications.slice(0, 15).map((n) => {
        const icon = iconMap[n.notification_type] || '🔔';
        const isUnread = !n.is_read;
        const timeStr = n.created_at ? formatTimeAgo(new Date(n.created_at)) : 'Just now';
        const linkSec = n.link_section || '';

        return `
            <div class="notification-item ${isUnread ? 'unread' : ''}" onclick="handleNotificationClick('${n.id}', '${linkSec}')">
                <span class="notif-icon">${icon}</span>
                <div class="notif-body">
                    <div class="notif-title">${escapeHtml(n.title)}</div>
                    <div class="notif-msg">${escapeHtml(n.message)}</div>
                    <div class="notif-time">${escapeHtml(timeStr)}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function handleNotificationClick(id, linkSection) {
    try {
        await window.api.markNotificationRead(id);
        loadNotifications();
        const dropdown = document.getElementById('notificationsDropdown');
        if (dropdown) dropdown.style.display = 'none';
        if (linkSection) {
            navigateTo(linkSection);
        }
    } catch (ignore) {}
}
window.handleNotificationClick = handleNotificationClick;

async function handleMarkAllNotificationsRead() {
    try {
        await window.api.markAllNotificationsRead();
        loadNotifications();
    } catch (err) {
        console.warn('Mark all read error:', err);
    }
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
