import { state, APP_VERSION } from './config.js';
import { setTheme, showHome, applyViewState, applyToolbarState, showModal, customAlert } from './ui.js';
import { applyTranslations } from './i18n.js';
import { showToast } from './toast.js';
import { persistProjects } from './project.js';
import { auth, db } from './firebase.js';
import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, getDocs, query, orderBy, limit, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { Logger, SESSION_ID } from './logger.js';

let _prevView = null;
let _settingsView = null;

export const Settings = {
  init() {
    _settingsView = document.getElementById('settingsView');
    if (!_settingsView) return;
    _bindTabs();
    _bindGeneral();
    _bindEditor();
    _bindAI();
    _bindAccount();
    _bindLegal();
    _bindSupport();
    document.getElementById('settingsBackBtn')?.addEventListener('click', Settings.hide);
    document.querySelectorAll('.open-settings-btn').forEach(btn => {
      btn.addEventListener('click', () => Settings.show());
    });
  },

  show(fromView = null) {
    _prevView = fromView || _detectCurrentView();
    document.querySelectorAll('.app-shell > section').forEach(el => { el.hidden = true; });
    _settingsView.hidden = false;
    _populate();
  },

  hide() {
    _settingsView.hidden = true;
    if (_prevView) {
      _prevView.hidden = false;
      _prevView = null;
    } else {
      const home = document.getElementById('homeView');
      if (home) home.hidden = false;
    }
  }
};

function _detectCurrentView() {
  const ids = ['homeView', 'studioView', 'workspaceView'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && !el.hidden) return el;
  }
  return document.getElementById('homeView');
}

function _bindTabs() {
  const tabs = _settingsView.querySelectorAll('[data-settings-tab]');
  const sections = _settingsView.querySelectorAll('[data-settings-section]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('is-active'));
      sections.forEach(s => s.classList.remove('is-active'));
      tab.classList.add('is-active');
      const target = _settingsView.querySelector(`[data-settings-section="${tab.dataset.settingsTab}"]`);
      target?.classList.add('is-active');
    });
  });
}

function _populate() {
  _populateGeneral();
  _populateEditor();
  _populateAI();
  _populateAccount();
  _populateUsage();
}

function _populateSupport() {
  const panel = document.getElementById('settingsDiagnosticsPanel');
  const errList = document.getElementById('settingsRecentErrors');
  if (!panel) return;

  const uid = auth.currentUser?.uid || '—';
  const sessionAge = Math.round((Date.now() - Logger.sessionStart) / 1000);
  const localStorageBytes = (() => { try { return new Blob([localStorage.getItem('eyawriter-projects-v5') || '']).size; } catch { return 0; } })();
  const diagnostics = {
    appVersion: APP_VERSION,
    sessionId: SESSION_ID,
    userId: uid !== '—' ? uid.slice(0, 8) + '…' : '—',
    sessionAge: `${Math.floor(sessionAge / 60)}m ${sessionAge % 60}s`,
    online: navigator.onLine ? 'Yes' : 'No',
    localStorageKB: Math.round(localStorageBytes / 1024) + ' KB',
    userAgent: navigator.userAgent.slice(0, 120),
    platform: navigator.platform || '—',
    projects: (state.projects || []).length,
    timestamp: new Date().toISOString()
  };

  panel.innerHTML = Object.entries(diagnostics).map(([k, v]) =>
    `<div class="diagnostics-row"><span class="diagnostics-key">${k}</span><span class="diagnostics-val">${String(v)}</span></div>`
  ).join('');
  panel.dataset.diagnostics = JSON.stringify(diagnostics, null, 2);

  // Load recent errors from Firestore
  if (errList && auth.currentUser) {
    errList.innerHTML = '<p class="settings-hint">Loading…</p>';
    Logger.getRecentErrors(5).then(errors => {
      if (!errors.length) {
        errList.innerHTML = '<p class="settings-hint">No errors logged.</p>';
        return;
      }
      errList.innerHTML = errors.map(e =>
        `<div class="diagnostics-error-item">
          <span class="diagnostics-error-context">${e.context || '?'}</span>
          <span class="diagnostics-error-msg">${(e.message || '').slice(0, 120)}</span>
          <span class="diagnostics-error-ts">${e.timestamp ? new Date(e.timestamp).toLocaleString() : ''}</span>
        </div>`
      ).join('');
    });
  } else if (errList) {
    errList.innerHTML = '<p class="settings-hint">Sign in to view error log.</p>';
  }
}

function _populateGeneral() {
  const theme = state.theme || localStorage.getItem('eyawriter-theme') || 'cedar';
  _settingsView.querySelectorAll('[data-settings-theme]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.settingsTheme === theme);
  });
  const lang = state.language || 'en';
  const langSel = document.getElementById('settingsLang');
  if (langSel) langSel.value = lang;
}

