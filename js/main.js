import { loadProjects } from './project.js';
import { bindEvents, renderStudio } from './events.js';
import { showHome, renderHome, applyToolbarState, applyTheme, applyViewState } from './ui.js';
import { initBackground } from './background.js';

function boot() {
  loadProjects();
  bindEvents();
  showHome();
  renderHome();
  applyToolbarState();
  applyTheme();
  applyViewState();
  initBackground();
}

// Check if DOM is already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
