import { auth, db } from './firebase.js';
import { state } from './config.js';
import { setTheme, showToast, applyViewState, applyToolbarState, showModal, showHome } from './ui.js';
import { applyTranslations } from './i18n.js';
import { persistProjects } from './project.js';
import { Admin } from './admin.js';
import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { addDoc, collection, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const APP_VERSION = '1.0.0';

let settingsView = null;
let previousView = null;

function closeTransientOverlays() {
  document.getElementById('profile-popup')?.classList.remove('active');
  document.getElementById('collab-profile-popup')?.classList.remove('active');
}

function detectCurrentView() {
  const ids = ['homeView', 'editorView', 'workspaceView', 'studioView', 'adminView', 'authView'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && !el.hidden) {
      return el;
    }
  }
  return document.getElementById('homeView');
}

function pathForView(view) {
  if (!view) return '/';
  if (view.id === 'adminView') return '/admin';
  if (view.id === 'authView') return '/';
  return '/';
}

function setSettingsPath() {
  if (window.location.pathname !== '/settings') {
    window.history.replaceState({}, '', '/settings');
  }
}

function restoreAppPath() {
  const nextPath = pathForView(previousView);
  if (window.location.pathname !== nextPath) {
    window.history.replaceState({}, '', nextPath);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function setCheck(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.checked = Boolean(value);
  }
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem('eyawriter_session') || 'null');
  } catch {
    return null;
  }
}

function setActiveTab(tabName = 'general') {
  const tabs = settingsView?.querySelectorAll('[data-settings-tab]') || [];
  const sections = settingsView?.querySelectorAll('[data-settings-section]') || [];
  tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.settingsTab === tabName));
  sections.forEach((section) => section.classList.toggle('is-active', section.dataset.settingsSection === tabName));
}

function populateGeneral() {
  const session = getSession();
  const user = auth.currentUser;
  const theme = state.theme || localStorage.getItem('eyawriter-theme') || 'cedar';
  settingsView.querySelectorAll('[data-settings-theme]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.settingsTheme === theme);
  });

  const langSelect = document.getElementById('settingsLang');
  if (langSelect) {
    langSelect.value = state.language || 'en';
  }

  setText('settingsAccountName', session?.name || user?.displayName || 'User');
  setText('settingsAccountEmail', session?.email || user?.email || '—');
  setText('settingsUserNameDisplay', session?.name || user?.displayName || 'User');
}

function populateEditor() {
  setCheck('settingsAutoNumber', state.autoNumberScenes);
  setCheck('settingsBgAnim', state.backgroundAnimation !== false);
  setCheck('settingsPageNumbers', state.viewOptions?.pageNumbers !== false);
  setCheck('settingsOutline', state.viewOptions?.showOutline !== false);
  const textSize = document.getElementById('settingsTextSize');
  if (textSize) {
    textSize.value = String(state.viewOptions?.textSize || 12);
  }
}

function populateAI() {
  const url = localStorage.getItem('eyawriter.aiApiUrl') || '';
  const input = document.getElementById('settingsAiUrl');
  if (input) {
    input.value = url;
  }
}

function populateAccount() {
  const uid = auth.currentUser?.uid || getSession()?.uid;
  const refGroup = document.getElementById('settingsReferralGroup');
  const refLink = document.getElementById('settingsReferralLink');
  if (uid && refGroup && refLink) {
    refGroup.style.display = '';
    refLink.value = new URL(`/signup?ref=${encodeURIComponent(uid)}`, window.location.origin).toString();
  } else if (refGroup) {
    refGroup.style.display = 'none';
  }

  Admin.maybeRevealButton().then(() => {
    const adminGroup = document.getElementById('settingsAdminGroup');
    const visibleAdminBtn = document.querySelector('.open-admin-btn:not([hidden])');
    if (adminGroup) {
      adminGroup.style.display = visibleAdminBtn ? '' : 'none';
    }
  });
}

function populateUsage() {
  const projects = state.projects || [];
  const totalWords = projects.reduce((sum, project) => {
    return sum + (project.lines || []).reduce((lineSum, line) => {
      const words = (line.text || '').trim().split(/\s+/).filter(Boolean).length;
      return lineSum + words;
    }, 0);
  }, 0);
  const totalScenes = projects.reduce((sum, project) => {
    return sum + (project.lines || []).filter((line) => line.type === 'scene' && line.text?.trim()).length;
  }, 0);

  setText('settingsUsageProjects', String(projects.length));
  setText('settingsUsageWords', totalWords.toLocaleString());
  setText('settingsUsageScenes', String(totalScenes));
  setText('settingsUsageJoined', getSession()?.loggedInAt ? new Date(getSession().loggedInAt).toLocaleDateString() : '—');
}

