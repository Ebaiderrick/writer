import { STORAGE_KEY, state, TYPE_LABELS, DEFAULT_VIEW_OPTIONS, DEFAULT_LEFT_PANE_BLOCKS, DEFAULT_STORY_MEMORY } from './config.js';
import { uid, normalizeLineText, stripWrapperChars, clamp } from './utils.js';
import { refs } from './dom.js';
import { t } from './i18n.js';
import { auth, db } from './firebase.js';
import { doc, setDoc, deleteDoc, collection, getDocs, writeBatch, limit, query } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { Recovery } from './recovery.js';
import { logActivity, logEditActivity, ACTIVITY_CATEGORIES } from './activity.js';
import { showToast } from './toast.js';

let firestoreSyncTimer = null;
const SCRIPT_ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;

// Track last-synced version per project to skip redundant Firestore writes
const _syncedVersions = new Map();

function _membershipHash(project) {
  return Object.keys(project.collaborators || {}).sort().join(',') || 'none';
}

function _projectVersionKey(project) {
  return `${project.updatedAt}|${project.lines.length}|${project.title}|${_membershipHash(project)}`;
}

function generateScriptId() {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, byte => SCRIPT_ID_CHARS[byte % SCRIPT_ID_CHARS.length]).join("");
}

function normalizeScriptId(scriptId) {
  const value = String(scriptId || "").trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(value) ? value : generateScriptId();
}

function queueFirestoreSync() {
  clearTimeout(firestoreSyncTimer);
  firestoreSyncTimer = setTimeout(syncCurrentProjectToFirestore, 1500);
}

