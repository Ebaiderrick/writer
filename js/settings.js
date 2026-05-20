import { state } from './config.js';
import { setTheme, showHome, applyViewState, applyToolbarState } from './ui.js';
import { applyTranslations } from './i18n.js';
import { showToast } from './toast.js';
import { persistProjects } from './project.js';
import { auth } from './firebase.js';
import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

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
