import { auth, db } from './firebase.js';
import {
  collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, addDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast, renderHome } from './ui.js';
import { state } from './config.js';
import { FeatureFlags } from './featureFlags.js';
import { listConversionJobRecords } from './conversionJobStore.js';

let _view = null;
let _isAdmin = false;

// ─── Admin identity check ──────────────────────────────────────────────────

async function _checkAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export const Admin = {
  async init() {
    _view = document.getElementById('adminView');
    if (!_view) return;

    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        Admin.show();
      }
    });

    document.getElementById('adminBackBtn')?.addEventListener('click', Admin.hide);
    _bindTabs();
    _bindUsers();
    _bindFeedback();
    _bindFlags();
    _bindIncidents();
    _bindWaitlist();
    _bindAnnouncements();
  },

  async show() {
    const uid = auth.currentUser?.uid;
    _isAdmin = await _checkAdmin(uid);
    if (!_isAdmin) {
      showToast('Admin access required', 'error');
      return false;
    }
    document.querySelectorAll('.app-shell > section').forEach(el => { el.hidden = true; });
    _view.hidden = false;
    if (window.location.pathname !== '/admin') {
      window.history.replaceState({}, '', '/admin');
    }
    _activateTab('overview');
    return true;
  },

  hide() {
    document.querySelectorAll('.app-shell > section').forEach(el => { el.hidden = true; });
    if (_view) _view.hidden = true;
    if (window.location.pathname === '/admin') {
      window.history.replaceState({}, '', '/');
    }
    const home = document.getElementById('homeView');
    if (home) home.hidden = false;
    renderHome();
  },

  async maybeRevealButton() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const isAdm = await _checkAdmin(uid);
    document.querySelectorAll('.open-admin-btn').forEach(btn => {
      btn.hidden = !isAdm;
    });
  }
};

// ─── Tabs ─────────────────────────────────────────────────────────────────

function _bindTabs() {
  _view.querySelectorAll('[data-admin-tab]').forEach(tab => {
    tab.addEventListener('click', () => _activateTab(tab.dataset.adminTab));
  });
}

function _activateTab(name) {
  _view.querySelectorAll('[data-admin-tab]').forEach(t =>
    t.classList.toggle('is-active', t.dataset.adminTab === name));
  _view.querySelectorAll('[data-admin-section]').forEach(s =>
    s.classList.toggle('is-active', s.dataset.adminSection === name));

  const loaders = {
    overview: _loadOverview,
    analytics: _loadAnalytics,
    support: _loadSupportSnapshot,
    users: _loadUsers,
    feedback: _loadFeedback,
    flags: _loadFlags,
    incidents: _loadIncidents,
    waitlist: _loadWaitlist,
    announcements: _loadAnnouncements
  };
  loaders[name]?.();
}

// ─── Overview ────────────────────────────────────────────────────────────