async function syncCurrentProjectToFirestore(attempt = 0) {
  const userId = auth.currentUser?.uid;
  if (!userId) return;
  const project = getCurrentProject();
  if (!project) return;

  // Skip sync if nothing has changed since the last successful write
  const versionKey = _projectVersionKey(project);
  if (_syncedVersions.get(project.id) === versionKey) return;

  // Ensure script identity exists for traceability
  if (!project.scriptId) {
    project.scriptId = generateScriptId();
  }

  const payload = { ...project, syncedAt: new Date().toISOString() };
  try {
  // Record word count progress before sync
  const currentWords = serializeScript(project).match(/\b[\w'-]+\b/g)?.length || 0;
  const currentScenes = project.lines.filter((line) => line.type === "scene" && line.text.trim()).length;
  const currentLines = project.lines.filter((line) => line.text.trim()).length;
  const currentPages = Math.max(1, Math.round((currentWords / 180) * 10) / 10);
  const history = project.wordCountHistory || [];
  const lastEntry = history[history.length - 1];
  const now = new Date().toISOString();

  if (!lastEntry || lastEntry.count !== currentWords) {
    history.push({
      timestamp: now,
      count: currentWords,
      uid: userId,
      userName: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
      scenes: currentScenes,
      lines: currentLines,
      pages: currentPages
    });
    // Keep last 50 entries
    if (history.length > 50) history.shift();
    project.wordCountHistory = history;
  }

    await setDoc(doc(db, 'users', userId, 'projects', project.id), payload);
    if (project.isShared) {
      // Skip shared project write for viewers — they have read-only access.
      // Check against the local collaborators map; Firestore rules enforce the same constraint.
      const isViewer = project.ownerId !== userId &&
        project.collaborators?.[userId]?.role === 'viewer';

      if (!isViewer) {
        // Only sync content fields — never overwrite ownership/membership on the shared doc.
        const CONTENT_KEYS = ['title', 'author', 'contact', 'company', 'details', 'logline',
        'lines', 'collapsedSceneIds', 'updatedAt', 'scriptId', 'wordCountHistory', 'storyMemory',
        'activityLog', 'lastEditorName', 'lastActivityAt', 'workspace'];
        const contentPayload = Object.fromEntries(
          CONTENT_KEYS.filter(k => k in payload).map(k => [k, payload[k]])
        );
        await setDoc(doc(db, 'sharedProjects', project.id), {
          ...contentPayload,
          syncedAt: new Date().toISOString(),
          updatedBy: userId,
          lastEditorName: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
          lastActivityAt: new Date().toISOString()
        }, { merge: true });
        logEditActivity(project.id).catch(() => {});
      }
    }

    // Update local storage with the new scriptId and notify UI
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.projects = state.projects;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    state.lastSaveSource = "remote";
    updateSaveBadge("saved", state.lastSavedAt || now);
    window.dispatchEvent(new CustomEvent('scriptIdUpdated', { detail: { projectId: project.id, scriptId: project.scriptId } }));
    _syncedVersions.set(project.id, versionKey);
    Recovery.clearOfflineSyncPending();

  } catch (err) {
    if (attempt < 2) {
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s then 4s
      setTimeout(() => syncCurrentProjectToFirestore(attempt + 1), delay);
    } else {
      console.error('Firestore sync failed after retries', err);
      Recovery.markOfflineSyncPending();
    }
  }
}

export async function fetchCloudProjects(userId) {
  const q = query(collection(db, 'users', userId, 'projects'), limit(200));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => sanitizeProject(d.data()));
}

export async function importLocalProjectsToCloud(userId, projects) {
  if (!projects.length) return;
  const now = new Date().toISOString();
  const BATCH_LIMIT = 499;
  let batch = writeBatch(db);
  let count = 0;

  for (const p of projects) {
    batch.set(doc(db, 'users', userId, 'projects', p.id), { ...p, syncedAt: now });
    count++;
    if (count === BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }

  if (count > 0) await batch.commit();
}

export async function deleteProjectFromCloud(projectId) {
  const userId = auth.currentUser?.uid;
  if (!userId) return;
  try {
    // Cascade-delete shared project document when the owner removes it.
    const project = state.projects.find(p => p.id === projectId);
    if (project?.isShared && (!project.ownerId || project.ownerId === userId)) {
      try {
        const token = await auth.currentUser.getIdToken();
        await fetch('/api/delete-shared-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ projectId })
        });
      } catch (err) {
        console.warn('[deleteProjectFromCloud] Cascade delete failed:', err.message);
      }
    }
    await deleteDoc(doc(db, 'users', userId, 'projects', projectId));
  } catch (err) {
    console.error('Firestore delete failed', err);
  }
}

export async function archiveProject(projectId) {
  const userId = auth.currentUser?.uid;
  if (!userId) return { ok: false, reason: 'Not signed in.' };

  const project = state.projects.find(p => p.id === projectId);
  if (!project) return { ok: false, reason: 'Project not found.' };

  const user = auth.currentUser;
  const now = new Date().toISOString();
  const archiveMeta = {
    isArchived: true,
    archivedAt: now,
    archivedBy: userId,
    archivedByName: user?.displayName || user?.email || 'Unknown',
    restoredAt: null,
    restoredBy: null
  };

  // Archive workspace siblings when the workspace root is archived.
  const workspaceId = project.workspace?.id || project.id;
  const toArchive = project.isWorkspaceRoot
    ? state.projects.filter(p => p.workspace?.id === workspaceId)
    : [project];

  toArchive.forEach(p => Object.assign(p, archiveMeta));

  try {
    for (const p of toArchive) {
      await setDoc(doc(db, 'users', userId, 'projects', p.id), archiveMeta, { merge: true });
    }
    if (project.isShared && (!project.ownerId || project.ownerId === userId)) {
      try {
        const token = await user.getIdToken();
        await fetch('/api/archive-shared-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ projectId })
        });
      } catch (err) {
        console.warn('[archiveProject] Server archive failed:', err.message);
      }
    }
    logActivity(projectId, `Archived "${project.title}".`, { category: ACTIVITY_CATEGORIES.system });
    persistProjects(false, { syncInputs: false });
    return { ok: true };
  } catch (err) {
    console.error('[archiveProject]', err);
    return { ok: false, reason: err.message || 'Archive failed.' };
  }
}

export async function restoreProject(projectId) {
  const userId = auth.currentUser?.uid;
  if (!userId) return { ok: false, reason: 'Not signed in.' };

  const project = state.projects.find(p => p.id === projectId);
  if (!project) return { ok: false, reason: 'Project not found.' };

  // Re-validate shared project membership before restoring.
  if (project.isShared) {
    const isOwner = !project.ownerId || project.ownerId === userId;
    const isCollaborator = Boolean(project.collaborators?.[userId]);
    if (!isOwner && !isCollaborator) {
      return { ok: false, reason: 'You are no longer a member of this shared project.' };
    }
  }

  const user = auth.currentUser;
  const now = new Date().toISOString();
  const restoreMeta = {
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    archivedByName: '',
    restoredAt: now,
    restoredBy: userId
  };

  const workspaceId = project.workspace?.id || project.id;
  const toRestore = project.isWorkspaceRoot
    ? state.projects.filter(p => p.workspace?.id === workspaceId)
    : [project];

  toRestore.forEach(p => Object.assign(p, restoreMeta));

  try {
    for (const p of toRestore) {
      await setDoc(doc(db, 'users', userId, 'projects', p.id), restoreMeta, { merge: true });
    }
    if (project.isShared && (!project.ownerId || project.ownerId === userId)) {
      try {
        const token = await user.getIdToken();
        await fetch('/api/restore-shared-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ projectId })
        });
      } catch (err) {
        console.warn('[restoreProject] Server restore failed:', err.message);
      }
    }
    logActivity(projectId, `Restored "${project.title}".`, { category: ACTIVITY_CATEGORIES.system });
    persistProjects(false, { syncInputs: false });
    return { ok: true };
  } catch (err) {
    console.error('[restoreProject]', err);
    return { ok: false, reason: err.message || 'Restore failed.' };
  }
}

