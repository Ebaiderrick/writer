import { STORAGE_KEY, state, TYPE_LABELS, DEFAULT_VIEW_OPTIONS, DEFAULT_LEFT_PANE_BLOCKS, DEFAULT_STORY_MEMORY } from './config.js';
import { uid, normalizeLineText, stripWrapperChars, clamp } from './utils.js';
import { refs } from './dom.js';
import { t } from './i18n.js';
import { auth, db } from './firebase.js';
import { doc, setDoc, deleteDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let firestoreSyncTimer = null;
const SCRIPT_ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
const SAVE_RETRY_KEY = `${STORAGE_KEY}:save-retry`;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SNAPSHOT_INTERVAL_MS = 3 * 60 * 1000;

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

function buildPersistencePayload(savedAt = new Date().toISOString()) {
  return {
    savedAt,
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
    homeProjectSearch: state.homeProjectSearch,
    leftWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-pane-width"), 10),
    rightWidth: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--right-pane-width"), 10)
  };
}

function parseStoredPayload(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error(`Unable to parse storage payload for ${key}`, error);
    return null;
  }
}

function chooseLatestPayload(primary, recovery) {
  const primaryAt = new Date(primary?.savedAt || 0).getTime() || 0;
  const recoveryAt = new Date(recovery?.savedAt || 0).getTime() || 0;
  if (recoveryAt > primaryAt) {
    state.pendingRecoveryNotice = true;
    return recovery;
  }
  state.pendingRecoveryNotice = false;
  return primary;
}

function loadRetryQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVE_RETRY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistRetryQueue(queue) {
  localStorage.setItem(SAVE_RETRY_KEY, JSON.stringify(queue));
}

function ensureRetrySaveButton() {
  if (!refs.saveMetaText?.parentElement) return null;
  let button = document.getElementById('retrySaveBtn');
  if (button) return button;
  button = document.createElement('button');
  button.id = 'retrySaveBtn';
  button.type = 'button';
  button.className = 'ghost-button btn-sm';
  button.textContent = 'Retry failed save';
  button.hidden = true;
  button.addEventListener('click', () => {
    retryFailedSaves().catch((error) => console.error('Retry save failed', error));
  });
  refs.saveMetaText.parentElement.appendChild(button);
  return button;
}

function updateSaveBadge(mode = "saved", savedAt = state.lastSavedAt, detail = "") {
  if (!refs.saveBadge) return;
  refs.saveBadge.classList.remove("saving", "is-saved", "is-local", "is-error");
  const retryButton = ensureRetrySaveButton();
  if (retryButton) retryButton.hidden = true;
  const formattedTime = savedAt
    ? new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  if (mode === "saving") {
    refs.saveBadge.textContent = t("save.saving");
    refs.saveBadge.classList.add("saving");
  } else if (mode === "offline") {
    refs.saveBadge.textContent = "Connection lost";
    refs.saveBadge.classList.add("saving", "is-error");
  } else if (mode === "failed") {
    refs.saveBadge.textContent = "Save failed";
    refs.saveBadge.classList.add("is-error");
    if (retryButton) retryButton.hidden = false;
  } else {
    refs.saveBadge.textContent = mode === "local" ? t("save.savedLocal") : t("save.saved");
    refs.saveBadge.classList.add("is-saved");
    if (mode === "local") refs.saveBadge.classList.add("is-local");
  }
  refs.saveBadge.title = savedAt
    ? `Last saved ${new Date(savedAt).toLocaleString()}`
    : "";
  if (refs.saveMetaText) {
    if (mode === "saving") {
      refs.saveMetaText.textContent = formattedTime
        ? `Saving changes... Last saved at ${formattedTime}.`
        : "Saving changes...";
    } else if (mode === "offline") {
      refs.saveMetaText.textContent = detail || "Connection lost. Your changes are cached locally and will retry when you reconnect.";
    } else if (mode === "failed") {
      refs.saveMetaText.textContent = detail || "A cloud save failed. Your changes are safe locally and waiting to retry.";
    } else if (mode === "local") {
      refs.saveMetaText.textContent = formattedTime
        ? `Saved locally at ${formattedTime}.`
        : "Saved locally.";
    } else {
      refs.saveMetaText.textContent = formattedTime
        ? `Saved at ${formattedTime}.`
        : "All changes synced.";
    }
  }
}

function writeRecoverySnapshot({ syncInputs = false } = {}) {
  if (syncInputs) syncProjectFromInputs();
  const savedAt = new Date().toISOString();
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(buildPersistencePayload(savedAt)));
}

