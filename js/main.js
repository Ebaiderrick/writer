import { loadProjects } from './project.js';
import { bindEvents, renderStudio } from './events.js';
import { showHome, renderHome, applyToolbarState, applyTheme, applyViewState } from './ui.js';
import AI from './ai.js';

function boot() {
  loadProjects();
  bindEvents();
  AI.init();
  showHome();
  renderHome();
  applyToolbarState();
  applyTheme();
  applyViewState();
}

// Check if DOM is already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