export async function permanentlyDeleteProject(projectId) {
  const userId = auth.currentUser?.uid;
  if (!userId) return { ok: false, reason: 'Not signed in.' };

  const project = state.projects.find(p => p.id === projectId);
  if (!project) return { ok: false, reason: 'Project not found.' };
  if (!project.isArchived) return { ok: false, reason: 'Archive the project first before permanent deletion.' };

  const workspaceId = project.workspace?.id || project.id;
  const toDelete = project.isWorkspaceRoot
    ? state.projects.filter(p => p.workspace?.id === workspaceId)
    : [project];

  if (project.isWorkspaceRoot) {
    state.projects = state.projects.filter(p => p.workspace?.id !== workspaceId);
  } else {
    state.projects = state.projects.filter(p => p.id !== projectId);
  }

  // Ensure at least one active project remains.
  if (!state.projects.some(p => !p.isArchived)) {
    const fallback = createProjectWithOptions();
    state.projects.unshift(fallback);
  }

  if (toDelete.some(p => p.id === state.currentProjectId)) {
    state.currentProjectId = state.projects.find(p => !p.isArchived)?.id || state.projects[0]?.id || null;
  }
  if (project.isWorkspaceRoot && state.currentWorkspaceId === workspaceId) {
    state.currentWorkspaceId = null;
  }

  persistProjects(false, { syncInputs: false });
  for (const p of toDelete) {
    await deleteProjectFromCloud(p.id);
  }
  return { ok: true };
}

export function togglePinProject(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  project.isPinned = !project.isPinned;
  project.pinnedAt = project.isPinned ? new Date().toISOString() : null;
  persistProjects(false);
}

