import { auth } from './firebase.js';
import { state } from './config.js';
import { setTheme, showToast } from './ui.js';
import { applyTranslations } from './i18n.js';
import { persistProjects } from './project.js';
import { Admin } from './admin.js';

let settingsView = null;
let previousView = null;

function setSettingsPath() {
  if (window.location.pathname !== '/settings') {
    window.history.replaceState({}, '', '/settings');
  }
}

function restoreAppPath() {
  const nextPath = previousView?.id === 'adminView' ? '/admin' : '/app';
  if (window.location.pathname !== nextPath) {
    window.history.replaceState({}, '', nextPath);
  }
}

function detectCurrentView() {
  const ids = ['homeView', 'workspaceView', 'studioView', 'adminView'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && !el.hidden) {
      return el;
    }
  }
  return document.getElementById('homeView');
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

function populateSettings() {
  const session = JSON.parse(localStorage.getItem('eyawriter_session') || 'null');
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
  setCheck('settingsAutoNumber', state.autoNumberScenes);

  Admin.maybeRevealButton().then(() => {
    const adminGroup = document.getElementById('settingsAdminGroup');
    const visibleAdminBtn = document.querySelector('.open-admin-btn:not([hidden])');
    if (adminGroup) {
      adminGroup.hidden = !visibleAdminBtn;
    }
  });
}

function bindTabs() {
  const tabs = settingsView.querySelectorAll('[data-settings-tab]');
  const sections = settingsView.querySelectorAll('[data-settings-section]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.remove('is-active'));
      sections.forEach((item) => item.classList.remove('is-active'));
      tab.classList.add('is-active');
      settingsView.querySelector(`[data-settings-section="${tab.dataset.settingsTab}"]`)?.classList.add('is-active');
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
    });
  });

  document.getElementById('settingsLang')?.addEventListener('change', (event) => {
    state.language = event.target.value;
    applyTranslations();
    persistProjects(false);
    showToast('Language updated', 'success');
  });

  document.getElementById('settingsAutoNumber')?.addEventListener('change', (event) => {
    state.autoNumberScenes = event.target.checked;
    persistProjects(false);
    showToast(event.target.checked ? 'Scene numbering on' : 'Scene numbering off', 'success');
  });
}

function bindAccount() {
  document.getElementById('settingsChangePassword')?.addEventListener('click', async () => {
    const email = auth.currentUser?.email;
    if (!email) {
      showToast('Sign in with an email account first.', 'error');
      return;
    }
    const { sendPasswordResetEmail } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    await sendPasswordResetEmail(auth, email);
    showToast('Password reset email sent.', 'success');
  });

  document.getElementById('settingsAdminBtn')?.addEventListener('click', async () => {
    await Admin.show();
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
    bindAccount();
    document.getElementById('settingsBackBtn')?.addEventListener('click', () => Settings.hide());
    document.querySelectorAll('.open-settings-btn').forEach((btn) => {
      btn.addEventListener('click', () => Settings.show());
    });
  },

  show(fromView = null) {
    if (!settingsView) {
      return;
    }
    previousView = fromView || detectCurrentView();
    document.querySelectorAll('.app-shell > section').forEach((section) => {
      section.hidden = true;
    });
    settingsView.hidden = false;
    setSettingsPath();
    settingsView.querySelector('[data-settings-tab="general"]')?.click();
    populateSettings();
  },

  hide() {
    if (!settingsView) {
      return;
    }
    settingsView.hidden = true;
    restoreAppPath();
    (previousView || document.getElementById('homeView'))?.removeAttribute('hidden');
    previousView = null;
  }
};