async function _loadOverview() {
  const panel = document.getElementById('adminOverviewPanel');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-loading">Loading…</p>';
  try {
    const [sigSnap, fbSnap, auSnap, incSnap, waitSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, 'adminSignups')),
      getDocs(collection(db, 'adminFeedback')),
      getDocs(collection(db, 'adminActiveUsers')),
      getDocs(collection(db, 'incidents')),
      getDocs(collection(db, 'waitlist')),
      getDocs(collection(db, 'usersByEmail'))
    ]);
    const signups = sigSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const feedback = fbSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const activeUsers = auSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const incidents = incSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const waitlist = waitSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const openIncidents = incidents.filter((item) => _normalizeStatus(item.status) !== 'resolved');
    const criticalIncidents = openIncidents.filter((item) => _normalizeSeverity(item.severity) === 'critical');
    const recentSignups = signups.filter((item) => _isWithinDays(item.createdAt, 7));
    const recentActivity = [
      ...signups.map((item) => ({
        type: 'Signup',
        title: item.name || item.email || item.id,
        body: item.source ? `Source: ${item.source}` : 'New account event',
        time: item.createdAt,
        tone: 'ok'
      })),
      ...feedback.map((item) => ({
        type: 'Feedback',
        title: item.subject || item.type || 'Feedback item',
        body: item.body || 'User feedback captured',
        time: item.timestamp,
        tone: 'info'
      })),
      ...incidents.map((item) => ({
        type: 'Incident',
        title: item.title || 'Incident',
        body: item.body || 'Incident record updated',
        time: item.updatedAt || item.createdAt,
        tone: _normalizeStatus(item.status) === 'resolved' ? 'ok' : 'warning'
      }))
    ]
      .filter((item) => item.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 6);
    const healthRows = [
      { label: 'Firebase Auth', status: auth.currentUser?.email ? 'Connected' : 'Signed in', tone: 'ok', detail: auth.currentUser?.email || 'Session available' },
      { label: 'Firestore', status: 'Live', tone: 'ok', detail: 'Admin collections loaded successfully' },
      { label: 'User Registry', status: `${users.length} records`, tone: users.length ? 'ok' : 'warning', detail: 'Registered accounts mirrored by email' },
      { label: 'Waitlist', status: `${waitlist.length} entries`, tone: waitlist.length ? 'ok' : 'warning', detail: 'Early access pipeline' },
      { label: 'Incidents', status: openIncidents.length ? `${openIncidents.length} open` : 'Clear', tone: openIncidents.length ? 'warning' : 'ok', detail: criticalIncidents.length ? `${criticalIncidents.length} critical` : 'No critical incidents' }
    ];
    const healthTone = criticalIncidents.length ? 'danger' : (openIncidents.length ? 'warning' : 'ok');
    panel.innerHTML = `
      <div class="admin-ops-header">
        <div>
          <p class="admin-kicker">Level 1 operations view</p>
          <h3>Health, growth, and user activity in one place.</h3>
        </div>
        <span class="admin-live-pill">Live snapshot</span>
      </div>
      <div class="admin-stats-grid admin-ops-stats">
        ${_statCard('Registered Users', users.length)}
        ${_statCard('Active Users', activeUsers.length)}
        ${_statCard('New Users (7d)', recentSignups.length)}
        ${_statCard('Feedback Items', feedback.length)}
        ${_statCard('Waitlist Signups', waitlist.length)}
        ${_statCard('Open Incidents', openIncidents.length)}
      </div>
      <div class="admin-overview-grid">
        <section class="admin-overview-card">
          <div class="admin-card-head">
            <div>
              <h3>System health</h3>
              <p class="admin-card-subtitle">The admin view should tell you immediately if anything needs attention.</p>
            </div>
            <span class="admin-badge ${healthTone === 'danger' ? 'admin-badge-danger' : healthTone === 'warning' ? 'admin-badge-sev-medium' : 'admin-badge-ok'}">
              ${criticalIncidents.length ? 'Attention needed' : openIncidents.length ? 'Watchlist' : 'Healthy'}
            </span>
          </div>
          <div class="admin-health-grid">
            ${healthRows.map((row) => `
              <article class="admin-health-item admin-health-${row.tone}">
                <span class="admin-health-label">${_esc(row.label)}</span>
                <strong>${_esc(row.status)}</strong>
                <p>${_esc(row.detail)}</p>
              </article>
            `).join('')}
          </div>
        </section>
        <section class="admin-overview-card">
          <div class="admin-card-head">
            <div>
              <h3>Recent activity</h3>
              <p class="admin-card-subtitle">Latest signals from signups, feedback, and incidents.</p>
            </div>
            <span class="admin-muted">${recentActivity.length} items</span>
          </div>
          <div class="admin-activity-list">
            ${recentActivity.length ? recentActivity.map((item) => `
              <div class="admin-activity-row">
                <span class="admin-badge ${item.tone === 'warning' ? 'admin-badge-sev-medium' : item.tone === 'ok' ? 'admin-badge-ok' : 'admin-badge-type'}">${_esc(item.type)}</span>
                <div class="admin-activity-copy">
                  <strong>${_esc(item.title)}</strong>
                  <p>${_esc(item.body)}</p>
                </div>
                <small>${_formatTime(item.time)}</small>
              </div>
            `).join('') : '<p class="admin-loading">No recent activity yet.</p>'}
          </div>
        </section>
      </div>
      <section class="admin-overview-card">
        <div class="admin-card-head">
          <div>
            <h3>User registry preview</h3>
            <p class="admin-card-subtitle">A quick look at the accounts currently mirrored in the app.</p>
          </div>
          <span class="admin-muted">${users.length} tracked</span>
        </div>
        <div class="admin-table-shell">
          <table class="admin-simple-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email key</th>
                <th>UID</th>
              </tr>
            </thead>
            <tbody>
              ${users.slice(0, 8).map((user) => `
                <tr>
                  <td>${_esc(user.name || user.displayName || '—')}</td>
                  <td>${_esc(user.id)}</td>
                  <td><code>${_esc(user.uid || '—')}</code></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  } catch (err) {
    panel.innerHTML = `<p class="admin-error">Failed to load: ${err.message}</p>`;
  }
}

function _statCard(label, value) {
  return `<div class="admin-stat-card"><span class="admin-stat-value">${value}</span><span class="admin-stat-label">${label}</span></div>`;
}