export function setProjectsFromCloud(cloudProjects) {
  state.projects = cloudProjects.length > 0 ? cloudProjects : [cloneProject(sampleProject, true)];
  state.currentProjectId = state.projects[0].id;
  state.currentEditorId = null;
  const savedAt = new Date().toISOString();
  state.lastSavedAt = savedAt;
  state.lastSaveSource = "remote";
  try {
    const payload = buildPersistencePayload(savedAt);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(payload));
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
    const parsed = chooseLatestPayload(parseStoredPayload(STORAGE_KEY), parseStoredPayload(RECOVERY_KEY));
    state.projects = Array.isArray(parsed?.projects) && parsed.projects.length
      ? parsed.projects.map(sanitizeProject)
      : [cloneProject(sampleProject, true)];
    state.currentProjectId = parsed?.currentProjectId || state.projects[0].id;
    state.currentEditorId = typeof parsed?.currentEditorId === "string" ? parsed.currentEditorId : null;
    state.aiAssist = Boolean(parsed?.aiAssist);
      state.toolStripCollapsed = Boolean(parsed?.toolStripCollapsed);
      state.autoNumberScenes = Boolean(parsed?.autoNumberScenes);
      state.backgroundAnimation = Boolean(parsed?.backgroundAnimation);
      state.theme = parsed?.theme === "rose" ? "cedar" : (parsed?.theme || "cedar");
      state.language = ["en", "fr", "de"].includes(parsed?.language) ? parsed.language : "en";
      state.writingLanguage = ["en", "fr", "de"].includes(parsed?.writingLanguage) ? parsed.writingLanguage : state.language;
      state.grammarCheck = Boolean(parsed?.grammarCheck);
      state.localBackupEnabled = Boolean(parsed?.localBackupEnabled);
      state.localSaveIntervalMinutes = [5, 10, 60].includes(parsed?.localSaveIntervalMinutes) ? parsed.localSaveIntervalMinutes : 5;
      state.backupPrompted = Boolean(parsed?.backupPrompted);
      state.viewOptions = sanitizeViewOptions(parsed?.viewOptions);
    state.lastSavedAt = parsed?.savedAt || "";
    state.lastSaveSource = state.localBackupEnabled ? "local" : "remote";
    state.leftPaneBlocks = sanitizeLeftPaneBlocks(parsed?.leftPaneBlocks);
    document.documentElement.style.setProperty("--left-pane-width", `${clamp(parsed?.leftWidth || 286, 220, 460)}px`);
    document.documentElement.style.setProperty("--right-pane-width", `${clamp(parsed?.rightWidth || 324, 260, 520)}px`);
  } catch (error) {
    console.error("Unable to load projects", error);
      state.projects = [cloneProject(sampleProject, true)];
      state.currentProjectId = state.projects[0].id;
      state.currentEditorId = null;
      state.backgroundAnimation = false;
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
    scriptId: normalizeScriptId(project.scriptId),
    title: project.title || "Untitled Script",
    workType: project.workType === "prose-poetry" ? "prose-poetry" : "film-script",
    creationKind: project.creationKind === "editor" ? "editor" : "project",
    isEditorRoot: Boolean(project.isEditorRoot),
    author: project.author || "",
    contact: project.contact || "",
    company: project.company || "",
    details: project.details || "",
    logline: project.logline || "",
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
    isShared: Boolean(project.isShared),
    isArchived: Boolean(project.isArchived),
    archivedAt: project.archivedAt || null,
    archivedBy: project.archivedBy || null,
    archivedByName: project.archivedByName || '',
    restoredAt: project.restoredAt || null,
    restoredBy: project.restoredBy || null,
    isPinned: Boolean(project.isPinned),
    pinnedAt: project.pinnedAt || null,
    ownerId: project.ownerId || null,
    storyMemory: sanitizeStoryMemory(project.storyMemory),
    activityLog: Array.isArray(project.activityLog) ? project.activityLog : [],
    ownerName: project.ownerName || "",
    ownerEmail: project.ownerEmail || "",
    ownerPhotoURL: project.ownerPhotoURL || "",
    lastEditorName: project.lastEditorName || "",
    lastActivityAt: project.lastActivityAt || project.updatedAt || new Date().toISOString(),
    editor: sanitizeEditor(project.editor, project),
    collaborators: sanitizeCollaborators(project.collaborators),
    collapsedSceneIds: Array.isArray(project.collapsedSceneIds) ? [...new Set(project.collapsedSceneIds)] : [],
    wordCountHistory: Array.isArray(project.wordCountHistory) ? project.wordCountHistory : [],
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
    scriptId: withNewId ? generateScriptId() : project.scriptId,
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
  return createProjectWithOptions();
}

export function createProjectWithOptions(options = {}) {
  const creationKind = options.creationKind === "editor" ? "editor" : "project";
  const workType = options.workType === "prose-poetry" ? "prose-poetry" : "film-script";
  const isEditorRoot = Boolean(options.isEditorRoot);
  const editorSeed = options.editor && typeof options.editor === "object" ? options.editor : null;
  const peerProjects = state.projects.filter((project) => {
    if (creationKind === "editor" || isEditorRoot) {
      return project.isEditorRoot;
    }
    if (editorSeed?.id) {
      return !project.isEditorRoot && project.editor?.id === editorSeed.id;
    }
    return !project.isEditorRoot && project.editor?.id === project.id;
  });
  const index = peerProjects.length + 1;
  const defaultTitle = creationKind === "editor"
    ? `Film Editor ${index}`
    : `Film Script ${index}`;
  const project = sanitizeProject({
    id: uid("project"),
    title: options.title || defaultTitle,
    workType,
    creationKind,
    isEditorRoot,
    editor: editorSeed ? {
      ...editorSeed,
      name: options.editorName || editorSeed.name || `Editor ${index}`
    } : {
      name: options.editorName || (creationKind === "editor" ? defaultTitle : `Editor ${index}`)
    },
    lines: [{ id: uid(), type: "action", text: "" }]
  });
  upsertProject(project);
  persistProjects(true);
  // Fire-and-forget: records creation in the project's own timeline.
  logActivity(project.id, `Created "${project.title}".`, { category: ACTIVITY_CATEGORIES.system });
  return project;
}

export function getCurrentProject() {
  return state.projects.find((project) => project.id === state.currentProjectId) || null;
}

export function getEditorProjects(editorId) {
  return state.projects.filter((project) => project.editor?.id === editorId);
}

