import { state } from './state.js';
import { uid, sanitizeViewOptions, clamp } from './utils.js';
import { STORAGE_KEY, DEFAULT_VIEW_OPTIONS, TYPE_LABELS } from './constants.js';

export function loadProjects(sampleProject, sanitizeProject, cloneProject, normalizeLineText) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    state.projects = Array.isArray(parsed?.projects) && parsed.projects.length
      ? parsed.projects.map(proj => sanitizeProject(proj, normalizeLineText))
      : [cloneProject(sampleProject, true)];
    state.currentProjectId = parsed?.currentProjectId || state.projects[0].id;
    state.aiAssist = Boolean(parsed?.aiAssist);
    state.toolStripCollapsed = Boolean(parsed?.toolStripCollapsed);
    state.autoNumberScenes = Boolean(parsed?.autoNumberScenes);
    state.theme = parsed?.theme || "rose";
    state.viewOptions = sanitizeViewOptions(parsed?.viewOptions);
    document.documentElement.style.setProperty("--left-pane-width", `${clamp(parsed?.leftWidth || 286, 220, 460)}px`);
    document.documentElement.style.setProperty("--right-pane-width", `${clamp(parsed?.rightWidth || 324, 260, 520)}px`);
  } catch (error) {
    console.error("Unable to load projects", error);
    state.projects = [cloneProject(sampleProject, true)];
    state.currentProjectId = state.projects[0].id;
    state.viewOptions = { ...DEFAULT_VIEW_OPTIONS };
  }
}

export function persistProjects(forceSavedBadge, refs, syncProjectFromInputs, renderHome) {
  syncProjectFromInputs();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    currentProjectId: state.currentProjectId,
    projects: state.projects,
    aiAssist: state.aiAssist,
    toolStripCollapsed: state.toolStripCollapsed,
    autoNumberScenes: state.autoNumberScenes,
    theme: state.theme,
    viewOptions: state.viewOptions,
    leftWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-pane-width"), 10),
    rightWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--right-pane-width"), 10)
  }));
  if (refs && refs.saveBadge) {
      refs.saveBadge.textContent = forceSavedBadge ? "Saved locally" : "Saved";
  }
  if (renderHome) renderHome();
}
