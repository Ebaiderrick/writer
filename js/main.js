import { state } from './config.js';
import { loadProjects } from './project.js';
import { bindEvents, renderStudio, applySaveModeButtons } from './events.js';
import { showAuth, showHome, renderHome, applyToolbarState, applyTheme, applyViewState, showToast } from './ui.js';
import { initBackground } from './background.js';
import { AI } from './ai.js';
import { ContextMenu } from './contextMenu.js';
import { Auth } from './auth.js';
import { applyTranslations } from './i18n.js';
import { restoreLocalSaveFile, startLocalSaveTimer } from './localSave.js';
import { Admin } from './admin.js';
import { Settings } from './settings.js';

function restoreBootPathOverride() {
  const key = 'eyawriter.bootPath';
  const override = sessionStorage.getItem(key);
  if (!override) return;
  sessionStorage.removeItem(key);
  const path = String(override || '').trim();
  if (!path) return;
  if (/\/index\.html$/i.test(window.location.pathname)) {
    window.history.replaceState({}, '', path);
  }
}

function normalizeStaticUiCopy() {
  document.querySelectorAll('[data-left-pane-section-toggle="workspace"], [data-left-pane-section-toggle="insert-story-element"]').forEach((button) => {
    button.textContent = '▾';
  });
  const bgLabel = document.querySelector('#bgAnimationToggle')?.closest('label')?.querySelector('span');
  if (bgLabel) {
    bgLabel.textContent = 'Background Animation';
  }
  const notepadClose = document.getElementById('closeNotepad');
  if (notepadClose) {
    notepadClose.textContent = '×';
  }
}

function boot() {
  restoreBootPathOverride();
  normalizeStaticUiCopy();
  loadProjects();
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
  if (state.pendingRecoveryNotice) {
    showToast("Recovered your latest local session.", "success", { duration: 3400 });
  }
  if (state.localBackupEnabled) {
    restoreLocalSaveFile().then((restored) => {
      applySaveModeButtons();
      if (restored) startLocalSaveTimer();
    });
  }
  initBackground();
  AI.init();
  ContextMenu.init();
  Admin.init();
  Settings.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