function _parseTime(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function _formatTime(value) {
  const ms = _parseTime(value);
  if (!ms) return 'Just now';
  const diff = Date.now() - ms;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString();
}

function _isWithinDays(value, days) {
  const ms = _parseTime(value);
  if (!ms) return false;
  return (Date.now() - ms) <= (days * 24 * 60 * 60 * 1000);
}

function _normalizeStatus(value) {
  return String(value || 'open').trim().toLowerCase();
}

function _normalizeSeverity(value) {
  return String(value || 'low').trim().toLowerCase();
}

async function _loadAnalytics() {
  const panel = document.getElementById('adminAnalyticsPanel');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-loading">Loading...</p>';

  try {
    const [jobs, projectTasks] = await Promise.all([
      _loadConversionJobs(),
      Promise.resolve(_collectSystemTasks())
    ]);
    const groupedByStatus = {
      queued: jobs.filter((job) => _normalizeStatus(job.status) === 'queued').length,
      running: jobs.filter((job) => _normalizeStatus(job.status) === 'running').length,
      success: jobs.filter((job) => ['completed', 'imported', 'imported-with-fallback'].includes(_normalizeStatus(job.status))).length,
      failed: jobs.filter((job) => _normalizeStatus(job.status) === 'failed').length
    };
    const fallbackCount = jobs.filter((job) => _normalizeStatus(job.status) === 'imported-with-fallback').length;
    const typeBuckets = _bucketJobsByType(jobs);
    const latestFailures = jobs
      .filter((job) => _normalizeStatus(job.status) === 'failed')
      .slice(0, 5);
    const latestJobs = jobs.slice(0, 6);
    const aiTaskSummary = _summarizeSystemTasks(projectTasks);
    const maxBucket = Math.max(...Object.values(typeBuckets).map((count) => count || 0), 1);

    panel.innerHTML = `
      <div class="admin-analytics-grid">
        <section class="admin-overview-card">
          <div class="admin-card-head">
            <div>
              <h3>Conversion pipeline</h3>
              <p class="admin-card-subtitle">Cross-user conversion jobs, with local fallback if the global query is restricted.</p>
            </div>
            <span class="admin-muted">${jobs.length} jobs</span>
          </div>
          <div class="admin-stats-grid admin-analytics-stats">
            ${_statCard('Queued', groupedByStatus.queued)}
            ${_statCard('Running', groupedByStatus.running)}
            ${_statCard('Succeeded', groupedByStatus.success)}
            ${_statCard('Failed', groupedByStatus.failed)}
          </div>
          <div class="admin-failure-note">
            <strong>Fallback imports:</strong> ${fallbackCount}
          </div>
          <div class="admin-bar-chart" aria-label="Conversion job types">
            ${Object.entries(typeBuckets).map(([label, count]) => `
              <div class="admin-bar-row">
                <span>${_esc(label)}</span>
                <div class="admin-bar-track"><div class="admin-bar-fill" style="width:${Math.max(8, Math.round((count / maxBucket) * 100))}%"></div></div>
                <strong>${count}</strong>
              </div>
            `).join('')}
          </div>
        </section>

        <section class="admin-overview-card">
          <div class="admin-card-head">
            <div>
              <h3>AI workload</h3>
              <p class="admin-card-subtitle">System-generated workspace task activity in the current session.</p>
            </div>
            <span class="admin-muted">${aiTaskSummary.total} tasks</span>
          </div>
          <div class="admin-stats-grid admin-analytics-stats">
            ${_statCard('Review', aiTaskSummary.review)}
            ${_statCard('Retry', aiTaskSummary.failed)}
            ${_statCard('Scheduled', aiTaskSummary.scheduled)}
            ${_statCard('Applied', aiTaskSummary.applied)}
          </div>
          <div class="admin-health-grid">
            <article class="admin-health-item admin-health-ok">
              <span class="admin-health-label">AI success ratio</span>
              <strong>${aiTaskSummary.total ? Math.round((aiTaskSummary.applied / aiTaskSummary.total) * 100) : 0}%</strong>
              <p>Applied tasks versus total AI tasks in memory.</p>
            </article>
            <article class="admin-health-item admin-health-warning">
              <span class="admin-health-label">Attention queue</span>
              <strong>${aiTaskSummary.review + aiTaskSummary.failed}</strong>
              <p>Tasks still waiting on review or retry.</p>
            </article>
          </div>
          <div class="admin-activity-list admin-analytics-activity">
            ${latestJobs.length ? latestJobs.map((job) => `
              <div class="admin-activity-row">
                <span class="admin-badge ${_jobBadgeClass(job.status)}">${_esc(job.status || 'queued')}</span>
                <div class="admin-activity-copy">
                  <strong>${_esc(job.fileName || 'Untitled conversion')}</strong>
                  <p>${_esc(job.stageLabel || 'No stage available')} • ${_esc(job.projectId || 'No project')}</p>
                </div>
                <small>${_formatTime(job.updatedAt || job.createdAt)}</small>
              </div>
            `).join('') : '<p class="admin-loading">No conversion jobs available.</p>'}
          </div>
        </section>
      </div>

      <section class="admin-overview-card">
        <div class="admin-card-head">
          <div>
            <h3>Recent failures</h3>
            <p class="admin-card-subtitle">These should surface immediately so you can see broken conversion flows.</p>
          </div>
          <span class="admin-muted">${latestFailures.length} failures</span>
        </div>
        <div class="admin-table-shell">
          <table class="admin-simple-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Reason</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              ${latestFailures.length ? latestFailures.map((job) => `
                <tr>
                  <td>${_esc(job.fileName || 'Untitled file')}</td>
                  <td>${_esc((job.warnings && job.warnings[0]) || job.stageLabel || 'Conversion failed')}</td>
                  <td>${_formatTime(job.updatedAt || job.createdAt)}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="3">No failed conversions yet.</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    `;
  } catch (err) {
    panel.innerHTML = `<p class="admin-error">Failed to load: ${err.message}</p>`;
  }
}

async function _loadSupportSnapshot() {
  const panel = document.getElementById('adminSupportPanel');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-loading">Loading...</p>';

  try {
    const [feedbackSnap, incidentsSnap, profileSnap, waitlistSnap] = await Promise.all([
      getDocs(query(collection(db, 'adminFeedback'), orderBy('timestamp', 'desc'), limit(100))),
      getDocs(query(collection(db, 'incidents'), orderBy('createdAt', 'desc'), limit(50))),
      getDocs(query(collectionGroup(db, 'profile'))),
      getDocs(query(collection(db, 'waitlist'), orderBy('createdAt', 'desc'), limit(500)))
    ]);

    const feedback = feedbackSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const incidents = incidentsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const profiles = profileSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const waitlist = waitlistSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const tickets = [
      ...feedback.map((item) => ({
        id: item.id,
        title: item.subject || item.type || 'Support request',
        reason: item.body || 'User feedback captured',
        priority: _ticketPriorityFromType(item.type || ''),
        source: 'Feedback',
        createdAt: item.timestamp
      })),
      ...incidents.map((item) => ({
        id: item.id,
        title: item.title || 'Incident',
        reason: item.body || 'Operational incident',
        priority: _ticketPriorityFromSeverity(item.severity),
        source: 'Incident',
        createdAt: item.createdAt
      }))
    ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const planSummary = _summarizePlans(profiles);
    const supportCounts = {
      open: tickets.filter((item) => item.priority === 'critical' || item.priority === 'high').length,
      medium: tickets.filter((item) => item.priority === 'medium').length,
      low: tickets.filter((item) => item.priority === 'low').length
    };
    const latestResolved = incidents.filter((item) => _normalizeStatus(item.status) === 'resolved').slice(0, 5);
    const founderSnapshot = {
      newUsers: waitlist.filter((item) => _isWithinDays(item.createdAt, 7)).length,
      activeUsers: profiles.filter((item) => _isWithinDays(item.updatedAt || item.createdAt, 7)).length,
      proUsers: planSummary.pro,
      freeUsers: planSummary.free,
      enterpriseUsers: planSummary.enterprise,
      openTickets: supportCounts.open + supportCounts.medium,
      failures: incidents.filter((item) => _normalizeStatus(item.status) !== 'resolved').length
    };

    panel.innerHTML = `
      <div class="admin-overview-grid">
        <section class="admin-overview-card">
          <div class="admin-card-head">
            <div>
              <h3>Support center</h3>
              <p class="admin-card-subtitle">Use existing feedback and incident records as the current support queue.</p>
            </div>
            <span class="admin-muted">${tickets.length} tickets</span>
          </div>
          <div class="admin-stats-grid admin-analytics-stats">
            ${_statCard('Critical', supportCounts.open)}
            ${_statCard('Medium', supportCounts.medium)}
            ${_statCard('Low', supportCounts.low)}
            ${_statCard('Resolved', latestResolved.length)}
          </div>
          <div class="admin-table-shell">
            <table class="admin-simple-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Priority</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                ${tickets.slice(0, 8).map((ticket) => `
                  <tr>
                    <td>${_esc(ticket.title)}</td>
                    <td><span class="admin-badge ${_ticketBadgeClass(ticket.priority)}">${_esc(ticket.priority)}</span></td>
                    <td>${_esc(ticket.source)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <section class="admin-overview-card">
          <div class="admin-card-head">
            <div>
              <h3>Subscription snapshot</h3>
              <p class="admin-card-subtitle">Plan counts are inferred from profile records when plan data is present.</p>
            </div>
            <span class="admin-muted">${profiles.length} profiles</span>
          </div>
          <div class="admin-stats-grid admin-analytics-stats">
            ${_statCard('Free', planSummary.free)}
            ${_statCard('Pro', planSummary.pro)}
            ${_statCard('Enterprise', planSummary.enterprise)}
            ${_statCard('Unspecified', planSummary.unspecified)}
          </div>
          <div class="admin-health-grid">
            <article class="admin-health-item admin-health-ok">
              <span class="admin-health-label">Billing connector</span>
              <strong>Not wired</strong>
              <p>Subscription rows are ready to connect when payment data exists.</p>
            </article>
            <article class="admin-health-item admin-health-warning">
              <span class="admin-health-label">Renewals</span>
              <strong>Manual review</strong>
              <p>No automated payment renewal feed is connected yet.</p>
            </article>
          </div>
        </section>
      </div>

      <section class="admin-overview-card">
        <div class="admin-card-head">
          <div>
            <h3>Founder command center</h3>
            <p class="admin-card-subtitle">A fast snapshot for the owner without any extra navigation.</p>
          </div>
          <span class="admin-live-pill">Today</span>
        </div>
        <div class="admin-stats-grid admin-ops-stats">
          ${_statCard('New Users', founderSnapshot.newUsers)}
          ${_statCard('Active Users', founderSnapshot.activeUsers)}
          ${_statCard('Pro Users', founderSnapshot.proUsers)}
          ${_statCard('Open Tickets', founderSnapshot.openTickets)}
          ${_statCard('Failures', founderSnapshot.failures)}
          ${_statCard('Enterprise', founderSnapshot.enterpriseUsers)}
        </div>
      </section>
    `;
  } catch (err) {
    panel.innerHTML = `<p class="admin-error">Failed to load: ${err.message}</p>`;
  }
}

async function _loadConversionJobs() {
  try {
    const snap = await getDocs(query(collectionGroup(db, 'conversionJobs'), orderBy('updatedAt', 'desc'), limit(120)));
    const jobs = snap.docs.map((entry) => entry.data()).filter((job) => job?.id);
    if (jobs.length) return jobs;
  } catch (error) {
    console.warn('Admin conversion job aggregate failed; falling back to current session jobs.', error);
  }

  try {
    const localJobs = await listConversionJobRecords();
    return Array.isArray(localJobs) ? localJobs : [];
  } catch {
    return [];
  }
}

function _collectSystemTasks() {
  const tasks = (state.projects || []).flatMap((project) => Array.isArray(project?.workspace?.tasks) ? project.workspace.tasks : []);
  return tasks.filter((task) => task?.assigneeType === 'system');
}

function _summarizeSystemTasks(tasks) {
  const summary = {
    total: tasks.length,
    review: 0,
    failed: 0,
    scheduled: 0,
    applied: 0
  };
  tasks.forEach((task) => {
    const stateLabel = _normalizeStatus(task.aiState);
    if (stateLabel === 'review') summary.review += 1;
    else if (stateLabel === 'failed') summary.failed += 1;
    else if (stateLabel === 'scheduled' || stateLabel === 'ready' || stateLabel === 'running') summary.scheduled += 1;
    else if (stateLabel === 'applied' || stateLabel === 'dismissed') summary.applied += 1;
  });
  return summary;
}

function _bucketJobsByType(jobs) {
  const buckets = {
    "PDF -> Wraita": 0,
    "DOCX -> Wraita": 0,
    "Export PDF": 0,
    "Export DOCX": 0,
    "Other": 0
  };

  jobs.forEach((job) => {
    const name = String(job.fileName || job.sourceFile?.name || '').toLowerCase();
    const stage = String(job.stageLabel || '').toLowerCase();
    if (name.endsWith('.pdf') || stage.includes('pdf')) {
      buckets["PDF -> Wraita"] += 1;
    } else if (name.endsWith('.docx') || stage.includes('docx')) {
      buckets["DOCX -> Wraita"] += 1;
    } else if (stage.includes('export pdf')) {
      buckets["Export PDF"] += 1;
    } else if (stage.includes('export docx')) {
      buckets["Export DOCX"] += 1;
    } else {
      buckets["Other"] += 1;
    }
  });

  return buckets;
}

function _jobBadgeClass(status) {
  const normalized = _normalizeStatus(status);
  if (normalized === 'failed') return 'admin-badge-danger';
  if (normalized === 'running') return 'admin-badge-sev-medium';
  if (normalized === 'completed' || normalized === 'imported' || normalized === 'imported-with-fallback') return 'admin-badge-ok';
  return 'admin-badge-type';
}

function _ticketPriorityFromType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'bug') return 'high';
  if (normalized === 'question') return 'low';
  if (normalized === 'feature') return 'medium';
  return 'medium';
}

function _ticketPriorityFromSeverity(severity) {
  const normalized = _normalizeSeverity(severity);
  if (normalized === 'critical') return 'critical';
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  return 'low';
}

function _ticketBadgeClass(priority) {
  const normalized = String(priority || 'low').trim().toLowerCase();
  if (normalized === 'critical') return 'admin-badge-danger';
  if (normalized === 'high') return 'admin-badge-sev-high';
  if (normalized === 'medium') return 'admin-badge-sev-medium';
  return 'admin-badge-ok';
}

function _summarizePlans(profiles) {
  const summary = { free: 0, pro: 0, enterprise: 0, unspecified: 0 };
  profiles.forEach((profile) => {
    const plan = String(profile.plan || profile.subscriptionPlan || profile.billingPlan || '').trim().toLowerCase();
    if (plan === 'pro' || plan === 'premium') summary.pro += 1;
    else if (plan === 'enterprise') summary.enterprise += 1;
    else if (plan === 'free') summary.free += 1;
    else summary.unspecified += 1;
  });
  return summary;
}

// ─── Users ────────────────────────────────────────────────────────────────

function _bindUsers() {
  document.getElementById('adminUserSearchBtn')?.addEventListener('click', () => {
    const email = document.getElementById('adminUserSearch')?.value.trim().toLowerCase();
    if (email) _searchUser(email);
  });
  document.getElementById('adminUserSearch')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const email = e.target.value.trim().toLowerCase();
      if (email) _searchUser(email);
    }
  });
}

function _loadUsers() {
  const list = document.getElementById('adminUserList');
  if (list) list.innerHTML = '<p class="admin-loading">Enter an email to look up a user.</p>';
}

async function _searchUser(email) {
  const list = document.getElementById('adminUserList');
  if (!list) return;
  list.innerHTML = '<p class="admin-loading">Searching…</p>';
  try {
    const emailSnap = await getDoc(doc(db, 'usersByEmail', email));
    if (!emailSnap.exists()) {
      list.innerHTML = '<p class="admin-error">No user found with that email.</p>';
      return;
    }
    const { uid } = emailSnap.data();
    const [profileSnap, signupSnap, funnelSnap, errorsSnap] = await Promise.all([
      getDoc(doc(db, 'users', uid, 'profile', 'data')),
      getDoc(doc(db, 'adminSignups', uid)),
      getDoc(doc(db, 'users', uid, 'funnel', 'activation')),
      getDocs(query(collection(db, 'users', uid, 'errorLog'), orderBy('timestamp', 'desc'), limit(5)))
    ]);
    const profile = profileSnap.data() || {};
    const signup = signupSnap.data() || {};
    const funnel = funnelSnap.data() || {};
    const errors = errorsSnap.docs.map(d => d.data());
    const flagged = signup.flagged || false;
    const milestones = Object.keys(funnel).filter(k => !['lastMilestone', 'updatedAt'].includes(k));

    list.innerHTML = `
      <div class="admin-user-card">
        <div class="admin-user-header">
          <strong>${_esc(profile.displayName || '—')}</strong>
          <span class="admin-user-email">${_esc(email)}</span>
          <span class="admin-badge ${flagged ? 'admin-badge-danger' : 'admin-badge-ok'}">${flagged ? 'Flagged' : 'OK'}</span>
        </div>
        <div class="admin-user-meta">
          <span>UID: <code>${uid}</code></span>
          <span>Joined: ${signup.createdAt ? new Date(signup.createdAt).toLocaleDateString() : '—'}</span>
          <span>Logins: ${profile.loginCount || 0}</span>
          <span>Last active: ${profile.lastActiveAt ? new Date(profile.lastActiveAt).toLocaleDateString() : '—'}</span>
        </div>
        <div class="admin-user-funnel">
          <strong>Funnel milestones:</strong>
          <div class="admin-funnel-badges">
            ${milestones.length
              ? milestones.map(k => `<span class="admin-funnel-badge">${k}</span>`).join('')
              : '<em>none</em>'}
          </div>
        </div>
        ${errors.length ? `<div class="admin-user-errors">
          <strong>Recent errors:</strong>
          ${errors.map(e => `<div class="admin-error-row"><code>${_esc(e.context || '?')}</code> ${_esc((e.message || '').slice(0, 100))} <small>${e.timestamp ? new Date(e.timestamp).toLocaleString() : ''}</small></div>`).join('')}
        </div>` : ''}
        <div class="admin-user-actions">
          <button class="ghost-button btn-sm" id="adminFlagBtn">${flagged ? 'Unflag' : 'Flag'} User</button>
        </div>
      </div>`;

    list.querySelector('#adminFlagBtn')?.addEventListener('click', async () => {
      const nowFlagged = !flagged;
      try {
        await setDoc(doc(db, 'adminSignups', uid),
          { uid, flagged: nowFlagged, flaggedAt: new Date().toISOString() }, { merge: true });
        showToast(nowFlagged ? 'User flagged' : 'User unflagged');
        _searchUser(email);
      } catch (err) {
        showToast('Failed: ' + err.message, 'error');
      }
    });
  } catch (err) {
    list.innerHTML = `<p class="admin-error">Error: ${_esc(err.message)}</p>`;
  }
}

// ─── Feedback ────────────────────────────────────────────────────────────

function _bindFeedback() {
  document.getElementById('adminFeedbackFilter')?.addEventListener('change', _loadFeedback);
}

async function _loadFeedback() {
  const list = document.getElementById('adminFeedbackList');
  if (!list) return;
  list.innerHTML = '<p class="admin-loading">Loading…</p>';
  const filter = document.getElementById('adminFeedbackFilter')?.value || 'all';
  try {
    const snap = await getDocs(
      query(collection(db, 'adminFeedback'), orderBy('timestamp', 'desc'), limit(50))
    );
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (filter !== 'all') docs = docs.filter(d => d.type === filter);
    if (!docs.length) { list.innerHTML = '<p class="admin-loading">No feedback yet.</p>'; return; }
    list.innerHTML = docs.map(fb => `
      <div class="admin-feedback-item">
        <div class="admin-feedback-header">
          <span class="admin-badge admin-badge-type">${_esc(fb.type || '?')}</span>
          <strong>${_esc(fb.subject || '(no subject)')}</strong>
          <small>${fb.timestamp ? new Date(fb.timestamp).toLocaleString() : ''}</small>
          <button class="ghost-button btn-xs admin-fb-del" data-id="${fb.id}">Delete</button>
        </div>
        <p class="admin-feedback-body">${_esc(fb.body || '')}</p>
        ${fb.uid ? `<small>UID: ${fb.uid.slice(0, 8)}…</small>` : ''}
      </div>`).join('');
    list.querySelectorAll('.admin-fb-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await deleteDoc(doc(db, 'adminFeedback', btn.dataset.id));
          showToast('Feedback deleted');
          _loadFeedback();
        } catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="admin-error">Error: ${_esc(err.message)}</p>`;
  }
}

// ─── Feature Flags ────────────────────────────────────────────────────────

function _bindFlags() {
  document.getElementById('adminFlagSave')?.addEventListener('click', _saveFlags);
  document.getElementById('adminFlagAddBtn')?.addEventListener('click', () => {
    const nameEl = document.getElementById('adminFlagNewName');
    const name = nameEl?.value.trim();
    if (!name) { showToast('Enter a flag name', 'warning'); return; }
    _addFlagRow(name, false);
    if (nameEl) nameEl.value = '';
  });
}

async function _loadFlags() {
  const container = document.getElementById('adminFlagList');
  if (!container) return;
  container.innerHTML = '<p class="admin-loading">Loading…</p>';
  try {
    const snap = await getDoc(doc(db, 'config', 'featureFlags'));
    const flags = snap.exists() ? snap.data() : {};
    container.innerHTML = '';
    if (!Object.keys(flags).length) {
      container.innerHTML = '<p class="admin-loading">No flags defined yet.</p>';
    }
    Object.entries(flags).forEach(([name, val]) => _addFlagRow(name, Boolean(val)));
  } catch (err) {
    container.innerHTML = `<p class="admin-error">Error: ${_esc(err.message)}</p>`;
  }
}

function _addFlagRow(name, enabled) {
  const container = document.getElementById('adminFlagList');
  if (!container || container.querySelector(`[data-flag-name="${name}"]`)) return;
  const row = document.createElement('div');
  row.className = 'admin-flag-row';
  row.dataset.flagName = name;
  row.innerHTML = `
    <label class="admin-flag-label">
      <input type="checkbox" class="admin-flag-check" ${enabled ? 'checked' : ''}>
      <code>${_esc(name)}</code>
    </label>
    <button class="ghost-button btn-xs admin-flag-remove">Remove</button>`;
  row.querySelector('.admin-flag-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

async function _saveFlags() {
  const container = document.getElementById('adminFlagList');
  if (!container) return;
  const flags = {};
  container.querySelectorAll('.admin-flag-row').forEach(row => {
    flags[row.dataset.flagName] = row.querySelector('.admin-flag-check')?.checked || false;
  });
  try {
    await setDoc(doc(db, 'config', 'featureFlags'), flags);
    await FeatureFlags.refresh();
    showToast('Feature flags saved');
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

// ─── Incidents ────────────────────────────────────────────────────────────

function _bindIncidents() {
  document.getElementById('adminIncidentCreateBtn')?.addEventListener('click', _createIncident);
}

async function _loadIncidents() {
  const list = document.getElementById('adminIncidentList');
  if (!list) return;
  list.innerHTML = '<p class="admin-loading">Loading…</p>';
  try {
    const snap = await getDocs(
      query(collection(db, 'incidents'), orderBy('createdAt', 'desc'), limit(20))
    );
    if (!snap.size) { list.innerHTML = '<p class="admin-loading">No incidents.</p>'; return; }
    list.innerHTML = snap.docs.map(d => {
      const inc = { id: d.id, ...d.data() };
      const sev = _esc(inc.severity || 'low');
      const status = _esc(inc.status || 'open');
      return `<div class="admin-incident-item">
        <div class="admin-incident-header">
          <span class="admin-badge admin-badge-sev-${sev}">${sev}</span>
          <span class="admin-badge admin-badge-status-${status}">${status}</span>
          <strong>${_esc(inc.title || '')}</strong>
          <small>${inc.createdAt ? new Date(inc.createdAt).toLocaleString() : ''}</small>
        </div>
        ${inc.body ? `<p class="admin-incident-body">${_esc(inc.body)}</p>` : ''}
        <div class="admin-incident-actions">
          ${inc.status !== 'resolved' ? `<button class="ghost-button btn-sm" data-action="resolve" data-id="${inc.id}">Mark Resolved</button>` : ''}
          ${inc.status === 'open' ? `<button class="ghost-button btn-sm" data-action="investigating" data-id="${inc.id}">Investigating</button>` : ''}
          <button class="ghost-button btn-sm btn-danger" data-action="delete" data-id="${inc.id}">Delete</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => _incidentAction(btn.dataset.action, btn.dataset.id));
    });
  } catch (err) {
    list.innerHTML = `<p class="admin-error">Error: ${_esc(err.message)}</p>`;
  }
}

async function _createIncident() {
  const titleEl = document.getElementById('adminIncidentTitle');
  const bodyEl = document.getElementById('adminIncidentBody');
  const title = titleEl?.value.trim();
  const severity = document.getElementById('adminIncidentSeverity')?.value || 'low';
  const body = bodyEl?.value.trim() || '';
  if (!title) { showToast('Enter a title', 'warning'); return; }
  try {
    await addDoc(collection(db, 'incidents'), {
      title, severity, body,
      status: 'open',
      createdAt: new Date().toISOString(),
      createdBy: auth.currentUser?.uid || 'admin'
    });
    showToast('Incident created');
    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    _loadIncidents();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function _incidentAction(action, id) {
  try {
    if (action === 'delete') {
      await deleteDoc(doc(db, 'incidents', id));
      showToast('Incident deleted');
    } else {
      const status = action === 'resolve' ? 'resolved' : 'investigating';
      await updateDoc(doc(db, 'incidents', id), { status, updatedAt: new Date().toISOString() });
      showToast(`Status → ${status}`);
    }
    _loadIncidents();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

// ─── Waitlist ─────────────────────────────────────────────────────────────

function _bindWaitlist() {
  document.getElementById('adminWaitlistExport')?.addEventListener('click', _exportWaitlist);
}

async function _loadWaitlist() {
  const list = document.getElementById('adminWaitlistList');
  const count = document.getElementById('adminWaitlistCount');
  if (!list) return;
  list.innerHTML = '<p class="admin-loading">Loading…</p>';
  try {
    const snap = await getDocs(
      query(collection(db, 'waitlist'), orderBy('createdAt', 'desc'), limit(200))
    );
    if (count) count.textContent = snap.size;
    if (!snap.size) { list.innerHTML = '<p class="admin-loading">No waitlist entries yet.</p>'; return; }
    list.innerHTML = `<table class="admin-waitlist-table">
      <thead><tr><th>Email</th><th>Name</th><th>Source</th><th>Date</th></tr></thead>
      <tbody>${snap.docs.map(d => {
        const w = d.data();
        return `<tr>
          <td>${_esc(w.email || '')}</td>
          <td>${_esc(w.name || '—')}</td>
          <td>${_esc(w.source || '—')}</td>
          <td>${w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } catch (err) {
    list.innerHTML = `<p class="admin-error">Error: ${_esc(err.message)}</p>`;
  }
}

async function _exportWaitlist() {
  try {
    const snap = await getDocs(
      query(collection(db, 'waitlist'), orderBy('createdAt', 'desc'), limit(5000))
    );
    const rows = ['email,name,source,date'];
    snap.docs.forEach(d => {
      const w = d.data();
      rows.push(`"${(w.email||'').replace(/"/g,'""')}","${(w.name||'').replace(/"/g,'""')}","${w.source||''}","${w.createdAt||''}"`);
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'eyawriter-waitlist.csv'; a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
}

// ─── Announcements ───────────────────────────────────────────────────────

function _bindAnnouncements() {
  document.getElementById('adminAnnSave')?.addEventListener('click', _saveAnnouncement);
  document.getElementById('adminAnnDisable')?.addEventListener('click', async () => {
    try {
      await setDoc(doc(db, 'config', 'announcement'), { enabled: false }, { merge: true });
      // Hide the live banner immediately for this admin session
      const banner = document.getElementById('announcementBanner');
      if (banner) banner.hidden = true;
      showToast('Announcement banner disabled');
      _loadAnnouncements();
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    }
  });
}

async function _loadAnnouncements() {
  const statusEl = document.getElementById('adminAnnouncementStatus');
  if (!statusEl) return;

  try {
    const snap = await getDoc(doc(db, 'config', 'announcement'));
    const ann = snap.exists() ? snap.data() : null;

    if (ann) {
      statusEl.innerHTML = `
        <div class="admin-ann-current">
          <strong>Current:</strong>
          <span class="admin-badge ${ann.enabled ? 'admin-badge-ok' : 'admin-badge-danger'}">${ann.enabled ? 'Active' : 'Disabled'}</span>
          <span class="admin-badge admin-badge-type">${_esc(ann.type || 'info')}</span>
          <p class="admin-ann-preview">${_esc(ann.message || '(no message)')}</p>
          <small>Dismiss key: <code>${_esc(ann.dismissKey || 'default')}</code></small>
        </div>`;

      // Pre-fill the form with the current announcement
      const msgEl = document.getElementById('adminAnnMessage');
      const typeEl = document.getElementById('adminAnnType');
      const keyEl = document.getElementById('adminAnnDismissKey');
      const enabledEl = document.getElementById('adminAnnEnabled');
      const dismissibleEl = document.getElementById('adminAnnDismissible');
      if (msgEl) msgEl.value = ann.message || '';
      if (typeEl) typeEl.value = ann.type || 'info';
      if (keyEl) keyEl.value = ann.dismissKey || '';
      if (enabledEl) enabledEl.checked = Boolean(ann.enabled);
      if (dismissibleEl) dismissibleEl.checked = ann.dismissible !== false;
    } else {
      statusEl.innerHTML = '<p class="admin-loading">No announcement set yet.</p>';
    }
  } catch (err) {
    statusEl.innerHTML = `<p class="admin-error">Error: ${_esc(err.message)}</p>`;
  }
}

async function _saveAnnouncement() {
  const message = document.getElementById('adminAnnMessage')?.value.trim();
  const type = document.getElementById('adminAnnType')?.value || 'info';
  const dismissKey = document.getElementById('adminAnnDismissKey')?.value.trim() || `ann-${Date.now()}`;
  const enabled = document.getElementById('adminAnnEnabled')?.checked || false;
  const dismissible = document.getElementById('adminAnnDismissible')?.checked !== false;

  if (!message) { showToast('Enter a message', 'warning'); return; }

  try {
    await setDoc(doc(db, 'config', 'announcement'), {
      message, type, dismissKey, enabled, dismissible,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.currentUser?.uid || 'admin'
    });

    // Show/hide the live banner immediately in this session
    const banner = document.getElementById('announcementBanner');
    const msgEl = document.getElementById('announcementMsg');
    if (banner && msgEl) {
      if (enabled) {
        msgEl.textContent = message;
        banner.dataset.type = type;
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    }

    showToast(enabled ? 'Announcement published' : 'Announcement saved (disabled)');
    _loadAnnouncements();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

// ─── Util ─────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
