import { loadProjects } from './project.js';
import { bindEvents, renderStudio } from './events.js';
import { showHome, renderHome, applyToolbarState, applyTheme, applyViewState, showAuth } from './ui.js';
import { initBackground } from './background.js';
import { AI } from './ai.js';
import { Auth } from './auth.js';
import { ContextMenu } from './contextMenu.js';

function boot() {
  loadProjects();
  bindEvents();
  Auth.init();

  const session = Auth.getSession();
  if (session?.loggedIn) {
    showHome();
  } else {
    showAuth();
  }

  renderHome();
  applyToolbarState();
  applyTheme();
  applyViewState();
  initBackground();
  AI.init();
  ContextMenu.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