function buildVersionSnapshot(project, label = "Auto snapshot") {
  return {
    id: uid('ver'),
    label,
    version: Number(project.version || 0),
    title: project.title || "Untitled Script",
    logline: project.logline || "",
    details: project.details || "",
    tags: Array.isArray(project.tags) ? [...project.tags] : [],
    lines: Array.isArray(project.lines) ? project.lines.map((line) => ({ ...line })) : [],
    createdAt: new Date().toISOString(),
    editorUid: auth.currentUser?.uid || '',
    editorName: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown'
  };
}

export function captureVersionSnapshot(project = getCurrentProject(), { force = false, label = "Auto snapshot" } = {}) {
  if (!project) return false;
  const history = Array.isArray(project.versionHistory) ? project.versionHistory : [];
  const lastSnapshot = history[history.length - 1];
  const now = Date.now();
  const lastAt = lastSnapshot ? new Date(lastSnapshot.createdAt).getTime() : 0;
  const currentSerialized = JSON.stringify({
    title: project.title,
    logline: project.logline,
    details: project.details,
    tags: project.tags || [],
    lines: project.lines || []
  });
  const lastSerialized = lastSnapshot ? JSON.stringify({
    title: lastSnapshot.title,
    logline: lastSnapshot.logline,
    details: lastSnapshot.details,
    tags: lastSnapshot.tags || [],
    lines: lastSnapshot.lines || []
  }) : '';

  if (!force) {
    if (lastSerialized === currentSerialized) return false;
    if (now - lastAt < SNAPSHOT_INTERVAL_MS) return false;
  } else if (lastSerialized === currentSerialized) {
    return false;
  }

  project.versionHistory = [...history, buildVersionSnapshot(project, label)].slice(-30);
  project.lastVersionSnapshotAt = new Date().toISOString();
  return true;
}

function enqueueFailedSave(project) {
  if (!project) return;
  const queue = loadRetryQueue().filter((entry) => entry.projectId !== project.id);
  queue.push({
    projectId: project.id,
    project,
    failedAt: new Date().toISOString()
  });
  persistRetryQueue(queue.slice(-10));
}

async function syncCurrentProjectToFirestore() {
  const userId = auth.currentUser?.uid;
  if (!userId) return;
  const project = getCurrentProject();
  if (!project) return;

  // Ensure script identity exists for traceability
  if (!project.scriptId) {
    project.scriptId = generateScriptId();
  }

  const payload = { ...project, syncedAt: new Date().toISOString() };
  if (!navigator.onLine) {
    enqueueFailedSave(payload);
    updateSaveBadge("offline", state.lastSavedAt, "Connection lost. Your changes are cached locally and will retry when you reconnect.");
    return;
  }
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

    project.last_edited_by = userId;
    project.last_edited_at = now;
    project.lastEditedBy = userId;
    project.lastEditedAt = now;
    captureVersionSnapshot(project, { label: "Auto snapshot" });

    const nextVersion = Number(project.version || 0) + 1;
    project.version = nextVersion;
    payload.version = nextVersion;
    payload.last_edited_by = project.last_edited_by;
    payload.last_edited_at = project.last_edited_at;
    payload.lastEditedBy = project.lastEditedBy;
    payload.lastEditedAt = project.lastEditedAt;
    payload.versionHistory = project.versionHistory || [];
    await setDoc(doc(db, 'users', userId, 'projects', project.id), payload);
    if (project.isShared) {
      // Only sync content fields — never overwrite ownership/membership on the shared doc.
      const CONTENT_KEYS = ['title', 'author', 'contact', 'company', 'details', 'logline',
      'lines', 'collapsedSceneIds', 'updatedAt', 'scriptId', 'wordCountHistory', 'storyMemory',
      'activityLog', 'lastEditorName', 'lastActivityAt', 'workspace', 'version',
      'versionHistory', 'created_by', 'last_edited_by', 'last_edited_at', 'visibility', 'tags',
      'createdBy', 'lastEditedBy', 'lastEditedAt', 'isTrashed', 'trashedAt', 'restoreUntil'];
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
      await setDoc(doc(collection(db, 'sharedProjects', project.id, 'versions')), {
        version: nextVersion,
        projectId: project.id,
        workspaceId: project.workspace?.id || project.id,
        editorUid: userId,
        editorName: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
        createdAt: new Date().toISOString(),
        title: project.title,
        updatedAt: project.updatedAt,
        lines: project.lines
      });
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
    persistRetryQueue(loadRetryQueue().filter((entry) => entry.projectId !== project.id));
    window.dispatchEvent(new CustomEvent('scriptIdUpdated', { detail: { projectId: project.id, scriptId: project.scriptId } }));

  } catch (err) {
    console.error('Firestore sync failed', err);
    enqueueFailedSave(payload);
    updateSaveBadge("failed", state.lastSavedAt, "A cloud save failed. Your changes are safe locally and waiting to retry.");
  }
}