function buildDiagnostics() {
  const payload = {
    appVersion: APP_VERSION,
    userId: auth.currentUser?.uid || getSession()?.uid || '—',
    userEmail: auth.currentUser?.email || getSession()?.email || '—',
    online: navigator.onLine ? 'Yes' : 'No',
    platform: navigator.platform || '—',
    userAgent: navigator.userAgent,
    theme: state.theme,
    language: state.language,
    projects: (state.projects || []).length,
    timestamp: new Date().toISOString()
  };

  const panel = document.getElementById('settingsDiagnosticsPanel');
  if (panel) {
    panel.innerHTML = Object.entries(payload).map(([key, value]) => (
      `<div class="diagnostics-row"><span class="diagnostics-key">${key}</span><span class="diagnostics-val">${String(value)}</span></div>`
    )).join('');
    panel.dataset.diagnostics = JSON.stringify(payload, null, 2);
  }
}

async function populateRecentErrors() {
  const errorList = document.getElementById('settingsRecentErrors');
  if (!errorList) {
    return;
  }
  const uid = auth.currentUser?.uid;
  if (!uid) {
    errorList.innerHTML = '<p class="settings-hint">Sign in to view your recent error log.</p>';
    return;
  }
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'errorLog'));
    if (snap.empty) {
      errorList.innerHTML = '<p class="settings-hint">No errors logged.</p>';
      return;
    }
    const items = snap.docs.slice(0, 5).map((entry) => {
      const data = entry.data() || {};
      return `
        <div class="diagnostics-error-item">
          <span class="diagnostics-error-context">${data.context || 'General'}</span>
          <span class="diagnostics-error-msg">${(data.message || '').slice(0, 140)}</span>
          <span class="diagnostics-error-ts">${data.timestamp ? new Date(data.timestamp).toLocaleString() : ''}</span>
        </div>
      `;
    }).join('');
    errorList.innerHTML = items;
  } catch {
    errorList.innerHTML = '<p class="settings-hint">Could not load the error log right now.</p>';
  }
}

function populate() {
  populateGeneral();
  populateEditor();
  populateAI();
  populateAccount();
  populateUsage();
  buildDiagnostics();
  populateRecentErrors();
}

function persistState() {
  persistProjects(false);
}

function bindTabs() {
  settingsView.querySelectorAll('[data-settings-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      setActiveTab(tab.dataset.settingsTab);
      if (tab.dataset.settingsTab === 'support') {
        buildDiagnostics();
        populateRecentErrors();
      }
    });
  });
}

function bindGeneral() {
  settingsView.querySelectorAll('[data-settings-theme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.settingsTheme;
      setTheme(theme);
      settingsView.querySelectorAll('[data-settings-theme]').forEach((item) => item.classList.remove('is-active'));
      btn.classList.add('is-active');
      showToast('Theme applied', 'success');
      persistState();
    });
  });

  document.getElementById('settingsLang')?.addEventListener('change', (event) => {
    state.language = event.target.value;
    applyTranslations();
    persistState();
    showToast('Language updated', 'success');
  });
}

function bindEditor() {
  document.getElementById('settingsAutoNumber')?.addEventListener('change', (event) => {
    state.autoNumberScenes = event.target.checked;
    persistState();
    applyViewState();
    showToast(event.target.checked ? 'Scene numbering on' : 'Scene numbering off', 'success');
  });

  document.getElementById('settingsBgAnim')?.addEventListener('change', (event) => {
    state.backgroundAnimation = event.target.checked;
    persistState();
    applyToolbarState();
    showToast(event.target.checked ? 'Background animation on' : 'Background animation off', 'success');
  });

  document.getElementById('settingsPageNumbers')?.addEventListener('change', (event) => {
    state.viewOptions = { ...state.viewOptions, pageNumbers: event.target.checked };
    persistState();
    applyViewState();
    showToast(event.target.checked ? 'Page numbers on' : 'Page numbers off', 'success');
  });

  document.getElementById('settingsOutline')?.addEventListener('change', (event) => {
    state.viewOptions = { ...state.viewOptions, showOutline: event.target.checked };
    persistState();
    applyViewState();
    showToast(event.target.checked ? 'Outline on' : 'Outline off', 'success');
  });

  document.getElementById('settingsTextSize')?.addEventListener('change', (event) => {
    state.viewOptions = { ...state.viewOptions, textSize: Number.parseInt(event.target.value, 10) || 12 };
    persistState();
    applyViewState();
    showToast('Text size updated', 'success');
  });
}

function bindAI() {
  document.getElementById('settingsAiSave')?.addEventListener('click', () => {
    const input = document.getElementById('settingsAiUrl');
    const url = input?.value.trim() || '';
    if (url) {
      localStorage.setItem('eyawriter.aiApiUrl', url);
    } else {
      localStorage.removeItem('eyawriter.aiApiUrl');
    }
    showToast('AI endpoint saved', 'success');
  });

  document.getElementById('settingsAiReset')?.addEventListener('click', () => {
    localStorage.removeItem('eyawriter.aiApiUrl');
    const input = document.getElementById('settingsAiUrl');
    if (input) {
      input.value = '';
    }
    showToast('AI endpoint reset to default', 'success');
  });

  document.getElementById('settingsAiTest')?.addEventListener('click', async () => {
    const button = document.getElementById('settingsAiTest');
    const input = document.getElementById('settingsAiUrl');
    const url = input?.value.trim()
      || localStorage.getItem('eyawriter.aiApiUrl')
      || (window.location.hostname === 'localhost' ? 'http://localhost:3001/api/ai-assist' : '/api/ai-assist');
    if (!button) {
      return;
    }
    button.disabled = true;
    button.textContent = 'Testing…';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'action', action: 'Grammar', current: 'Test.', context: '', instruction: '' })
      });
      showToast(response.ok ? 'AI endpoint is reachable' : `AI returned ${response.status}`, response.ok ? 'success' : 'warning');
    } catch {
      showToast('Could not reach AI endpoint', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Test Connection';
    }
  });
}

