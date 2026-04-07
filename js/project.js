import { state } from './state.js';
import { uid } from './utils.js';
import { TYPE_LABELS } from './constants.js';

export function sanitizeProject(project, normalizeLineText) {
  return {
    id: project.id || uid("project"),
    title: project.title || "Untitled Script",
    author: project.author || "",
    contact: project.contact || "",
    company: project.company || "",
    details: project.details || "",
    logline: project.logline || "",
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
    collapsedSceneIds: Array.isArray(project.collapsedSceneIds) ? [...new Set(project.collapsedSceneIds)] : [],
    lines: Array.isArray(project.lines) && project.lines.length
      ? project.lines.map((line) => ({
          id: line.id || uid(),
          type: TYPE_LABELS[line.type] ? line.type : "action",
          text: normalizeLineText(line.text || "", TYPE_LABELS[line.type] ? line.type : "action")
        }))
      : [{ id: uid(), type: "action", text: "" }]
  };
}

export function cloneProject(project, withNewId, sanitizeProject, normalizeLineText) {
  const now = new Date().toISOString();
  return sanitizeProject({
    ...project,
    id: withNewId ? uid("project") : project.id,
    createdAt: withNewId ? now : project.createdAt,
    updatedAt: now,
    collapsedSceneIds: [...(project.collapsedSceneIds || [])],
    lines: project.lines.map((line) => ({
      id: uid(),
      type: line.type,
      text: line.text
    }))
  }, normalizeLineText);
}

export function createProject(sanitizeProject, normalizeLineText, upsertProject, persistProjects) {
  const project = sanitizeProject({
    id: uid("project"),
    title: `Script Name ${state.projects.length + 1}`,
    lines: [{ id: uid(), type: "action", text: "" }]
  }, normalizeLineText);
  upsertProject(project, sanitizeProject, normalizeLineText);
  persistProjects(true);
  return project;
}

export function getCurrentProject() {
  return state.projects.find((project) => project.id === state.currentProjectId) || null;
}

export function getLine(id) {
  return getCurrentProject()?.lines.find((line) => line.id === id) || null;
}

export function getLineIndex(id) {
  const project = getCurrentProject();
  return project ? project.lines.findIndex((line) => line.id === id) : -1;
}

export function upsertProject(project, sanitizeProject, normalizeLineText) {
  const next = sanitizeProject(project, normalizeLineText);
  const index = state.projects.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    state.projects.splice(index, 1, next);
  } else {
    state.projects.unshift(next);
  }
}
