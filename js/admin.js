import { auth, db } from './firebase.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, addDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast, renderHome } from './ui.js';
import { FeatureFlags } from './featureFlags.js';

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
    if (window.location.pathname === '/app') {
      window.history.replaceState({}, '', '/admin');
    }
    _activateTab('overview');
    return true;
  },

  hide() {
    document.querySelectorAll('.app-shell > section').forEach(el => { el.hidden = true; });
    if (_view) _view.hidden = true;
    if (window.location.pathname === '/admin') {
      window.history.replaceState({}, '', '/app');
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
    const [sigSnap, fbSnap, auSnap, incSnap] = await Promise.all([
      getDocs(collection(db, 'adminSignups')),
      getDocs(collection(db, 'adminFeedback')),
      getDocs(collection(db, 'adminActiveUsers')),
      getDocs(collection(db, 'incidents'))
    ]);
    const openIncidents = incSnap.docs.filter(d => d.data().status !== 'resolved').length;
    panel.innerHTML = `<div class="admin-stats-grid">
      ${_statCard('Total Signups', sigSnap.size)}
      ${_statCard('Feedback Items', fbSnap.size)}
      ${_statCard('Active Users (tracked)', auSnap.size)}
      ${_statCard('Open Incidents', openIncidents)}
    </div>`;
  } catch (err) {
    panel.innerHTML = `<p class="admin-error">Failed to load: ${err.message}</p>`;
  }
}

function _statCard(label, value) {
  return `<div class="admin-stat-card"><span class="admin-stat-value">${value}</span><span class="admin-stat-label">${label}</span></div>`;
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
