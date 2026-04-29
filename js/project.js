import { STORAGE_KEY, state, TYPE_LABELS, DEFAULT_VIEW_OPTIONS, DEFAULT_LEFT_PANE_BLOCKS } from './config.js';
import { uid, normalizeLineText, stripWrapperChars, clamp } from './utils.js';
import { refs } from './dom.js';
import { t } from './i18n.js';
import { auth, db } from './firebase.js';
import { doc, setDoc, deleteDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let firestoreSyncTimer = null;

function queueFirestoreSync() {
  clearTimeout(firestoreSyncTimer);
  firestoreSyncTimer = setTimeout(syncCurrentProjectToFirestore, 1500);
}

async function syncCurrentProjectToFirestore() {
  const userId = auth.currentUser?.uid;
  if (!userId) return;
  const project = getCurrentProject();
  if (!project) return;
  const payload = { ...project, syncedAt: new Date().toISOString() };
  try {
    await setDoc(doc(db, 'users', userId, 'projects', project.id), payload);
    if (project.isShared) {
      // Only sync content fields — never overwrite ownership/membership on the shared doc.
      const CONTENT_KEYS = ['title', 'author', 'contact', 'company', 'details', 'logline',
        'lines', 'collapsedSceneIds', 'updatedAt'];
      const contentPayload = Object.fromEntries(
        CONTENT_KEYS.filter(k => k in payload).map(k => [k, payload[k]])
      );
      await setDoc(doc(db, 'sharedProjects', project.id), {
        ...contentPayload,
        syncedAt: new Date().toISOString(),
        updatedBy: userId
      }, { merge: true });
    }
  } catch (err) {
    console.error('Firestore sync failed', err);
  }
}

export async function fetchCloudProjects(userId) {
  const snapshot = await getDocs(collection(db, 'users', userId, 'projects'));
  return snapshot.docs.map(d => sanitizeProject(d.data()));
}

export async function importLocalProjectsToCloud(userId, projects) {
  for (const p of projects) {
    await setDoc(doc(db, 'users', userId, 'projects', p.id), {
      ...p,
      syncedAt: new Date().toISOString()
    });
  }
}

export async function deleteProjectFromCloud(projectId) {
  const userId = auth.currentUser?.uid;
  if (!userId) return;
  try {
    await deleteDoc(doc(db, 'users', userId, 'projects', projectId));
  } catch (err) {
    console.error('Firestore delete failed', err);
  }
}

export function setProjectsFromCloud(cloudProjects) {
  state.projects = cloudProjects.length > 0 ? cloudProjects : [cloneProject(sampleProject, true)];
  state.currentProjectId = state.projects[0].id;
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...existing,
      currentProjectId: state.currentProjectId,
      projects: state.projects
    }));
  } catch (err) {
    console.error('Failed to cache cloud projects locally', err);
  }
}

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
      state.backgroundAnimation = parsed?.backgroundAnimation !== false;
      state.theme = parsed?.theme === "rose" ? "cedar" : (parsed?.theme || "cedar");
      state.language = ["en", "fr", "de"].includes(parsed?.language) ? parsed.language : "en";
      state.writingLanguage = ["en", "fr", "de"].includes(parsed?.writingLanguage) ? parsed.writingLanguage : state.language;
      state.grammarCheck = Boolean(parsed?.grammarCheck);
      state.localBackupEnabled = Boolean(parsed?.localBackupEnabled);
      state.localSaveIntervalMinutes = [5, 10, 60].includes(parsed?.localSaveIntervalMinutes) ? parsed.localSaveIntervalMinutes : 5;
      state.viewOptions = sanitizeViewOptions(parsed?.viewOptions);
    state.leftPaneBlocks = sanitizeLeftPaneBlocks(parsed?.leftPaneBlocks);
    document.documentElement.style.setProperty("--left-pane-width", `${clamp(parsed?.leftWidth || 286, 220, 460)}px`);
    document.documentElement.style.setProperty("--right-pane-width", `${clamp(parsed?.rightWidth || 324, 260, 520)}px`);
  } catch (error) {
    console.error("Unable to load projects", error);
      state.projects = [cloneProject(sampleProject, true)];
      state.currentProjectId = state.projects[0].id;
      state.backgroundAnimation = true;
      state.language = "en";
      state.writingLanguage = "en";
      state.grammarCheck = false;
      state.viewOptions = { ...DEFAULT_VIEW_OPTIONS };
    state.leftPaneBlocks = DEFAULT_LEFT_PANE_BLOCKS.map((block) => ({ ...block }));
  }
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
    isShared: Boolean(project.isShared),
    ownerId: project.ownerId || null,
    ownerName: project.ownerName || "",
    ownerEmail: project.ownerEmail || "",
    collaborators: (project.collaborators && typeof project.collaborators === 'object') ? project.collaborators : {},
    collapsedSceneIds: Array.isArray(project.collapsedSceneIds) ? [...new Set(project.collapsedSceneIds)] : [],
    lines: Array.isArray(project.lines) && project.lines.length
      ? project.lines.map((line) => {
          const type = TYPE_LABELS[line.type] ? line.type : "action";
          const sanitized = {
            id: line.id || uid(),
            type,
            text: normalizeLineText(line.text || "", type)
          };
          if (typeof line.secondary === "string") {
            sanitized.secondary = normalizeLineText(line.secondary, type);
          }
          return sanitized;
        })
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
    lines: project.lines.map((line) => {
      const cloned = { id: uid(), type: line.type, text: line.text };
      if (typeof line.secondary === "string") cloned.secondary = line.secondary;
      return cloned;
    })
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
      backgroundAnimation: state.backgroundAnimation,
      theme: state.theme,
      language: state.language,
      writingLanguage: state.writingLanguage,
      grammarCheck: state.grammarCheck,
      localBackupEnabled: state.localBackupEnabled,
      localSaveIntervalMinutes: state.localSaveIntervalMinutes,
      viewOptions: state.viewOptions,
    leftPaneBlocks: state.leftPaneBlocks,
    leftWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-pane-width"), 10),
    rightWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--right-pane-width"), 10)
  }));
  if (refs.saveBadge) {
      refs.saveBadge.textContent = forceSavedBadge ? t("save.savedLocal") : t("save.saved");
  }
  queueFirestoreSync();
}