export async function fetchCloudProjects(userId) {
  const snapshot = await getDocs(collection(db, 'users', userId, 'projects'));
  return snapshot.docs
    .map(d => sanitizeProject(d.data()))
    .filter((project) => canCurrentUserAccessProject(project));
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
  state.currentWorkspaceId = null;
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
    state.currentWorkspaceId = typeof parsed?.currentWorkspaceId === "string" ? parsed.currentWorkspaceId : null;
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
    state.homeProjectSearch = String(parsed?.homeProjectSearch || "");
    state.lastSavedAt = parsed?.savedAt || "";
    state.lastSaveSource = state.localBackupEnabled ? "local" : "remote";
    state.leftPaneBlocks = sanitizeLeftPaneBlocks(parsed?.leftPaneBlocks);
    document.documentElement.style.setProperty("--left-pane-width", `${clamp(parsed?.leftWidth || 286, 220, 460)}px`);
    document.documentElement.style.setProperty("--right-pane-width", `${clamp(parsed?.rightWidth || 324, 260, 520)}px`);
  } catch (error) {
    console.error("Unable to load projects", error);
      state.projects = [cloneProject(sampleProject, true)];
      state.currentProjectId = state.projects[0].id;
      state.currentWorkspaceId = null;
      state.backgroundAnimation = false;
      state.language = "en";
      state.writingLanguage = "en";
      state.grammarCheck = false;
      state.viewOptions = { ...DEFAULT_VIEW_OPTIONS };
      state.homeProjectSearch = "";
    state.leftPaneBlocks = DEFAULT_LEFT_PANE_BLOCKS.map((block) => ({ ...block }));
  }
}