export function getEditorRootProject(editorId) {
  return state.projects.find((project) => project.editor?.id === editorId && project.isEditorRoot) || null;
}

export function updateEditorAcrossProjects(editorId, updaterFn) {
  if (!editorId) return;
  state.projects = state.projects.map(project => {
    if (project.editor?.id !== editorId) return project;
    return { ...project, editor: updaterFn(project.editor) };
  });
}

export function getOwnedProjects(userId) {
  const id = userId || auth.currentUser?.uid;
  return state.projects.filter(p => !p.isArchived && (!p.isShared || !p.ownerId || p.ownerId === id));
}

export function getSharedProjects(userId) {
  const id = userId || auth.currentUser?.uid;
  return state.projects.filter(p => !p.isArchived && p.isShared && p.ownerId && p.ownerId !== id);
}

export function getArchivedProjects() {
  return state.projects.filter(p => p.isArchived);
}

export function updateWorkspaceAcrossProjects(workspaceId, updater) {
  let changed = false;
  state.projects = state.projects.map((project) => {
    if (project.editor?.id !== editorId) {
      return project;
    }
    const nextEditor = updater({ ...(project.editor || {}) }, project);
    changed = true;
    return sanitizeProject({
      ...project,
      editor: nextEditor || project.editor,
      updatedAt: new Date().toISOString()
    });
  });
  return changed;
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

export function persistProjects(forceSavedBadge = false, { syncInputs = true } = {}) {
  if (syncInputs) syncProjectFromInputs();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentProjectId: state.currentProjectId,
      currentWorkspaceId: state.currentWorkspaceId,
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
        backupPrompted: state.backupPrompted,
        viewOptions: state.viewOptions,
      leftPaneBlocks: state.leftPaneBlocks,
      leftWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-pane-width"), 10),
      rightWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--right-pane-width"), 10)
    }));
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      showToast('Local storage is full — your work is syncing to the cloud only. Export a backup to be safe.', 'warning', 8000);
    }
  }
  Recovery.writeSnapshot(state.projects);
  if (refs.saveBadge) {
    const offline = !Recovery.isOnline();
    if (offline) {
      refs.saveBadge.textContent = t("save.savedLocal");
      refs.saveBadge.classList.remove("saving");
      refs.saveBadge.classList.add("is-saved", "is-offline");
    } else {
      refs.saveBadge.textContent = forceSavedBadge ? t("save.savedLocal") : t("save.saved");
      refs.saveBadge.classList.remove("saving", "is-offline");
      refs.saveBadge.classList.add("is-saved");
    }
  }
  queueFirestoreSync();
}

export function queueSave() {
  updateSaveBadge("saving");
  writeRecoverySnapshot();
  clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    persistProjects(false);
    pushHistory();
  }, 1200);
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
  Recovery.persistHistory(state.currentProjectId);
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

function sanitizeStoryMemory(storyMemory) {
  return {
    characters: Array.isArray(storyMemory?.characters) ? storyMemory.characters : [],
    locations: Array.isArray(storyMemory?.locations) ? storyMemory.locations : [],
    scenes: Array.isArray(storyMemory?.scenes) ? storyMemory.scenes : [],
    themes: Array.isArray(storyMemory?.themes) ? storyMemory.themes : [],
    plotPoints: Array.isArray(storyMemory?.plotPoints) ? storyMemory.plotPoints : []
  };
}

function sanitizeEditor(editor, project) {
  return {
    id: editor?.id || project.id || uid("editor"),
    name: String(editor?.name || project.title || "Team Editor").trim() || "Team Editor",
    inviteCode: String(editor?.inviteCode || project.scriptId || generateScriptId()).trim().toUpperCase(),
    reminders: sanitizeEditorReminders(editor?.reminders),
    targets: sanitizeEditorTargets(editor?.targets),
    tasks: sanitizeEditorTasks(editor?.tasks),
    notifications: sanitizeEditorNotifications(editor?.notifications)
  };
}

function sanitizeEditorReminders(reminders) {
  if (!Array.isArray(reminders)) {
    return [];
  }

  return reminders.map((reminder, index) => ({
    id: reminder?.id || uid(`rem-${index}`),
    text: String(reminder?.text || "").trim(),
    dueAt: reminder?.dueAt || "",
    completed: Boolean(reminder?.completed),
    createdAt: reminder?.createdAt || new Date().toISOString(),
    updatedAt: reminder?.updatedAt || reminder?.createdAt || new Date().toISOString(),
    createdByName: reminder?.createdByName || ""
  })).filter((reminder) => reminder.text);
}