function _populateEditor() {
  _setCheck('settingsAutoNumber', state.autoNumberScenes);
  _setCheck('settingsBgAnim', state.backgroundAnimation !== false);
  _setCheck('settingsPageNumbers', state.viewOptions?.pageNumbers !== false);
  _setCheck('settingsOutline', state.viewOptions?.showOutline !== false);
  const sizeEl = document.getElementById('settingsTextSize');
  if (sizeEl) sizeEl.value = state.viewOptions?.textSize || 12;
}

function _populateAI() {
  const url = localStorage.getItem('eyawriter.aiApiUrl') || '';
  const urlEl = document.getElementById('settingsAiUrl');
  if (urlEl) urlEl.value = url;
}

function _populateAccount() {
  const session = _getSession();
  const emailEl = document.getElementById('settingsAccountEmail');
  const nameEl = document.getElementById('settingsAccountName');
  if (emailEl) emailEl.textContent = session?.email || auth.currentUser?.email || '—';
  if (nameEl) nameEl.textContent = session?.name || auth.currentUser?.displayName || '—';
}

function _populateUsage() {
  const projects = state.projects || [];
  const totalWords = projects.reduce((sum, p) => {
    return sum + (p.lines || []).reduce((s, l) => s + (l.text || '').trim().split(/\s+/).filter(Boolean).length, 0);
  }, 0);
  const totalScenes = projects.reduce((sum, p) => sum + (p.lines || []).filter(l => l.type === 'scene' && l.text?.trim()).length, 0);

  _setText('settingsUsageProjects', projects.length);
  _setText('settingsUsageWords', totalWords.toLocaleString());
  _setText('settingsUsageScenes', totalScenes);
  const joined = _getSession()?.loggedInAt;
  _setText('settingsUsageJoined', joined ? new Date(joined).toLocaleDateString() : '—');
}

function _bindGeneral() {
  _settingsView.querySelectorAll('[data-settings-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.settingsTheme;
      setTheme(theme);
      _settingsView.querySelectorAll('[data-settings-theme]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      showToast('Theme applied');
    });
  });

  document.getElementById('settingsLang')?.addEventListener('change', e => {
    state.language = e.target.value;
    applyTranslations();
    showToast('Language updated');
  });
}

function _bindEditor() {
  _onCheck('settingsAutoNumber', val => {
    state.autoNumberScenes = val;
    document.getElementById('autoNumberToggle')?.dispatchEvent(new Event('change'));
    persistProjects();
    showToast(val ? 'Scene numbering on' : 'Scene numbering off', 'info');
  });

  _onCheck('settingsBgAnim', val => {
    state.backgroundAnimation = val;
    const bgToggle = document.getElementById('bgAnimationToggle');
    if (bgToggle) { bgToggle.checked = val; bgToggle.dispatchEvent(new Event('change')); }
    showToast('Background animation ' + (val ? 'on' : 'off'), 'info');
  });

  _onCheck('settingsPageNumbers', val => {
    state.viewOptions = { ...state.viewOptions, pageNumbers: val };
    applyViewState();
    showToast('Page numbers ' + (val ? 'on' : 'off'), 'info');
  });

  _onCheck('settingsOutline', val => {
    state.viewOptions = { ...state.viewOptions, showOutline: val };
    applyViewState();
    showToast('Outline ' + (val ? 'on' : 'off'), 'info');
  });

  document.getElementById('settingsTextSize')?.addEventListener('change', e => {
    const size = parseInt(e.target.value, 10);
    state.viewOptions = { ...state.viewOptions, textSize: size };
    applyViewState();
    showToast('Text size updated', 'info');
  });
}

function _bindAI() {
  document.getElementById('settingsAiSave')?.addEventListener('click', () => {
    const url = document.getElementById('settingsAiUrl')?.value.trim() || '';
    if (url) {
      localStorage.setItem('eyawriter.aiApiUrl', url);
    } else {
      localStorage.removeItem('eyawriter.aiApiUrl');
    }
    showToast('AI endpoint saved');
  });

  document.getElementById('settingsAiReset')?.addEventListener('click', () => {
    localStorage.removeItem('eyawriter.aiApiUrl');
    const urlEl = document.getElementById('settingsAiUrl');
    if (urlEl) urlEl.value = '';
    showToast('AI endpoint reset to default', 'info');
  });

  document.getElementById('settingsAiTest')?.addEventListener('click', async () => {
    const btn = document.getElementById('settingsAiTest');
    const url = document.getElementById('settingsAiUrl')?.value.trim()
      || localStorage.getItem('eyawriter.aiApiUrl')
      || (location.hostname === 'localhost' ? 'http://localhost:3001/api/ai-assist' : '/api/ai-assist');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'action', action: 'Grammar', current: 'Test.', context: '', instruction: '' })
      });
      if (res.ok) {
        showToast('AI endpoint is reachable ✓');
      } else {
        showToast(`AI returned ${res.status}`, 'warning');
      }
    } catch {
      showToast('Could not reach AI endpoint', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  });
}

