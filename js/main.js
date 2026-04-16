import { loadProjects } from './project.js';
import { bindEvents, renderStudio } from './events.js';
import { showHome, renderHome, applyToolbarState, applyTheme, applyViewState, showAuth } from './ui.js';
import { initBackground } from './background.js';
import { AI } from './ai.js';
import { Auth } from './auth.js';

function boot() {
  loadProjects();
  bindEvents();
  Auth.init();

  const session = localStorage.getItem("eyawriter_session");
  if (session) {
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
}

// Check if DOM is already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