function sanitizeEditorTargets(targets) {
  return {
    scenes: clamp(Number(targets?.scenes || 0), 0, 9999),
    pages: clamp(Number(targets?.pages || 0), 0, 9999),
    lines: clamp(Number(targets?.lines || 0), 0, 99999)
  };
}

function sanitizeEditorTasks(tasks) {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.map((task, index) => ({
    id: task?.id || uid(`task-${index}`),
    templateKey: String(task?.templateKey || "custom").trim() || "custom",
    priority: ["low", "normal", "high"].includes(task?.priority) ? task.priority : "normal",
    title: String(task?.title || "").trim(),
    description: String(task?.description || "").trim(),
    status: ["todo", "in-progress", "done"].includes(task?.status) ? task.status : "todo",
    dueAt: task?.dueAt || "",
    assignedTo: String(task?.assignedTo || "").trim(),
    assignedLabel: String(task?.assignedLabel || "").trim(),
    assigneeType: task?.assigneeType === "system" ? "system" : "human",
    handoffNote: String(task?.handoffNote || "").trim(),
    projectId: String(task?.projectId || "").trim(),
    reference: String(task?.reference || "").trim(),
    sceneId: String(task?.sceneId || "").trim(),
    sceneLabel: String(task?.sceneLabel || "").trim(),
    lineId: String(task?.lineId || "").trim(),
    lineLabel: String(task?.lineLabel || "").trim(),
    memoryLinkType: String(task?.memoryLinkType || "").trim(),
    memoryLinkId: String(task?.memoryLinkId || "").trim(),
    memoryLinkName: String(task?.memoryLinkName || "").trim(),
    memoryProjectId: String(task?.memoryProjectId || "").trim(),
    comments: Array.isArray(task?.comments) ? task.comments.map((comment, commentIndex) => ({
      id: comment?.id || uid(`task-comment-${commentIndex}`),
      text: String(comment?.text || "").trim(),
      author: String(comment?.author || "").trim(),
      mentionId: String(comment?.mentionId || "").trim(),
      mentionLabel: String(comment?.mentionLabel || "").trim(),
      createdAt: comment?.createdAt || new Date().toISOString()
    })).filter((comment) => comment.text) : [],
    aiState: ["idle", "scheduled", "ready", "running", "review", "applied", "dismissed", "failed"].includes(task?.aiState) ? task.aiState : "idle",
    aiStartAt: task?.aiStartAt || "",
    aiLastRunAt: task?.aiLastRunAt || "",
    aiResultText: String(task?.aiResultText || "").trim(),
    aiResultSummary: String(task?.aiResultSummary || "").trim(),
    aiError: String(task?.aiError || "").trim(),
    lastApplyMode: ["insert-below", "replace-target", "append-scene"].includes(task?.lastApplyMode) ? task.lastApplyMode : "insert-below",
    createdAt: task?.createdAt || new Date().toISOString(),
    updatedAt: task?.updatedAt || task?.createdAt || new Date().toISOString(),
    createdByName: String(task?.createdByName || "").trim()
  })).filter((task) => task.title);
}

function sanitizeEditorNotifications(notifications) {
  if (!Array.isArray(notifications)) {
    return [];
  }

  return notifications.map((notification, index) => ({
    id: notification?.id || uid(`note-${index}`),
    taskId: String(notification?.taskId || "").trim(),
    projectId: String(notification?.projectId || "").trim(),
    category: String(notification?.category || "update").trim() || "update",
    title: String(notification?.title || "").trim(),
    message: String(notification?.message || "").trim(),
    actor: String(notification?.actor || "").trim(),
    createdAt: notification?.createdAt || new Date().toISOString(),
    read: Boolean(notification?.read)
  })).filter((notification) => notification.title || notification.message);
}

function sanitizeCollaborators(collaborators) {
  if (!collaborators || typeof collaborators !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(collaborators).map(([uid, collaborator]) => [uid, {
      ...collaborator,
      role: collaborator?.role === "viewer" ? "viewer" : "editor"
    }])
  );
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

  for (let index = 0; index < contextIndex; index += 1) {
    const line = project.lines[index];
    if ((line?.type === "character" || line?.type === "dual") && line.text.trim()) {
      const value = normalizeLineText(line.text, line.type);
      if (recent[recent.length - 1] !== value) {
        recent.push(value);
      }
    }
    if (line?.type === "dual" && line.secondary?.trim()) {
      const value = normalizeLineText(line.secondary, "dual");
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