function bindAccount() {
  document.getElementById('settingsChangePassword')?.addEventListener('click', async () => {
    const email = auth.currentUser?.email;
    if (!email) {
      showToast('Sign in with an email account first.', 'error');
      return;
    }
    await sendPasswordResetEmail(auth, email);
    showToast('Password reset email sent.', 'success');
  });

  document.getElementById('settingsCopyReferral')?.addEventListener('click', async () => {
    const input = document.getElementById('settingsReferralLink');
    if (!input?.value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(input.value);
      showToast('Referral link copied.', 'success');
    } catch {
      showToast('Could not copy referral link.', 'error');
    }
  });

  document.getElementById('settingsAdminBtn')?.addEventListener('click', async () => {
    Settings.hide();
    await Admin.show();
  });
}

function bindLegal() {
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

function bindSupport() {
  document.getElementById('settingsCopyDiagnostics')?.addEventListener('click', async () => {
    const text = document.getElementById('settingsDiagnosticsPanel')?.dataset.diagnostics || '';
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Diagnostics copied.', 'success');
    } catch {
      showToast('Could not copy diagnostics.', 'error');
    }
  });

  document.getElementById('settingsClearErrorLog')?.addEventListener('click', async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      showToast('Sign in first.', 'warning');
      return;
    }
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'errorLog'));
      await Promise.all(snap.docs.map((entry) => deleteDoc(entry.ref)));
      showToast('Error log cleared.', 'success');
      await populateRecentErrors();
    } catch {
      showToast('Could not clear the error log.', 'error');
    }
  });

  document.getElementById('settingsFeedbackBtn')?.addEventListener('click', async () => {
    const content = document.createElement('div');
    content.innerHTML = `
      <div style="display:grid;gap:10px;">
        <select id="feedbackType" class="comment-filter-select">
          <option value="bug">Bug report</option>
          <option value="feature">Feature request</option>
          <option value="question">Question</option>
          <option value="other">Other</option>
        </select>
        <input id="feedbackSubject" class="modal-input" type="text" placeholder="Subject (optional)" maxlength="120">
        <textarea id="feedbackBody" class="collab-textarea" placeholder="Describe the issue or idea…" rows="5" maxlength="2000"></textarea>
      </div>
    `;
    const confirmed = await showModal({ title: 'Send Feedback', message: content, confirmLabel: 'Send', showCancel: true });
    if (!confirmed) {
      return;
    }

    const body = content.querySelector('#feedbackBody')?.value?.trim() || '';
    if (!body) {
      showToast('Please describe your feedback.', 'warning');
      return;
    }

    const diagnostics = document.getElementById('settingsDiagnosticsPanel')?.dataset.diagnostics;
    await addDoc(collection(db, 'adminFeedback'), {
      uid: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || getSession()?.email || null,
      type: content.querySelector('#feedbackType')?.value || 'other',
      subject: content.querySelector('#feedbackSubject')?.value?.trim() || '',
      body,
      diagnostics: diagnostics ? JSON.parse(diagnostics) : null,
      timestamp: new Date().toISOString(),
      appVersion: APP_VERSION
    });
    showToast('Feedback sent.', 'success');
  });
}

export const Settings = {
  init() {
    settingsView = document.getElementById('settingsView');
    if (!settingsView) {
      return;
    }
    bindTabs();
    bindGeneral();
    bindEditor();
    bindAI();
    bindAccount();
    bindLegal();
    bindSupport();
    document.getElementById('settingsBackBtn')?.addEventListener('click', () => Settings.hide());
    document.querySelectorAll('.open-settings-btn').forEach((btn) => {
      btn.addEventListener('click', () => Settings.show());
    });
  },

  show(fromView = null) {
    if (!settingsView) {
      return;
    }
    closeTransientOverlays();
    previousView = fromView || detectCurrentView();
    document.querySelectorAll('.app-shell > section').forEach((section) => {
      section.hidden = true;
    });
    settingsView.hidden = false;
    setSettingsPath();
    setActiveTab('general');
    populate();
  },

  hide() {
    if (!settingsView) {
      return;
    }
    settingsView.hidden = true;
    restoreAppPath();
    const nextView = previousView || document.getElementById('homeView');
    previousView = null;
    if (nextView?.id === 'homeView') {
      showHome();
    } else if (nextView) {
      nextView.hidden = false;
      applyViewState();
      applyToolbarState();
    } else {
      showHome();
    }
  }
};