function _bindAccount() {
  document.getElementById('settingsChangePassword')?.addEventListener('click', async () => {
    const email = auth.currentUser?.email || _getSession()?.email;
    if (!email) { showToast('No email on file', 'error'); return; }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('Password reset email sent');
    } catch (err) {
      showToast(err.message || 'Failed to send reset email', 'error');
    }
  });
}

function _bindLegal() {
  document.getElementById('settingsPrivacyBtn')?.addEventListener('click', () => {
    document.getElementById('privacyDialog')?.showModal();
  });
  document.getElementById('settingsTosBtn')?.addEventListener('click', () => {
    document.getElementById('tosDialog')?.showModal();
  });
  document.getElementById('settingsAiDisclosureBtn')?.addEventListener('click', () => {
    document.getElementById('aiDisclosureDialog')?.showModal();
  });
}

function _bindSupport() {
  // Populate diagnostics when the support tab is opened
  _settingsView.querySelectorAll('[data-settings-tab]').forEach(tab => {
    if (tab.dataset.settingsTab === 'support') {
      tab.addEventListener('click', () => _populateSupport());
    }
  });

  document.getElementById('settingsCopyDiagnostics')?.addEventListener('click', () => {
    const panel = document.getElementById('settingsDiagnosticsPanel');
    const text = panel?.dataset.diagnostics || JSON.stringify({ error: 'No diagnostics available' });
    navigator.clipboard?.writeText(text).then(() => {
      showToast('Diagnostics copied to clipboard');
    }).catch(() => {
      showToast('Could not copy — try manually', 'warning');
    });
  });

  document.getElementById('settingsClearErrorLog')?.addEventListener('click', async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) { showToast('Sign in first', 'warning'); return; }
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'errorLog'));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      showToast('Error log cleared');
      _populateSupport();
    } catch {
      showToast('Could not clear error log', 'error');
    }
  });

  document.getElementById('settingsFeedbackBtn')?.addEventListener('click', async () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div style="display:grid;gap:10px;">
        <select id="feedbackType" class="comment-filter-select">
          <option value="bug">Bug report</option>
          <option value="feature">Feature request</option>
          <option value="question">Question</option>
          <option value="other">Other</option>
        </select>
        <input id="feedbackSubject" class="modal-input" type="text" placeholder="Subject (optional)" maxlength="120">
        <textarea id="feedbackBody" class="collab-textarea" placeholder="Describe the issue or idea…" rows="5" maxlength="2000"></textarea>
        <label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;cursor:pointer;">
          <input type="checkbox" id="feedbackAttachDiag" checked>
          <span>Attach diagnostics (helps us diagnose issues)</span>
        </label>
      </div>
    `;
    const confirmed = await showModal({ title: 'Send Feedback', message: container, confirmLabel: 'Send', showCancel: true });
    if (!confirmed) return;

    const type = container.querySelector('#feedbackType')?.value || 'other';
    const subject = container.querySelector('#feedbackSubject')?.value?.trim() || '';
    const body = container.querySelector('#feedbackBody')?.value?.trim() || '';
    if (!body) { showToast('Please describe your feedback', 'warning'); return; }

    const attachDiag = container.querySelector('#feedbackAttachDiag')?.checked;
    const uid = auth.currentUser?.uid;
    const panel = document.getElementById('settingsDiagnosticsPanel');

    const entry = {
      type,
      subject,
      body,
      timestamp: new Date().toISOString(),
      appVersion: APP_VERSION,
      sessionId: SESSION_ID,
      ...(attachDiag && panel?.dataset.diagnostics ? { diagnostics: JSON.parse(panel.dataset.diagnostics) } : {})
    };

    try {
      if (uid) {
        await addDoc(collection(db, 'users', uid, 'feedback'), entry);
      }
      showToast('Feedback sent — thank you!');
    } catch {
      showToast('Could not send feedback right now', 'error');
    }
  });
}

function _setCheck(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

function _onCheck(id, cb) {
  document.getElementById(id)?.addEventListener('change', e => cb(e.target.checked));
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _getSession() {
  try { return JSON.parse(localStorage.getItem('eyawriter_session') || 'null'); } catch { return null; }
}
