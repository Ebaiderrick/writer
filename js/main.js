import { state } from './config.js';
import { loadProjects } from './project.js';
import { bindEvents, renderStudio, applySaveModeButtons } from './events.js';
import { showAuth, showHome, renderHome, applyToolbarState, applyTheme, applyViewState } from './ui.js';
import { initBackground } from './background.js';
import { AI } from './ai.js';
import { ContextMenu } from './contextMenu.js';
import { Auth } from './auth.js';
import { applyTranslations } from './i18n.js';
import { restoreLocalSaveFile, startLocalSaveTimer } from './localSave.js';

function boot() {
  loadProjects();
  bindEvents();

  Auth.init();
  const session = Auth.getSession();
  if (session && session.loggedIn) {
    showHome();
  } else {
    showAuth();
  }

  renderHome();
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
