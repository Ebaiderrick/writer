import { STORAGE_KEY, state, TYPE_LABELS, DEFAULT_VIEW_OPTIONS } from './config.js';
import { uid, normalizeLineText, stripWrapperChars, clamp } from './utils.js';
import { refs } from './dom.js';

export const sampleProject = {
  id: "sample-project",
  title: "The Hill at First Light",
  author: "EyaLingo Studio",
  contact: "hello@eyalingo.example",
  company: "Open Frame Pictures",
  details: "First draft | Thriller drama",
  logline: "A restless runner races across a city waking up too slowly, only to discover the hill she climbs each dawn hides the truth about her missing brother.",
  createdAt: "2026-04-04T09:00:00.000Z",
  updatedAt: "2026-04-06T09:00:00.000Z",
  lines: [
    { id: uid(), type: "scene", text: "INT. APARTMENT STAIRWELL - DAWN" },
    { id: uid(), type: "action", text: "Maya bolts down the concrete steps two at a time, shoes half-laced, breath already chasing her." },
    { id: uid(), type: "character", text: "MAYA" },
    { id: uid(), type: "dialogue", text: "Not today. I am not missing sunrise again." },
    { id: uid(), type: "scene", text: "EXT. RIVERSIDE HILL - CONT'D" },
    { id: uid(), type: "action", text: "The city glows below in quiet amber ribbons. A single cassette player crackles beside an empty bench." },
    { id: uid(), type: "character", text: "RUIZ" },
    { id: uid(), type: "dialogue", text: "If your brother left anything behind, it is in here." },
    { id: uid(), type: "parenthetical", text: "(quietly)" },
    { id: uid(), type: "dialogue", text: "And you may not like what we find." }
  ]
};

export function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    state.projects = Array.isArray(parsed?.projects) && parsed.projects.length
      ? parsed.projects.map(sanitizeProject)
      : [cloneProject(sampleProject, true)];
    state.currentProjectId = parsed?.currentProjectId || state.projects[0].id;
    state.aiAssist = Boolean(parsed?.aiAssist);
    state.toolStripCollapsed = Boolean(parsed?.toolStripCollapsed);
    state.autoNumberScenes = Boolean(parsed?.autoNumberScenes);
    state.theme = sanitizeThemeName(parsed?.theme);
    state.viewOptions = sanitizeViewOptions(parsed?.viewOptions);
    document.documentElement.style.setProperty("--left-pane-width", `${clamp(parsed?.leftWidth || 286, 220, 460)}px`);
    document.documentElement.style.setProperty("--right-pane-width", `${clamp(parsed?.rightWidth || 324, 260, 520)}px`);
  } catch (error) {
    console.error("Unable to load projects", error);
    state.projects = [cloneProject(sampleProject, true)];
    state.currentProjectId = state.projects[0].id;
    state.theme = "dark";
    state.viewOptions = { ...DEFAULT_VIEW_OPTIONS };
  }
}

function sanitizeThemeName(theme) {
  const nextTheme = String(theme || "").trim().toLowerCase();
  if (nextTheme === "rose") {
    return "white";
  }

  return ["dark", "turquoise", "white", "navy"].includes(nextTheme)
    ? nextTheme
    : "dark";
}

export function sanitizeProject(project) {
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

export function cloneProject(project, withNewId) {
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
  });
}

export function createProject() {
  const project = sanitizeProject({
    id: uid("project"),
    title: `Script Name ${state.projects.length + 1}`,
    lines: [{ id: uid(), type: "action", text: "" }]
  });
  upsertProject(project);
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

export function upsertProject(project) {
  const next = sanitizeProject(project);
  const index = state.projects.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    state.projects.splice(index, 1, next);
  } else {
    state.projects.unshift(next);
  }
}

export function persistProjects(forceSavedBadge = false) {
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
  if (refs.saveBadge) {
      refs.saveBadge.textContent = forceSavedBadge ? "Saved locally" : "Saved";
  }
}

export function queueSave() {
  if (refs.saveBadge) {
      refs.saveBadge.textContent = "Saving...";
  }
  clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => persistProjects(false), 200);
}

export function syncProjectFromInputs() {
  const project = getCurrentProject();
  if (!project) {
    return null;
  }
  project.title = refs.titleInput.value.trim() || "Untitled Script";
  project.author = refs.authorInput.value.trim();
  project.contact = refs.contactInput.value.trim();
  project.company = refs.companyInput.value.trim();
  project.details = refs.detailsInput.value.trim();
  project.logline = refs.loglineInput.value.trim();
  project.updatedAt = new Date().toISOString();
  return project;
}

export function sanitizeViewOptions(options) {
  return {
    ruler: Boolean(options?.ruler),
    pageNumbers: options?.pageNumbers === undefined ? true : Boolean(options.pageNumbers),
    pageCount: options?.pageCount === undefined ? true : Boolean(options.pageCount),
    showOutline: options?.showOutline === undefined ? true : Boolean(options.showOutline),
    textSize: clamp(options?.textSize ?? DEFAULT_VIEW_OPTIONS.textSize, 11, 14)
  };
}

export function serializeScript(project) {
  return project.lines.map((line) => normalizeLineText(line.text, line.type)).filter(Boolean).join("\n\n");
}

export function getDefaultText(type, contextIndex) {
  if (type === "character") {
    return getSuggestedNextSpeaker(contextIndex);
  }
  return "";
}

export function getSuggestedNextSpeaker(contextIndex) {
  const project = getCurrentProject();
  if (!project) return "";
  const recent = [];

  for (let index = 0; index <= contextIndex; index += 1) {
    const line = project.lines[index];
    if (line?.type === "character" && line.text.trim()) {
      const value = normalizeLineText(line.text, "character");
      if (recent[recent.length - 1] !== value) {
        recent.push(value);
      }
    }
  }

  if (!recent.length) {
    return "";
  }

  const last = recent[recent.length - 1];
  for (let index = recent.length - 2; index >= 0; index -= 1) {
    if (recent[index] !== last) {
      return recent[index];
    }
  }

  return last;
}

export function replaceWithSample() {
  const current = getCurrentProject();
  if (!current) return null;
  const replacement = cloneProject(sampleProject, false);
  replacement.id = current.id;
  replacement.createdAt = current.createdAt;
  upsertProject(replacement);
  return replacement;
}