export function queueSave() {
  if (refs.saveBadge) {
      refs.saveBadge.textContent = t("save.saving");
  }
  clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    persistProjects(false);
    pushHistory();
  }, 200);
}

export function pushHistory() {
  const project = getCurrentProject();
  if (!project) return;

  // Clone the current state
  const snapshot = project.lines.map(l => ({ ...l }));

  // If we're pushing a new state that is identical to the current history state, skip
  if (state.historyIndex >= 0) {
    const last = state.history[state.historyIndex];
    if (JSON.stringify(last) === JSON.stringify(snapshot)) return;
  }

  // Truncate any "redo" history if we're in the middle of the stack
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }

  state.history.push(snapshot);

  // Limit to 30 undos (31 items total: current + 30 previous)
  if (state.history.length > 31) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }
}

export function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreFromHistory();
}

export function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  restoreFromHistory();
}

function restoreFromHistory() {
  const project = getCurrentProject();
  const snapshot = state.history[state.historyIndex];
  if (!project || !snapshot) return;

  project.lines = snapshot.map(l => ({ ...l }));
  project.updatedAt = new Date().toISOString();

  // We need to import renderStudio here or pass it in.
  // Since project.js is a low-level module, we'll rely on the caller to re-render.
  // But wait, many functions in project.js are called and then renderStudio is called in events.js.
  // Let's just update the state and let the event handler handle the render.
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
    ruler: false,
    pageNumbers: options?.pageNumbers === undefined ? true : Boolean(options.pageNumbers),
    pageCount: false,
    showOutline: true,
    textSize: clamp(options?.textSize ?? DEFAULT_VIEW_OPTIONS.textSize, 11, 14)
  };
}

export function sanitizeLeftPaneBlocks(blocks) {
  const defaults = new Map(DEFAULT_LEFT_PANE_BLOCKS.map((block) => [block.key, block]));
  const seen = new Set();
  const sanitized = [];

  if (Array.isArray(blocks)) {
    blocks.forEach((block) => {
      const key = block?.key;
      if (!defaults.has(key) || seen.has(key)) {
        return;
      }
        seen.add(key);
        sanitized.push({
          key,
          visible: key === "current" ? true : (block.visible === undefined ? defaults.get(key).visible : Boolean(block.visible)),
          collapsed: Boolean(block.collapsed)
        });
      });
  }

  DEFAULT_LEFT_PANE_BLOCKS.forEach((block) => {
    if (seen.has(block.key)) {
      return;
    }
    sanitized.push({
      ...block,
      visible: block.key === "current" ? true : block.visible
    });
  });

  return sanitized;
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