export function sanitizeProject(project) {
  const now = new Date().toISOString();
  const userId = auth.currentUser?.uid || '';
  const createdBy = project.created_by || project.createdBy || project.ownerId || userId;
  const lastEditedBy = project.last_edited_by || project.lastEditedBy || project.ownerId || createdBy;
  const lastEditedAt = project.last_edited_at || project.lastEditedAt || project.updatedAt || now;
  const visibility = ['private', 'workspace', 'shared'].includes(project.visibility)
    ? project.visibility
    : (project.isShared ? 'shared' : 'private');
  const trashedAt = project.trashedAt || "";
  return {
    id: project.id || uid("project"),
    scriptId: normalizeScriptId(project.scriptId),
    title: project.title || "Untitled Script",
    workType: project.workType === "prose-poetry" ? "prose-poetry" : "film-script",
    creationKind: project.creationKind === "workspace" ? "workspace" : "project",
    isWorkspaceRoot: Boolean(project.isWorkspaceRoot),
    author: project.author || "",
    contact: project.contact || "",
    company: project.company || "",
    details: project.details || "",
    logline: project.logline || "",
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
    created_by: createdBy,
    last_edited_by: lastEditedBy,
    last_edited_at: lastEditedAt,
    createdBy,
    lastEditedBy: lastEditedBy,
    lastEditedAt,
    visibility,
    tags: Array.isArray(project.tags) ? project.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 12) : [],
    isShared: Boolean(project.isShared),
    isTrashed: Boolean(project.isTrashed),
    trashedAt,
    restoreUntil: project.restoreUntil || (trashedAt ? new Date(new Date(trashedAt).getTime() + TRASH_RETENTION_MS).toISOString() : ""),
    ownerId: project.ownerId || null,
    storyMemory: sanitizeStoryMemory(project.storyMemory),
    activityLog: Array.isArray(project.activityLog) ? project.activityLog : [],
    ownerName: project.ownerName || "",
    ownerEmail: project.ownerEmail || "",
    ownerPhotoURL: project.ownerPhotoURL || "",
    lastEditorName: project.lastEditorName || "",
    lastActivityAt: project.lastActivityAt || project.updatedAt || new Date().toISOString(),
    workspace: sanitizeWorkspace(project.workspace, project),
    collaborators: sanitizeCollaborators(project.collaborators),
    collapsedSceneIds: Array.isArray(project.collapsedSceneIds) ? [...new Set(project.collapsedSceneIds)] : [],
    wordCountHistory: Array.isArray(project.wordCountHistory) ? project.wordCountHistory : [],
    version: Number.isFinite(Number(project.version)) ? Number(project.version) : 0,
    versionHistory: Array.isArray(project.versionHistory) ? project.versionHistory : [],
    lastVersionSnapshotAt: project.lastVersionSnapshotAt || "",
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
  const currentUser = auth.currentUser;
  const creationKind = options.creationKind === "workspace" ? "workspace" : "project";
  const workType = options.workType === "prose-poetry" ? "prose-poetry" : "film-script";
  const isWorkspaceRoot = Boolean(options.isWorkspaceRoot);
  const workspaceSeed = options.workspace && typeof options.workspace === "object" ? options.workspace : null;
  const peerProjects = state.projects.filter((project) => {
    if (creationKind === "workspace" || isWorkspaceRoot) {
      return project.isWorkspaceRoot;
    }
    if (workspaceSeed?.id) {
      return !project.isWorkspaceRoot && project.workspace?.id === workspaceSeed.id;
    }
    return !project.isWorkspaceRoot && project.workspace?.id === project.id;
  });
  const index = peerProjects.length + 1;
  const defaultTitle = creationKind === "workspace"
    ? `Film Workspace ${index}`
    : `Film Script ${index}`;
  const project = sanitizeProject({
    id: uid("project"),
    title: options.title || defaultTitle,
    workType,
    creationKind,
    isWorkspaceRoot,
    created_by: options.created_by || currentUser?.uid || '',
    last_edited_by: options.last_edited_by || currentUser?.uid || '',
    last_edited_at: new Date().toISOString(),
    visibility: options.visibility || (options.isShared ? "shared" : isWorkspaceRoot ? "workspace" : "private"),
    tags: Array.isArray(options.tags) ? options.tags : [],
    workspace: workspaceSeed ? {
      ...workspaceSeed,
      name: options.workspaceName || workspaceSeed.name || `Workspace ${index}`
    } : {
      name: options.workspaceName || (creationKind === "workspace" ? defaultTitle : `Workspace ${index}`)
    },
    lines: [{ id: uid(), type: "action", text: "" }]
  });
  upsertProject(project);
  persistProjects(true);
  return project;
}

export function getCurrentProject() {
  return state.projects.find((project) => project.id === state.currentProjectId) || null;
}

export function canCurrentUserAccessProject(project, user = auth.currentUser) {
  if (!project) return false;
  if (!user) return !project.isShared;
  if (!project.isShared) {
    return !project.ownerId || project.ownerId === user.uid || project.created_by === user.uid || project.createdBy === user.uid;
  }
  if (project.ownerId === user.uid || project.created_by === user.uid || project.createdBy === user.uid) {
    return true;
  }
  const collaborator = project.collaborators?.[user.uid];
  if (!collaborator) return false;
  return ['owner', 'admin', 'editor', 'viewer'].includes(collaborator.role || 'editor');
}

export function getVisibleProjects(projects = state.projects, user = auth.currentUser) {
  const now = Date.now();
  return projects
    .map((project) => sanitizeProject(project))
    .filter((project) => canCurrentUserAccessProject(project, user))
    .filter((project) => !project.isTrashed || !project.restoreUntil || new Date(project.restoreUntil).getTime() > now);
}

export function getWorkspaceProjects(workspaceId) {
  return getVisibleProjects(state.projects).filter((project) => project.workspace?.id === workspaceId);
}

export function getWorkspaceRootProject(workspaceId) {
  return getVisibleProjects(state.projects).find((project) => project.workspace?.id === workspaceId && project.isWorkspaceRoot) || null;
}

