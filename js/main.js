import { state } from './config.js';
import { loadProjects, persistProjects } from './project.js';
import { bindEvents, renderStudio, applySaveModeButtons } from './events.js';
import { showAuth, showHome, renderHome, applyToolbarState, applyTheme, applyViewState } from './ui.js';
import { initBackground } from './background.js';
import { AI } from './ai.js';
import { ContextMenu } from './contextMenu.js';
import { Auth } from './auth.js';
import { applyTranslations } from './i18n.js';
import { restoreLocalSaveFile, startLocalSaveTimer } from './localSave.js';
import { Settings } from './settings.js';
import { Onboarding } from './onboarding.js';
import { Recovery } from './recovery.js';
import { showToast } from './toast.js';
import './logger.js';
import './telemetry.js';

function boot() {
  loadProjects();

  Recovery.init({
    onOnline() {
      showToast('Back online — syncing changes', 'info', 3000);
      if (Recovery.hasOfflineSyncPending()) {
        persistProjects(false, { syncInputs: false });
      }
    },
    onOffline() {
      showToast("You're offline — changes saved locally", 'warning', 4000);
    }
  });
  Recovery.restoreHistory(state.currentProjectId);
  Recovery.checkAndOffer();

  bindEvents();

  // Fast-path: show initial view from cached session while Firebase resolves
  const session = Auth.getSession();
  if (session && session.loggedIn) {
    showHome();
  } else {
    showAuth();
  }
  renderHome();

  Auth.init();
  applyToolbarState();
  applyTheme();
  applyViewState();
  applyTranslations();
  applySaveModeButtons();
  if (state.localBackupEnabled) {
    restoreLocalSaveFile().then((restored) => {
      applySaveModeButtons();
      if (restored) startLocalSaveTimer();
    });
  }
  initBackground();
  AI.init();
  ContextMenu.init();
  Settings.init();

  // Wire up auth-page legal links
  document.getElementById('authTosLink')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('tosDialog')?.showModal();
  });
  document.getElementById('authPrivacyLink')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('privacyDialog')?.showModal();
  });

  // Show onboarding for returning/first-time sessions
  if (session?.loggedIn && !session?.isDemoSession) {
    Onboarding.maybeShow();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