export function updateWorkspaceAcrossProjects(workspaceId, updater) {
  let changed = false;
  state.projects = state.projects.map((project) => {
    if (project.workspace?.id !== workspaceId) {
      return project;
    }
    const nextWorkspace = updater({ ...(project.workspace || {}) }, project);
    changed = true;
    return sanitizeProject({
      ...project,
      workspace: nextWorkspace || project.workspace,
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
  if (!canCurrentUserAccessProject(next)) {
    return;
  }
  const index = state.projects.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    state.projects.splice(index, 1, next);
  } else {
    state.projects.unshift(next);
  }
}

export function persistProjects(forceSavedBadge = false, { syncInputs = true } = {}) {
  if (syncInputs) syncProjectFromInputs();
  const project = getCurrentProject();
  if (project) {
    captureVersionSnapshot(project, { label: forceSavedBadge ? "Manual save" : "Auto snapshot" });
  }
  const savedAt = new Date().toISOString();
  const payload = buildPersistencePayload(savedAt);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(payload));
  state.lastSavedAt = savedAt;
  state.lastSaveSource = "local";
  updateSaveBadge("local", savedAt);
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

export async function retryFailedSaves() {
  const queue = loadRetryQueue();
  if (!queue.length) {
    updateSaveBadge("saved", state.lastSavedAt);
    return { ok: true, count: 0 };
  }
  if (!navigator.onLine) {
    updateSaveBadge("offline", state.lastSavedAt, "Connection lost. Your changes are still queued locally.");
    return { ok: false, reason: "Offline" };
  }

  const pending = [];
  for (const entry of queue) {
    try {
      const project = sanitizeProject(entry.project);
      await setDoc(doc(db, 'users', auth.currentUser.uid, 'projects', project.id), project);
      if (project.isShared) {
        const CONTENT_KEYS = ['title', 'author', 'contact', 'company', 'details', 'logline',
          'lines', 'collapsedSceneIds', 'updatedAt', 'scriptId', 'wordCountHistory', 'storyMemory',
          'activityLog', 'lastEditorName', 'lastActivityAt', 'workspace', 'version',
          'versionHistory', 'created_by', 'last_edited_by', 'last_edited_at', 'visibility', 'tags',
          'createdBy', 'lastEditedBy', 'lastEditedAt', 'isTrashed', 'trashedAt', 'restoreUntil'];
        const contentPayload = Object.fromEntries(
          CONTENT_KEYS.filter((key) => key in project).map((key) => [key, project[key]])
        );
        await setDoc(doc(db, 'sharedProjects', project.id), {
          ...contentPayload,
          syncedAt: new Date().toISOString(),
          updatedBy: auth.currentUser.uid,
          lastEditorName: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
          lastActivityAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (error) {
      pending.push(entry);
    }
  }
  persistRetryQueue(pending);
  if (pending.length) {
    updateSaveBadge("failed", state.lastSavedAt, "Some queued saves still need another retry.");
    return { ok: false, count: pending.length };
  }
  updateSaveBadge("saved", state.lastSavedAt);
  return { ok: true, count: queue.length };
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
  project.last_edited_by = auth.currentUser?.uid || project.last_edited_by || '';
  project.last_edited_at = project.updatedAt;
  project.lastEditedBy = project.last_edited_by;
  project.lastEditedAt = project.updatedAt;
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

function sanitizeWorkspace(workspace, project) {
  return {
    id: workspace?.id || project.id || uid("workspace"),
    name: String(workspace?.name || project.title || "Team Workspace").trim() || "Team Workspace",
    inviteCode: String(workspace?.inviteCode || project.scriptId || generateScriptId()).trim().toUpperCase(),
    commentingEnabled: Boolean(workspace?.commentingEnabled),
    reminders: sanitizeWorkspaceReminders(workspace?.reminders),
    targets: sanitizeWorkspaceTargets(workspace?.targets),
    tasks: sanitizeWorkspaceTasks(workspace?.tasks),
    notifications: sanitizeWorkspaceNotifications(workspace?.notifications)
  };
}

function sanitizeWorkspaceReminders(reminders) {
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

function sanitizeWorkspaceTargets(targets) {
  return {
    scenes: clamp(Number(targets?.scenes || 0), 0, 9999),
    pages: clamp(Number(targets?.pages || 0), 0, 9999),
    lines: clamp(Number(targets?.lines || 0), 0, 99999)
  };
}

function sanitizeWorkspaceTasks(tasks) {
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

function sanitizeWorkspaceNotifications(notifications) {
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
      role: collaborator?.role === "admin"
        ? "admin"
        : collaborator?.role === "viewer"
          ? "viewer"
          : "editor"
    }])
  );
}

export function serializeScript(project) {
  return project.lines.map((line) => normalizeLineText(line.text, line.type)).filter(Boolean).join("\n\n");
}

window.addEventListener('online', () => {
  retryFailedSaves().catch((error) => console.error('Retry queue failed on reconnect', error));
});

window.addEventListener('offline', () => {
  updateSaveBadge("offline", state.lastSavedAt, "Connection lost. Your changes are cached locally and will retry when you reconnect.");
});

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

