import { state, TYPE_SEQUENCE, TYPE_LABELS, WORKSPACE_TASK_TEMPLATES } from './config.js';
import { refs } from './dom.js';
import { ContextMenu } from './contextMenu.js';
import {
  getCurrentProject, getLine, getLineIndex, persistProjects, queueSave,
  createProject, createProjectWithOptions, upsertProject, sanitizeProject, cloneProject,
  getWorkspaceProjects, getWorkspaceRootProject, updateWorkspaceAcrossProjects,
  syncProjectFromInputs,
  getDefaultText, pushHistory, undo, redo, getSuggestedNextSpeaker,
  deleteProjectFromCloud
} from './project.js';
import {
  renderEditor, setActiveBlock, focusBlock, focusSecondaryBlock, getActiveEditableBlock,
  getOwningSceneId, getCharacterAutocomplete, updateSuggestions,
  showSpellingSuggestions, clearSuggestionContext, refreshEditableBlockDisplay, hideSuggestionTray
} from './editor.js';
import { renderPreview, renderCoverPreview, buildPrintableDocument } from './preview.js';
import { buildWordDocxBlob, DOCX_MIME_TYPE } from './docxExport.js';
import { paginateScriptLines } from './pagination.js';
import { auth } from './firebase.js';
import {
  renderHome, renderRecentProjectMenus, syncInputsFromProject,
  showStudio, showHome, showWorkspaceView, applyViewState, setTheme, toggleMenu,
  closeMenus, applyToolbarState, renderMetrics, renderSceneList,
  renderCharacterList, showCharacterScenes, showProofreadReport, showWorkTracking, revealMetricsPanel,
  updateMenuStateButtons, customAlert, customConfirm, customPrompt,
  showModal, showToast, updateToast,
  renderLeftPaneLayout, toggleLeftPaneSection, setLeftPaneBlockVisibility, moveLeftPaneBlock,
  renderCurrentScriptId, renderStoryMemory, openStoryMemory, showEditStoryElementModal,
  renderAnalytics, openAnalytics, showStoryMemoryPicker, showCustomizeActiveBlocksModal, renderWorkspaceView, renderStudioProjectContext,
  showStoryMemoryPopup, showWorkspacePopup, showCharactersInterface, showStoryMemoryBuilder, showNewCreationFlow
} from './ui.js';
import { AI } from './ai.js';
import {
  normalizeLineText, stripWrapperChars, buildContinuedSceneSuggestions,
  slugify, downloadFile, selectElementText, parseTextToLines, uid,
  placeCaretAtEnd, getCaretOffset, setCaretOffset, clamp, inferTypeFromText,
  formatLineText, escapeHtml
} from './utils.js';
import { applyTranslations, getTypeLabel, setLanguage, t } from './i18n.js';
import {
  applyWordCase, clearSpellingHighlights, ensureLanguageDictionary, getSpellingContextAtOffset,
  hasLanguageDictionary, highlightSpellingIssue, getSpellingSuggestions
} from './spelling.js';
import {
  isLocalSaveSupported, chooseLocalSaveFile, restoreLocalSaveFile, clearLocalSaveFile,
  startLocalSaveTimer, stopLocalSaveTimer, writeLocalSaveFile
} from './localSave.js';
import {
  inviteCollaborator, addComment, renderCollaboratorList, onStudioEnter,
  hideCommentCompose, submitCommentCompose, setCommentFilter, updateCommentIcons, showCommentPanel,
  canEditProject, updateCollaboratorRole, addWorkspaceReminder,
  toggleWorkspaceReminder, deleteWorkspaceReminder, renameWorkspace,
  showCollabProfile
} from './collaborate.js';

let studioSidebarRefreshFrame = 0;
let previewRefreshTimer = 0;
let focusModeTimer = 0;
let hasShownReadOnlyNotice = false;
const aiTaskTimers = new Map();
const INLINE_SELECTION_TOOLS = [
  { label: "Improve", action: "Improve", requiresAi: true },
  { label: "Rewrite", action: "Rephrase", requiresAi: true },
  { label: "Fix Grammar", action: "Grammar", requiresGrammar: true }
];

function ensureSelectionToolbar() {
  let toolbar = document.getElementById("selectionAiToolbar");
  if (toolbar) return toolbar;
  toolbar = document.createElement("div");
  toolbar.id = "selectionAiToolbar";
  toolbar.className = "selection-ai-toolbar";
  toolbar.hidden = true;
  toolbar.innerHTML = `
    <div class="selection-ai-toolbar-actions">
      ${INLINE_SELECTION_TOOLS.map((tool) => `<button class="selection-ai-toolbar-btn" type="button" data-selection-ai-action="${tool.action}" data-requires-ai="${tool.requiresAi ? "true" : "false"}" data-requires-grammar="${tool.requiresGrammar ? "true" : "false"}">${tool.label}</button>`).join("")}
    </div>
  `;
  toolbar.addEventListener("mousedown", (event) => event.preventDefault());
  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selection-ai-action]");
    if (!button) return;
    hideSelectionToolbar();
    AI.triggerSelectionAction(button.dataset.selectionAiAction);
  });
  document.body.appendChild(toolbar);
  return toolbar;
}

function hideSelectionToolbar() {
  const toolbar = document.getElementById("selectionAiToolbar");
  if (!toolbar) return;
  toolbar.hidden = true;
  toolbar.classList.remove("is-visible");
}

function updateSelectionToolbar() {
  const toolbar = ensureSelectionToolbar();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    hideSelectionToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  const block = range.commonAncestorContainer?.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement?.closest(".script-block")
    : range.commonAncestorContainer?.closest?.(".script-block");
  if (!block || !refs.screenplayEditor?.contains(block)) {
    hideSelectionToolbar();
    return;
  }

  const buttons = [...toolbar.querySelectorAll("[data-selection-ai-action]")];
  let visibleCount = 0;
  buttons.forEach((button) => {
    const needsAi = button.dataset.requiresAi === "true";
    const needsGrammar = button.dataset.requiresGrammar === "true";
    const shouldShow = (!needsAi || state.aiAssist) && (!needsGrammar || state.grammarCheck);
    button.hidden = !shouldShow;
    if (shouldShow) visibleCount += 1;
  });
  if (!visibleCount) {
    hideSelectionToolbar();
    return;
  }

  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) {
    hideSelectionToolbar();
    return;
  }

  toolbar.style.top = `${Math.max(window.scrollY + 12, window.scrollY + rect.top - 52)}px`;
  toolbar.style.left = `${window.scrollX + rect.left + (rect.width / 2)}px`;
  toolbar.hidden = false;
  toolbar.classList.add("is-visible");
}

function setTypingFocusModeActive() {
  if (!state.viewOptions.focusMode) return;
  document.body.classList.add("focus-mode-active");
  clearTimeout(focusModeTimer);
  focusModeTimer = window.setTimeout(() => {
    document.body.classList.remove("focus-mode-active");
  }, 1500);
}

function schedulePreviewRefresh({ includeCover = false } = {}) {
  clearTimeout(previewRefreshTimer);
  previewRefreshTimer = window.setTimeout(() => {
    if (includeCover) {
      renderCoverPreview();
    }
    renderPreview();
  }, 90);
}

function getWorkspaceTaskTemplate(templateKey) {
  return WORKSPACE_TASK_TEMPLATES.find((template) => template.key === templateKey) || WORKSPACE_TASK_TEMPLATES[0];
}

function applyWorkspaceTaskTemplateToForm(container, templateKey, { force = false } = {}) {
  if (!container) return;
  const template = getWorkspaceTaskTemplate(templateKey);
  const titleInput = container.querySelector('[data-workspace-task-title], #taskEditTitle');
  const descriptionInput = container.querySelector('[data-workspace-task-description], #taskEditDescription');
  const templateInput = container.querySelector('[data-workspace-task-template], #taskEditTemplate');
  const hint = container.querySelector('[data-workspace-task-template-hint], #taskEditTemplateHint');
  const previousKey = container.dataset.workspaceTemplateApplied || "custom";
  const previousTemplate = getWorkspaceTaskTemplate(previousKey);

  if (templateInput) {
    templateInput.value = template.key;
  }
  if (titleInput) {
    const currentTitle = titleInput.value.trim();
    if (force || !currentTitle || currentTitle === previousTemplate.title) {
      titleInput.value = template.title;
    }
  }
  if (descriptionInput) {
    const currentDescription = descriptionInput.value.trim();
    if (force || !currentDescription || currentDescription === previousTemplate.description) {
      descriptionInput.value = template.description;
    }
  }
  if (hint) {
    hint.textContent = template.aiInstruction;
  }
  container.dataset.workspaceTemplateApplied = template.key;
}

function ensureDefaultWorkspaceRoot() {
  const currentWorkspaceRoot = state.currentWorkspaceId
    ? getWorkspaceRootProject(state.currentWorkspaceId)
    : null;
  if (currentWorkspaceRoot) return currentWorkspaceRoot;

  const existingWorkspaceRoot = state.projects.find((project) => project.isWorkspaceRoot);
  if (existingWorkspaceRoot) return existingWorkspaceRoot;

  return createProjectWithOptions({
    creationKind: "workspace",
    workType: "film-script",
    isWorkspaceRoot: true,
    title: "My Workspace",
    workspaceName: "My Workspace"
  });
}

async function launchNewCreationFlow() {
  const selection = await showNewCreationFlow();
  if (!selection || selection.workType !== "film-script") {
    return;
  }

  const projectName = await customPrompt("Name this project before creating it.", "", "New Project");
  if (!projectName || !projectName.trim()) {
    await customAlert("A project name is required before creation.", "Project Not Created");
    return;
  }
  const workspaceRoot = ensureDefaultWorkspaceRoot();
  const project = createProjectWithOptions({
    creationKind: "project",
    workType: selection.workType,
    title: projectName.trim(),
    workspace: {
      id: workspaceRoot.workspace?.id || workspaceRoot.id,
      name: workspaceRoot.workspace?.name || workspaceRoot.title,
      inviteCode: workspaceRoot.workspace?.inviteCode,
      reminders: workspaceRoot.workspace?.reminders || [],
      targets: workspaceRoot.workspace?.targets || {},
      tasks: workspaceRoot.workspace?.tasks || []
    }
  });
  openProject(project.id, { silentLoadToast: true });
  showToast("Project created.", "success");
}

function openWorkspaceDashboard(workspaceId) {
  if (!workspaceId) return;
  const workspaceRoot = getWorkspaceRootProject(workspaceId) || getWorkspaceProjects(workspaceId)[0] || null;
  state.currentWorkspaceId = workspaceId;
  if (workspaceRoot) {
    state.currentProjectId = workspaceRoot.id;
  }
  persistProjects(false, { syncInputs: false });
  showWorkspaceView();
  renderWorkspaceView();
}

async function createProjectInsideCurrentWorkspace() {
  const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId) || state.projects.find((project) => project.workspace?.id === state.currentWorkspaceId);
  if (!workspaceProject) {
    launchNewCreationFlow();
    return;
  }
  const projectName = await customPrompt("Name this project before creating it.", "", "New Project");
  if (!projectName || !projectName.trim()) {
    await customAlert("A project name is required before creation.", "Project Not Created");
    return;
  }
  const project = createProjectWithOptions({
    creationKind: "project",
    workType: "film-script",
    title: projectName.trim(),
    isShared: workspaceProject.isShared,
    ownerId: workspaceProject.ownerId,
    ownerName: workspaceProject.ownerName,
    ownerEmail: workspaceProject.ownerEmail,
    ownerPhotoURL: workspaceProject.ownerPhotoURL,
    collaborators: workspaceProject.collaborators,
    activityLog: workspaceProject.activityLog,
    lastEditorName: workspaceProject.lastEditorName,
    lastActivityAt: workspaceProject.lastActivityAt,
    workspace: {
      id: workspaceProject.workspace?.id,
      name: workspaceProject.workspace?.name || workspaceProject.title,
      inviteCode: workspaceProject.workspace?.inviteCode,
      reminders: workspaceProject.workspace?.reminders || [],
      targets: workspaceProject.workspace?.targets || {},
      tasks: workspaceProject.workspace?.tasks || []
    }
  });
  openProject(project.id, { silentLoadToast: true });
  showToast("Project created.", "success");
}

function isDisposableUntitledDraft(project = getCurrentProject()) {
  if (!project || project.isWorkspaceRoot) return false;
  const defaultLikeTitle = /^(Untitled Script|Film Script \d+)$/i.test(String(project.title || "").trim());
  const hasMeta = [project.author, project.contact, project.company, project.details, project.logline].some((value) => String(value || "").trim());
  const hasContent = (project.lines || []).some((line) => String(line?.text || "").trim() || String(line?.secondary || "").trim());
  return defaultLikeTitle && !hasMeta && !hasContent;
}

async function discardUntitledDraftIfNeeded() {
  if (refs.studioView?.hidden) return false;
  const project = getCurrentProject();
  if (!isDisposableUntitledDraft(project)) return false;
  const workspaceId = project.workspace?.id || project.id;
  state.projects = state.projects.filter((item) => item.id !== project.id);
  if (!state.projects.length) {
    const fallback = createProjectWithOptions();
    state.projects = [fallback];
  }
  if (state.currentWorkspaceId === workspaceId && project.workspace?.id !== project.id) {
    state.currentWorkspaceId = workspaceId;
  }
  state.currentProjectId = state.projects[0].id;
  persistProjects(true, { syncInputs: false });
  await customAlert("This project was not created because no project name or content was added.", "Project Not Created");
  return true;
}

function getWorkspaceTaskAssignees(workspaceProject) {
  const ownerUid = workspaceProject.ownerId || "workspace_owner";
  const ownerLabel = workspaceProject.ownerName || workspaceProject.ownerEmail || workspaceProject.author || "Workspace Owner";
  const collaboratorEntries = Object.entries(workspaceProject.collaborators || {}).map(([uid, person]) => ({
    id: uid,
    label: person.name || person.email || "Collaborator",
    assigneeType: "human"
  }));
  return [
    { id: ownerUid, label: ownerLabel, assigneeType: "human" },
    ...collaboratorEntries,
    { id: "ai_assist", label: "@AIassist", assigneeType: "system" }
  ];
}

function getWorkspaceTaskSceneChoices(workspaceId = state.currentWorkspaceId) {
  return getWorkspaceProjects(workspaceId)
    .filter((project) => !project.isWorkspaceRoot)
    .flatMap((project) => (project.lines || [])
      .filter((line) => line.type === "scene" && line.text.trim())
      .map((line) => ({
        projectId: project.id,
        sceneId: line.id,
        lineId: line.id,
        label: `${project.title} - ${line.text.trim()}`
      })));
}

function getWorkspaceTaskLineChoices(workspaceId = state.currentWorkspaceId) {
  return getWorkspaceProjects(workspaceId)
    .filter((project) => !project.isWorkspaceRoot)
    .flatMap((project) => (project.lines || [])
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.type !== "scene" && line.text.trim())
      .map(({ line, index }) => {
        const sceneId = getSceneIdForIndex(index, project);
        const sceneLine = sceneId ? project.lines.find((entry) => entry.id === sceneId) : null;
        return {
          projectId: project.id,
          lineId: line.id,
          sceneId: sceneId || "",
          sceneLabel: sceneLine?.text?.trim() || "",
          lineLabel: formatLineText(line.text, line.type).slice(0, 80),
          label: `${project.title} - ${(sceneLine?.text?.trim() || "General")} - ${formatLineText(line.text, line.type).slice(0, 56)}`
        };
      }));
}

function getWorkspaceStoryMemoryChoices(workspaceId = state.currentWorkspaceId) {
  const bucketLabels = {
    characters: "Character",
    locations: "Location",
    scenes: "Scene",
    themes: "Theme"
  };
  return getWorkspaceProjects(workspaceId)
    .filter((project) => !project.isWorkspaceRoot)
    .flatMap((project) => Object.entries(project.storyMemory || {})
      .filter(([bucket]) => bucketLabels[bucket])
      .flatMap(([bucket, items]) => (Array.isArray(items) ? items : []).map((item) => ({
        projectId: project.id,
        type: bucket,
        id: item.id,
        name: item.name || bucketLabels[bucket],
        label: `${project.title} · ${bucketLabels[bucket]} · ${item.name || "Untitled"}`
      }))));
}

function getWorkspaceTaskById(taskId) {
  return getWorkspaceRootProject(state.currentWorkspaceId)?.workspace?.tasks?.find((task) => task.id === taskId) || null;
}

function getWorkspaceNotifications(workspaceId = state.currentWorkspaceId) {
  return [...(getWorkspaceRootProject(workspaceId)?.workspace?.notifications || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function createWorkspaceNotification({ workspaceId = state.currentWorkspaceId, task = null, category = "update", title = "", message = "", actor = "" } = {}) {
  if (!workspaceId || !title) return;
  updateWorkspaceAcrossProjects(workspaceId, (workspace) => ({
    ...workspace,
    notifications: [
      {
        id: uid("notif"),
        taskId: task?.id || "",
        projectId: task?.projectId || "",
        category,
        title,
        message,
        actor,
        createdAt: new Date().toISOString(),
        read: false
      },
      ...(workspace.notifications || [])
    ].slice(0, 40)
  }));
}

function markWorkspaceNotificationRead(notificationId, read = true) {
  if (!state.currentWorkspaceId || !notificationId) return;
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    notifications: (workspace.notifications || []).map((notification) => notification.id === notificationId
      ? { ...notification, read }
      : notification)
  }));
  persistProjects(true, { syncInputs: false });
  renderWorkspaceView();
}

function markAllWorkspaceNotificationsRead() {
  if (!state.currentWorkspaceId) return;
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    notifications: (workspace.notifications || []).map((notification) => ({ ...notification, read: true }))
  }));
  persistProjects(true, { syncInputs: false });
  renderWorkspaceView();
}

function resolveAiTaskStart(choice, manualValue = "") {
  const now = Date.now();
  if (choice === "in-3m") return new Date(now + (3 * 60 * 1000)).toISOString();
  if (choice === "in-10m") return new Date(now + (10 * 60 * 1000)).toISOString();
  if (choice === "manual" && manualValue) {
    const parsed = new Date(manualValue);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  return "";
}

function getAiTaskDisplayState(task) {
  if (task.assigneeType !== "system") return "";
  if (task.aiState === "scheduled" && task.aiStartAt) {
    return new Date(task.aiStartAt).getTime() <= Date.now() ? "ready" : "scheduled";
  }
  return task.aiState || "idle";
}

function clearAiTaskTimer(taskId) {
  const timer = aiTaskTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    aiTaskTimers.delete(taskId);
  }
}

function scheduleAiTaskRun(task) {
  clearAiTaskTimer(task.id);
  if (!task || task.assigneeType !== "system" || !["scheduled", "ready"].includes(task.aiState)) {
    return;
  }
  const startAtMs = task.aiStartAt ? new Date(task.aiStartAt).getTime() : Date.now();
  const delay = Math.max(0, startAtMs - Date.now());
  const timer = setTimeout(() => {
    aiTaskTimers.delete(task.id);
    runAiTask(task.id);
  }, delay);
  aiTaskTimers.set(task.id, timer);
}

function syncAiTaskSchedules(workspaceId = state.currentWorkspaceId) {
  const root = getWorkspaceRootProject(workspaceId);
  const tasks = root?.workspace?.tasks || [];
  const validIds = new Set(tasks.map((task) => task.id));
  [...aiTaskTimers.keys()].forEach((taskId) => {
    if (!validIds.has(taskId)) clearAiTaskTimer(taskId);
  });
  tasks.forEach((task) => scheduleAiTaskRun(task));
}

function insertAiTaskResultIntoProject(task, resultText) {
  return insertAiTaskResultIntoProjectWithMode(task, resultText, task.lastApplyMode || "insert-below");
}

function getProjectSceneRange(project, task) {
  if (!project || !Array.isArray(project.lines) || !project.lines.length) {
    return null;
  }
  const explicitSceneIndex = task.sceneId
    ? project.lines.findIndex((line) => line.id === task.sceneId)
    : -1;
  let startIndex = explicitSceneIndex;
  if (startIndex < 0 && task.lineId) {
    const lineIndex = project.lines.findIndex((line) => line.id === task.lineId);
    if (lineIndex >= 0) {
      for (let index = lineIndex; index >= 0; index -= 1) {
        if (project.lines[index]?.type === "scene") {
          startIndex = index;
          break;
        }
      }
    }
  }
  if (startIndex < 0) return null;
  let endIndex = project.lines.length - 1;
  for (let index = startIndex + 1; index < project.lines.length; index += 1) {
    if (project.lines[index]?.type === "scene") {
      endIndex = index - 1;
      break;
    }
  }
  return { startIndex, endIndex };
}

function getAiTaskTargetContext(task) {
  const project = state.projects.find((item) => item.id === task.projectId);
  if (!project?.lines?.length) {
    return {
      projectTitle: "Linked Project",
      targetLabel: task.sceneLabel || task.reference || "Project context",
      originalText: "No linked script context was found for this task."
    };
  }
  const sceneRange = getProjectSceneRange(project, task);
  const lineIndex = task.lineId
    ? project.lines.findIndex((line) => line.id === task.lineId)
    : -1;
  const sourceLines = [];
  let targetLabel = task.sceneLabel || task.reference || project.title;
  if (lineIndex >= 0) {
    const start = Math.max(0, lineIndex - 1);
    const end = Math.min(project.lines.length - 1, lineIndex + 2);
    for (let index = start; index <= end; index += 1) {
      sourceLines.push(project.lines[index]);
    }
    targetLabel = task.reference || task.sceneLabel || "Linked line";
  } else if (sceneRange) {
    const limit = Math.min(sceneRange.endIndex, sceneRange.startIndex + 7);
    for (let index = sceneRange.startIndex; index <= limit; index += 1) {
      sourceLines.push(project.lines[index]);
    }
    targetLabel = task.sceneLabel || "Linked scene";
  } else {
    sourceLines.push(...project.lines.slice(Math.max(0, project.lines.length - 6)));
  }
  const originalText = sourceLines.map((line) => formatLineText(line)).join("\n").trim() || "No source context available.";
  return {
    projectTitle: project.title,
    targetLabel,
    originalText
  };
}

function insertAiTaskResultIntoProjectWithMode(task, resultText, mode = "insert-below") {
  const project = state.projects.find((item) => item.id === task.projectId);
  if (!project) return false;
  const generatedLines = parseTextToLines(resultText);
  if (!generatedLines.length) return false;
  const lineIndex = task.lineId ? project.lines.findIndex((line) => line.id === task.lineId) : -1;
  const sceneRange = getProjectSceneRange(project, task);

  if (mode === "replace-target") {
    if (lineIndex >= 0) {
      project.lines.splice(lineIndex, 1, ...generatedLines);
    } else if (sceneRange) {
      project.lines.splice(sceneRange.startIndex, (sceneRange.endIndex - sceneRange.startIndex) + 1, ...generatedLines);
    } else {
      project.lines.splice(project.lines.length, 0, ...generatedLines);
    }
  } else if (mode === "append-scene") {
    const insertIndex = sceneRange ? sceneRange.endIndex + 1 : project.lines.length;
    project.lines.splice(insertIndex, 0, ...generatedLines);
  } else {
    const anchorId = task.lineId || task.sceneId || "";
    let insertIndex = anchorId ? project.lines.findIndex((line) => line.id === anchorId) + 1 : project.lines.length;
    if (insertIndex <= 0) insertIndex = project.lines.length;
    project.lines.splice(insertIndex, 0, ...generatedLines);
  }

  project.updatedAt = new Date().toISOString();
  upsertProject(project);
  return true;
}

function addWorkspaceTaskFromContainer(container) {
  if (!container) return addWorkspaceTaskFromDashboard();
  const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId);
  if (!workspaceProject) return;
  const templateSelect = container.querySelector('[data-workspace-task-template]');
  const titleInput = container.querySelector('[data-workspace-task-title]');
  const descriptionInput = container.querySelector('[data-workspace-task-description]');
  const projectSelect = container.querySelector('[data-workspace-task-project]');
  const sceneSelect = container.querySelector('[data-workspace-task-scene]');
  const lineSelect = container.querySelector('[data-workspace-task-line]');
  const assigneeSelect = container.querySelector('[data-workspace-task-assignee]');
  const referenceInput = container.querySelector('[data-workspace-task-reference]');
  const statusSelect = container.querySelector('[data-workspace-task-status-new]');
  const prioritySelect = container.querySelector('[data-workspace-task-priority]');
  const dueInput = container.querySelector('[data-workspace-task-due]');
  const handoffInput = container.querySelector('[data-workspace-task-handoff]');
  const memorySelect = container.querySelector('[data-workspace-task-memory]');
  const aiStartSelect = container.querySelector('[data-workspace-task-ai-start]');
  const aiStartManual = container.querySelector('[data-workspace-task-ai-start-manual]');
  const templateKey = templateSelect?.value || "custom";
  const title = titleInput?.value?.trim();
  if (!title) {
    customAlert("Enter a task title first.", "Workspace Tasks");
    return;
  }
  const projectId = projectSelect?.value || "";
  const sceneId = sceneSelect?.value || "";
  const lineId = lineSelect?.value || "";
  const sceneChoice = getWorkspaceTaskSceneChoices().find((scene) => scene.sceneId === sceneId) || null;
  const lineChoice = getWorkspaceTaskLineChoices().find((line) => line.lineId === lineId) || null;
  const assignedTo = assigneeSelect?.value || "";
  const assignee = getWorkspaceTaskAssignees(workspaceProject).find((entry) => entry.id === assignedTo);
  const memoryChoice = getWorkspaceStoryMemoryChoices().find((entry) => entry.id === (memorySelect?.value || "")) || null;
  const aiStartChoice = aiStartSelect?.value || "now";
  const aiStartAt = assignee?.assigneeType === "system" ? resolveAiTaskStart(aiStartChoice, aiStartManual?.value || "") : "";
  const initialAiState = assignee?.assigneeType === "system" ? (aiStartAt ? "scheduled" : "ready") : "idle";
  const nextTask = {
    id: uid("task"),
    templateKey,
    priority: prioritySelect?.value || "normal",
    title,
    description: descriptionInput?.value?.trim() || "",
    status: statusSelect?.value || "todo",
    dueAt: dueInput?.value ? new Date(dueInput.value).toISOString() : "",
    assignedTo,
    assignedLabel: assignee?.label || "Unassigned",
    assigneeType: assignee?.assigneeType || "human",
    handoffNote: handoffInput?.value?.trim() || "",
    projectId: lineChoice?.projectId || sceneChoice?.projectId || projectId,
    reference: referenceInput?.value?.trim() || "",
    sceneId: lineChoice?.sceneId || sceneChoice?.sceneId || "",
    sceneLabel: lineChoice?.sceneLabel || sceneChoice?.label || "",
    lineId: lineChoice?.lineId || sceneChoice?.lineId || "",
    lineLabel: lineChoice?.lineLabel || "",
    memoryLinkType: memoryChoice?.type || "",
    memoryLinkId: memoryChoice?.id || "",
    memoryLinkName: memoryChoice?.name || "",
    memoryProjectId: memoryChoice?.projectId || "",
    comments: [],
    aiState: initialAiState,
    aiStartAt,
    aiLastRunAt: "",
    aiResultText: "",
    aiResultSummary: "",
    aiError: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByName: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  };
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    tasks: [...(workspace.tasks || []), nextTask]
  }));
  createWorkspaceNotification({
    task: nextTask,
    category: assignee?.assigneeType === "system" ? "ai" : "task",
    title: assignee?.assigneeType === "system" ? "AI task queued" : "New task created",
    message: `${nextTask.title} ${assignee?.assigneeType === "system" ? `was assigned to ${nextTask.assignedLabel}.` : `was assigned to ${nextTask.assignedLabel || "the workspace"}.`}`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  persistProjects(true, { syncInputs: false });
  scheduleAiTaskRun(nextTask);
  if (container === refs.homeWorkspaceDashboard) {
    renderHome();
  } else {
    renderWorkspaceView();
  }
  showToast(
    assignee?.assigneeType === "system"
      ? `AI task queued for ${nextTask.assignedLabel}.`
      : `${nextTask.title} assigned to ${nextTask.assignedLabel || "the workspace"}.`,
    "success"
  );
}

function addWorkspaceTaskFromDashboard() {
  const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId);
  if (!workspaceProject || !refs.workspaceDashboard) return;
  const templateSelect = refs.workspaceDashboard.querySelector('[data-workspace-task-template]');
  const titleInput = refs.workspaceDashboard.querySelector('[data-workspace-task-title]');
  const descriptionInput = refs.workspaceDashboard.querySelector('[data-workspace-task-description]');
  const projectSelect = refs.workspaceDashboard.querySelector('[data-workspace-task-project]');
  const sceneSelect = refs.workspaceDashboard.querySelector('[data-workspace-task-scene]');
  const lineSelect = refs.workspaceDashboard.querySelector('[data-workspace-task-line]');
  const assigneeSelect = refs.workspaceDashboard.querySelector('[data-workspace-task-assignee]');
  const referenceInput = refs.workspaceDashboard.querySelector('[data-workspace-task-reference]');
  const statusSelect = refs.workspaceDashboard.querySelector('[data-workspace-task-status-new]');
  const prioritySelect = refs.workspaceDashboard.querySelector('[data-workspace-task-priority]');
  const dueInput = refs.workspaceDashboard.querySelector('[data-workspace-task-due]');
  const handoffInput = refs.workspaceDashboard.querySelector('[data-workspace-task-handoff]');
  const memorySelect = refs.workspaceDashboard.querySelector('[data-workspace-task-memory]');
  const aiStartSelect = refs.workspaceDashboard.querySelector('[data-workspace-task-ai-start]');
  const aiStartManual = refs.workspaceDashboard.querySelector('[data-workspace-task-ai-start-manual]');
  const templateKey = templateSelect?.value || "custom";
  const title = titleInput?.value?.trim();
  if (!title) {
    customAlert("Enter a task title first.", "Workspace Tasks");
    return;
  }
  const projectId = projectSelect?.value || "";
  const sceneId = sceneSelect?.value || "";
  const lineId = lineSelect?.value || "";
  const sceneChoice = getWorkspaceTaskSceneChoices().find((scene) => scene.sceneId === sceneId) || null;
  const lineChoice = getWorkspaceTaskLineChoices().find((line) => line.lineId === lineId) || null;
  const assignedTo = assigneeSelect?.value || "";
  const assignee = getWorkspaceTaskAssignees(workspaceProject).find((entry) => entry.id === assignedTo);
  const memoryChoice = getWorkspaceStoryMemoryChoices().find((entry) => entry.id === (memorySelect?.value || "")) || null;
  const aiStartChoice = aiStartSelect?.value || "now";
  const aiStartAt = assignee?.assigneeType === "system" ? resolveAiTaskStart(aiStartChoice, aiStartManual?.value || "") : "";
  const initialAiState = assignee?.assigneeType === "system"
    ? (aiStartAt ? "scheduled" : "ready")
    : "idle";
  const nextTask = {
    id: uid("task"),
    templateKey,
    priority: prioritySelect?.value || "normal",
    title,
    description: descriptionInput?.value?.trim() || "",
    status: statusSelect?.value || "todo",
    dueAt: dueInput?.value ? new Date(dueInput.value).toISOString() : "",
    assignedTo,
    assignedLabel: assignee?.label || "Unassigned",
    assigneeType: assignee?.assigneeType || "human",
    handoffNote: handoffInput?.value?.trim() || "",
    projectId: lineChoice?.projectId || sceneChoice?.projectId || projectId,
    reference: referenceInput?.value?.trim() || "",
    sceneId: lineChoice?.sceneId || sceneChoice?.sceneId || "",
    sceneLabel: lineChoice?.sceneLabel || sceneChoice?.label || "",
    lineId: lineChoice?.lineId || sceneChoice?.lineId || "",
    lineLabel: lineChoice?.lineLabel || "",
    memoryLinkType: memoryChoice?.type || "",
    memoryLinkId: memoryChoice?.id || "",
    memoryLinkName: memoryChoice?.name || "",
    memoryProjectId: memoryChoice?.projectId || "",
    comments: [],
    aiState: initialAiState,
    aiStartAt,
    aiLastRunAt: "",
    aiResultText: "",
    aiResultSummary: "",
    aiError: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByName: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  };

  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    tasks: [...(workspace.tasks || []), nextTask]
  }));
  createWorkspaceNotification({
    task: nextTask,
    category: assignee?.assigneeType === "system" ? "ai" : "task",
    title: assignee?.assigneeType === "system" ? "AI task queued" : "New task created",
    message: `${nextTask.title} ${assignee?.assigneeType === "system" ? `was assigned to ${nextTask.assignedLabel}.` : `was assigned to ${nextTask.assignedLabel || "the workspace"}.`}`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  persistProjects(true, { syncInputs: false });
  scheduleAiTaskRun(nextTask);
  renderWorkspaceView();
  showToast(
    assignee?.assigneeType === "system"
      ? `AI task queued for ${nextTask.assignedLabel}.`
      : `${nextTask.title} assigned to ${nextTask.assignedLabel || "the workspace"}.`,
    "success"
  );
}

function updateWorkspaceTask(taskId, patch) {
  if (!state.currentWorkspaceId || !taskId) return;
  const previousTask = getWorkspaceTaskById(taskId);
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    tasks: (workspace.tasks || []).map((task) => task.id === taskId
      ? { ...task, ...patch, updatedAt: new Date().toISOString() }
      : task)
  }));
  persistProjects(true, { syncInputs: false });
  const task = getWorkspaceTaskById(taskId);
  if (task && previousTask) {
    if (patch.status && patch.status !== previousTask.status) {
      showToast(`${task.title} moved to ${patch.status === "in-progress" ? "In Progress" : patch.status === "done" ? "Done" : "To Do"}.`, "success");
      createWorkspaceNotification({
        task,
        category: patch.status === "done" ? "completed" : "task",
        title: patch.status === "done" ? "Task completed" : "Task status updated",
        message: `${task.title} is now ${patch.status === "in-progress" ? "in progress" : patch.status.replace("-", " ")}.`,
        actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
      });
    }
    if (patch.assignedTo && patch.assignedTo !== previousTask.assignedTo) {
      showToast(`${task.title} is now assigned to ${task.assignedLabel || "a teammate"}.`, "success");
      createWorkspaceNotification({
        task,
        category: task.assigneeType === "system" ? "ai" : "task",
        title: "Task reassigned",
        message: `${task.title} is now assigned to ${task.assignedLabel || "a teammate"}.`,
        actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
      });
    }
    if (patch.dueAt && patch.dueAt !== previousTask.dueAt) {
      showToast(`${task.title} due date updated.`, "success");
      createWorkspaceNotification({
        task,
        category: "task",
        title: "Task due date updated",
        message: `${task.title} is due ${new Date(task.dueAt).toLocaleString()}.`,
        actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
      });
    }
  }
  if (task) scheduleAiTaskRun(task);
  renderWorkspaceView();
}

async function runAiTask(taskId) {
  const task = getWorkspaceTaskById(taskId);
  if (!task || task.assigneeType !== "system" || task.aiState === "running") return;
  const taskToastId = `ai-task-${taskId}`;
  const project = state.projects.find((item) => item.id === task.projectId) || getCurrentProject();
  if (!project) {
    updateWorkspaceTask(taskId, { aiState: "failed", aiError: "The linked project could not be found." });
    updateToast(taskToastId, "AI task could not find its linked project.", "error", { duration: 4200 });
    createWorkspaceNotification({
      task,
      category: "ai",
      title: "AI task needs relinking",
      message: `${task.title} could not run because its linked project is missing.`,
      actor: "@AIassist"
    });
    return;
  }
  updateWorkspaceTask(taskId, {
    aiState: "running",
    aiError: "",
    status: task.status === "done" ? "done" : "in-progress",
    aiLastRunAt: new Date().toISOString()
  });
  updateToast(taskToastId, `${task.title} is processing...`, "loading", { duration: 0 });
  try {
    const resultText = String(await AI.runWorkspaceTaskAssistant(task, project) || "").trim();
    if (!resultText) {
      throw new Error("AI returned no usable result.");
    }
    updateWorkspaceTask(taskId, {
      aiState: "review",
      aiResultText: resultText,
      aiResultSummary: task.title,
      aiError: ""
    });
    updateToast(taskToastId, "AI task finished.", "success");
    createWorkspaceNotification({
      task: { ...task, aiResultText: resultText },
      category: "review",
      title: "AI result ready for review",
      message: `${task.title} has a suggested result ready to review.`,
      actor: "@AIassist"
    });
  } catch (error) {
    updateWorkspaceTask(taskId, {
      aiState: "failed",
      aiError: error instanceof Error ? error.message : "AI task failed."
    });
    updateToast(taskToastId, "AI task failed.", "error", { duration: 4200 });
    createWorkspaceNotification({
      task,
      category: "ai",
      title: "AI task failed",
      message: `${task.title} needs attention before it can run successfully again. ${String(error instanceof Error ? error.message : "AI task failed.").trim()}`,
      actor: "@AIassist"
    });
  }
}

async function reviewAiTaskResult(taskId) {
  const task = getWorkspaceTaskById(taskId);
  if (!task?.aiResultText) return;
  const context = getAiTaskTargetContext(task);
  const container = document.createElement("div");
  container.className = "workspace-ai-review";
  container.innerHTML = `
    <div class="workspace-ai-review-head">
      <span class="workspace-task-tag">AI Suggestion</span>
      <span class="workspace-task-tag">${escapeHtml(task.assignedLabel || "@AIassist")}</span>
      <span class="workspace-task-tag workspace-task-tag-priority workspace-task-tag-priority-${escapeHtml(task.priority || "normal")}">${escapeHtml((task.priority || "normal").replace(/^./, (value) => value.toUpperCase()))} Priority</span>
    </div>
    <div class="workspace-ai-review-summary">
      <p class="modal-copy">${escapeHtml(task.title)}</p>
      <p class="workspace-ai-review-caption">${escapeHtml(context.projectTitle)} · ${escapeHtml(context.targetLabel)}</p>
    </div>
    <div class="workspace-ai-review-grid">
      <div class="workspace-ai-review-panel">
        <span class="workspace-ai-review-label">Current Script Context</span>
        <div class="workspace-ai-review-body">${escapeHtml(context.originalText).replace(/\n/g, "<br>")}</div>
      </div>
      <div class="workspace-ai-review-panel">
        <span class="workspace-ai-review-label">AI Suggestion</span>
        <div class="workspace-ai-review-body">${escapeHtml(task.aiResultText).replace(/\n/g, "<br>")}</div>
      </div>
    </div>
    <label class="workspace-ai-apply-row">
      <span class="workspace-ai-review-label">Apply Result As</span>
      <select class="comment-filter-select" id="workspaceAiApplyMode">
        <option value="insert-below" ${(task.lastApplyMode || "insert-below") === "insert-below" ? "selected" : ""}>Insert below target</option>
        <option value="replace-target" ${task.lastApplyMode === "replace-target" ? "selected" : ""}>Replace target</option>
        <option value="append-scene" ${task.lastApplyMode === "append-scene" ? "selected" : ""}>Append to scene</option>
      </select>
    </label>
  `;
  const shouldApply = await showModal({
    title: "AI Task Result",
    message: container,
    confirmLabel: "Apply",
    cancelLabel: "Close",
    contentClass: "workspace-ai-review-modal"
  });
  if (!shouldApply) return;
  const applyMode = container.querySelector("#workspaceAiApplyMode")?.value || task.lastApplyMode || "insert-below";
  await applyAiTaskResult(taskId, applyMode);
}

async function applyAiTaskResult(taskId, applyMode = null) {
  const task = getWorkspaceTaskById(taskId);
  if (!task?.aiResultText) return;
  const finalMode = applyMode || task.lastApplyMode || "insert-below";
  const applied = insertAiTaskResultIntoProjectWithMode(task, task.aiResultText, finalMode);
  if (!applied) {
    await customAlert("The AI result could not be inserted into the project.", "AI Task");
    return;
  }
  updateWorkspaceTask(taskId, { aiState: "applied", status: "done", lastApplyMode: finalMode });
  createWorkspaceNotification({
    task,
    category: "completed",
    title: "AI result applied",
    message: `${task.title} was applied to the script with ${finalMode.replace("-", " ")} mode.`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  openProject(task.projectId, { focusLineId: task.lineId || task.sceneId || "" });
  showToast("AI result applied to the script.", "success");
}

function dismissAiTaskResult(taskId) {
  const task = getWorkspaceTaskById(taskId);
  if (!task) return;
  updateWorkspaceTask(taskId, { aiState: "dismissed" });
  createWorkspaceNotification({
    task,
    category: "review",
    title: "AI result dismissed",
    message: `${task.title} was reviewed and dismissed.`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  showToast("AI result dismissed.", "success");
}

async function editWorkspaceTask(taskId) {
  const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId);
  const task = getWorkspaceTaskById(taskId);
  if (!workspaceProject || !task) return;
  const assignees = getWorkspaceTaskAssignees(workspaceProject);
  const scenes = getWorkspaceTaskSceneChoices();
  const lines = getWorkspaceTaskLineChoices();
  const memoryChoices = getWorkspaceStoryMemoryChoices();
  const selectedTemplate = getWorkspaceTaskTemplate(task.templateKey);
  const container = document.createElement("div");
  container.className = "workspace-task-form workspace-task-form-modal";
  container.innerHTML = `
    <select id="taskEditTemplate" class="comment-filter-select">
      ${WORKSPACE_TASK_TEMPLATES.map((template) => `<option value="${escapeHtml(template.key)}" ${template.key === (task.templateKey || "custom") ? "selected" : ""}>${escapeHtml(template.label)}</option>`).join("")}
    </select>
    <input id="taskEditTitle" class="modal-input" type="text" value="${task.title}">
    <select id="taskEditProject" class="comment-filter-select">
      ${getWorkspaceProjects(state.currentWorkspaceId).filter((project) => !project.isWorkspaceRoot).map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === task.projectId ? "selected" : ""}>${escapeHtml(project.title)}</option>`).join("")}
    </select>
    <select id="taskEditScene" class="comment-filter-select">
      <option value="">General task</option>
      ${scenes.map((scene) => `<option value="${escapeHtml(scene.sceneId)}" ${scene.sceneId === task.sceneId ? "selected" : ""}>${escapeHtml(scene.label)}</option>`).join("")}
    </select>
    <select id="taskEditLine" class="comment-filter-select">
      <option value="">Scene level</option>
      ${lines.map((line) => `<option value="${escapeHtml(line.lineId)}" ${line.lineId === task.lineId ? "selected" : ""}>${escapeHtml(line.label)}</option>`).join("")}
    </select>
    <select id="taskEditAssignee" class="comment-filter-select">
      ${assignees.map((assignee) => `<option value="${escapeHtml(assignee.id)}" ${assignee.id === task.assignedTo ? "selected" : ""}>${escapeHtml(assignee.label)}</option>`).join("")}
    </select>
    <select id="taskEditStatus" class="comment-filter-select">
      <option value="todo" ${task.status === "todo" ? "selected" : ""}>To Do</option>
      <option value="in-progress" ${task.status === "in-progress" ? "selected" : ""}>In Progress</option>
      <option value="done" ${task.status === "done" ? "selected" : ""}>Done</option>
    </select>
    <select id="taskEditPriority" class="comment-filter-select">
      <option value="normal" ${(task.priority || "normal") === "normal" ? "selected" : ""}>Priority: Normal</option>
      <option value="high" ${(task.priority || "normal") === "high" ? "selected" : ""}>Priority: High</option>
      <option value="low" ${(task.priority || "normal") === "low" ? "selected" : ""}>Priority: Low</option>
    </select>
    <input id="taskEditDueAt" class="modal-input" type="datetime-local" value="${task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : ""}">
    <select id="taskEditAiStart" class="comment-filter-select">
      <option value="now" ${!task.aiStartAt ? "selected" : ""}>Run now</option>
      <option value="in-3m">In 3 mins</option>
      <option value="in-10m">In 10 mins</option>
      <option value="manual" ${task.aiStartAt ? "selected" : ""}>Custom time</option>
    </select>
    <input id="taskEditAiStartManual" class="modal-input" type="datetime-local" value="${task.aiStartAt ? new Date(task.aiStartAt).toISOString().slice(0, 16) : ""}">
    <input id="taskEditReference" class="modal-input" type="text" value="${escapeHtml(task.reference || "")}" placeholder="Scene / block reference (optional)">
    <select id="taskEditMemory" class="comment-filter-select">
      <option value="">Story memory link (optional)</option>
      ${memoryChoices.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === task.memoryLinkId ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
    </select>
    <input id="taskEditHandoff" class="modal-input" type="text" value="${escapeHtml(task.handoffNote || "")}" placeholder="Handoff cue or mention (optional)">
    <textarea id="taskEditDescription" class="collab-textarea workspace-task-description" placeholder="Describe what needs to happen...">${escapeHtml(task.description || "")}</textarea>
    <p id="taskEditTemplateHint" class="modal-copy">${escapeHtml(selectedTemplate.aiInstruction)}</p>
  `;
  container.dataset.workspaceTemplateApplied = task.templateKey || "custom";
  container.querySelector("#taskEditTemplate")?.addEventListener("change", (event) => {
    applyWorkspaceTaskTemplateToForm(container, event.target.value);
  });
  const saved = await showModal({
    title: "Edit Task",
    message: container,
    confirmLabel: "Save"
  });
  if (!saved) return;
  const sceneId = container.querySelector("#taskEditScene")?.value || "";
  const lineId = container.querySelector("#taskEditLine")?.value || "";
  const sceneChoice = scenes.find((scene) => scene.sceneId === sceneId) || null;
  const lineChoice = lines.find((line) => line.lineId === lineId) || null;
  const assignedTo = container.querySelector("#taskEditAssignee")?.value || "";
  const assignee = assignees.find((entry) => entry.id === assignedTo);
  const memoryId = container.querySelector("#taskEditMemory")?.value || "";
  const memoryChoice = memoryChoices.find((entry) => entry.id === memoryId) || null;
  const aiStartAt = assignee?.assigneeType === "system"
    ? resolveAiTaskStart(
        container.querySelector("#taskEditAiStart")?.value || "now",
        container.querySelector("#taskEditAiStartManual")?.value || ""
      )
    : "";
  updateWorkspaceTask(taskId, {
    templateKey: container.querySelector("#taskEditTemplate")?.value || "custom",
    priority: container.querySelector("#taskEditPriority")?.value || task.priority || "normal",
    title: container.querySelector("#taskEditTitle")?.value?.trim() || task.title,
    description: container.querySelector("#taskEditDescription")?.value?.trim() || "",
    dueAt: container.querySelector("#taskEditDueAt")?.value ? new Date(container.querySelector("#taskEditDueAt").value).toISOString() : "",
    projectId: lineChoice?.projectId || sceneChoice?.projectId || container.querySelector("#taskEditProject")?.value || task.projectId,
    sceneId: lineChoice?.sceneId || sceneChoice?.sceneId || "",
    sceneLabel: lineChoice?.sceneLabel || sceneChoice?.label || "",
    lineId: lineChoice?.lineId || sceneChoice?.lineId || "",
    lineLabel: lineChoice?.lineLabel || "",
    assignedTo,
    assignedLabel: assignee?.label || "Unassigned",
    assigneeType: assignee?.assigneeType || "human",
    handoffNote: container.querySelector("#taskEditHandoff")?.value?.trim() || "",
    memoryLinkType: memoryChoice?.type || "",
    memoryLinkId: memoryChoice?.id || "",
    memoryLinkName: memoryChoice?.name || "",
    memoryProjectId: memoryChoice?.projectId || "",
    aiStartAt,
    aiState: assignee?.assigneeType === "system"
      ? (task.aiState === "review" || task.aiState === "applied" || task.aiState === "dismissed"
          ? task.aiState
          : (aiStartAt ? "scheduled" : "ready"))
      : "idle",
    status: container.querySelector("#taskEditStatus")?.value || task.status,
    reference: container.querySelector("#taskEditReference")?.value?.trim() || ""
  });
}

async function deleteWorkspaceTask(taskId) {
  const confirmed = await customConfirm("Delete this task and its comments?", "Delete Task");
  if (!confirmed) return;
  clearAiTaskTimer(taskId);
  updateWorkspaceAcrossProjects(state.currentWorkspaceId, (workspace) => ({
    ...workspace,
    tasks: (workspace.tasks || []).filter((task) => task.id !== taskId)
  }));
  persistProjects(true, { syncInputs: false });
  renderWorkspaceView();
  showToast("Task deleted.", "success");
}

async function commentOnWorkspaceTask(taskId) {
  const task = getWorkspaceTaskById(taskId);
  if (!task) return;
  const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId);
  const assignees = workspaceProject ? getWorkspaceTaskAssignees(workspaceProject).filter((entry) => entry.assigneeType === "human") : [];
  const container = document.createElement("div");
  container.className = "workspace-task-comments";
  container.innerHTML = `
    <div class="workspace-task-comment-list">
      ${task.comments?.length ? [...task.comments].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map((comment) => `
        <article class="workspace-task-comment">
          <div class="workspace-task-comment-head">
            <strong>${escapeHtml(comment.author || "Workspace member")}</strong>
            <span>${escapeHtml(formatDateTime(comment.createdAt))}</span>
          </div>
          ${comment.mentionLabel ? `<span class="workspace-task-comment-mention">Mentioned ${escapeHtml(comment.mentionLabel)}</span>` : ""}
          <p>${escapeHtml(comment.text)}</p>
        </article>
      `).join("") : '<p class="workspace-home-empty">No task comments yet.</p>'}
    </div>
    <select id="workspaceTaskCommentMention" class="comment-filter-select">
      <option value="">Mention teammate (optional)</option>
      ${assignees.map((assignee) => `<option value="${escapeHtml(assignee.id)}">${escapeHtml(assignee.label)}</option>`).join("")}
    </select>
    <textarea id="workspaceTaskCommentText" class="collab-textarea" placeholder="Add a comment..."></textarea>
  `;
  const shouldAdd = await showModal({
    title: task.title,
    message: container,
    confirmLabel: "Add Comment"
  });
  if (!shouldAdd) return;
  const text = container.querySelector("#workspaceTaskCommentText")?.value?.trim();
  if (!text) return;
  const mentionId = container.querySelector("#workspaceTaskCommentMention")?.value || "";
  const mention = assignees.find((entry) => entry.id === mentionId);
  updateWorkspaceTask(taskId, {
    comments: [
      ...(task.comments || []),
      {
        id: uid("task-comment"),
        text,
        author: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member",
        mentionId,
        mentionLabel: mention?.label || "",
        createdAt: new Date().toISOString()
      }
    ]
  });
  createWorkspaceNotification({
    task,
    category: "comment",
    title: "New task comment",
    message: `${task.title} has a new comment.`,
    actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
  });
  if (mention) {
    createWorkspaceNotification({
      task,
      category: "comment",
      title: "Task mention",
      message: `${task.title} mentioned ${mention.label}.`,
      actor: auth.currentUser?.displayName || auth.currentUser?.email || "Workspace member"
    });
  }
  showToast("Comment added to task.", "success");
}

export function bindEvents() {
  syncAiTaskSchedules();
  applyWorkspaceTaskTemplateToForm(refs.workspaceDashboard, "custom", { force: true });
  // Navigation
  refs.newProjectBtn.addEventListener("click", () => {
    launchNewCreationFlow();
  });

  refs.workspaceNewProjectBtn?.addEventListener("click", () => {
    createProjectInsideCurrentWorkspace();
  });

  refs.workspaceBackBtn?.addEventListener("click", () => {
    state.currentWorkspaceId = null;
    persistProjects(false, { syncInputs: false });
    showHome();
    renderHome();
  });

  refs.workspaceCloseBtn?.addEventListener("click", () => {
    persistProjects(true, { syncInputs: false });
    state.currentWorkspaceId = null;
    showHome();
    renderHome();
  });

  // Workspace project grid – open project cards inside the workspace view
  refs.workspaceProjectGrid?.addEventListener("click", (e) => {
    const openBtn = e.target.closest(".project-card-open");
    if (openBtn && openBtn.dataset.projectId) {
      openProject(openBtn.dataset.projectId);
      return;
    }
    const workspaceTrigger = e.target.closest("[data-open-workspace-id]");
    if (workspaceTrigger) {
      openWorkspaceDashboard(workspaceTrigger.dataset.openWorkspaceId);
      return;
    }
    const card = e.target.closest(".project-card");
    if (!card) return;
    const projectId = card.dataset.projectId;
    if (e.target.closest(".project-delete")) {
      removeProject(projectId);
    } else if (e.target.closest('[data-project-action="rename"]')) {
      renameProjectById(projectId);
    } else if (e.target.closest('[data-project-action="duplicate"]')) {
      duplicateProjectById(projectId);
    } else {
      openProject(projectId);
    }
  });

  refs.workspaceView?.addEventListener("change", (event) => {
    const workspaceSwitch = event.target.closest("[data-workspace-switch]");
    if (!workspaceSwitch) return;
    openWorkspaceDashboard(workspaceSwitch.value);
  });

  refs.homeWorkspaceDashboard?.addEventListener("click", (event) => {
    const filterTrigger = event.target.closest("[data-home-project-filter]");
    if (filterTrigger) {
      state.homeProjectFilter = filterTrigger.dataset.homeProjectFilter || "all";
      renderHome();
      return;
    }
    // Delegate workspace-home-action clicks from the home workspace dashboard
    const action = event.target.closest("[data-workspace-home-action]")?.dataset.workspaceHomeAction;
    if (!action) return;
    if (action === "add-task") {
      addWorkspaceTaskFromContainer(refs.homeWorkspaceDashboard);
      return;
    }
    if (action === "new-project") {
      createProjectInsideCurrentWorkspace();
      return;
    }
    if (action === "open-popup") {
      showWorkspacePopup();
      return;
    }
    if (action === "edit-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) editWorkspaceTask(taskId);
      return;
    }
    if (action === "delete-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) deleteWorkspaceTask(taskId);
      return;
    }
    if (action === "open-task-project") {
      const trigger = event.target.closest("[data-task-project-id]");
      const projectId = trigger?.dataset.taskProjectId;
      const taskId = trigger?.dataset.taskId;
      const task = taskId ? getWorkspaceTaskById(taskId) : null;
      if (projectId) openProject(projectId, { focusLineId: task?.lineId || task?.sceneId || "" });
      return;
    }
    if (action === "mark-all-notifications-read") {
      markAllWorkspaceNotificationsRead();
      return;
    }
    if (action === "mark-notification-read") {
      const notificationId = event.target.closest("[data-notification-id]")?.dataset.notificationId;
      if (notificationId) markWorkspaceNotificationRead(notificationId, true);
      return;
    }
    if (action === "open-notification") {
      const trigger = event.target.closest("[data-notification-id]");
      const projectId = trigger?.dataset.taskProjectId;
      const notificationId = trigger?.dataset.notificationId;
      if (notificationId && !notificationId.startsWith("due-")) markWorkspaceNotificationRead(notificationId, true);
      if (projectId) {
        const notification = getWorkspaceNotifications().find((item) => item.id === notificationId);
        const task = notification?.taskId ? getWorkspaceTaskById(notification.taskId) : null;
        openProject(projectId, { focusLineId: task?.lineId || task?.sceneId || "" });
      }
      return;
    }
    if (action === "comment-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) commentOnWorkspaceTask(taskId);
      return;
    }
    if (action === "review-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) reviewAiTaskResult(taskId);
      return;
    }
    if (action === "run-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) runAiTask(taskId);
      return;
    }
    if (action === "set-task-filter") {
      state.workspaceTaskFilter = event.target.closest("[data-task-filter]")?.dataset.taskFilter || "all";
      renderHome();
      return;
    }
  });

  refs.homeWorkspaceDashboard?.addEventListener("change", (event) => {
    const formatSelect = event.target.closest("[data-home-project-format]");
    if (formatSelect) {
      state.homeProjectFormat = formatSelect.value || "all";
      renderHome();
      return;
    }
    const workspaceSelect = event.target.closest("[data-home-workspace-filter]");
    if (workspaceSelect) {
      state.homeWorkspaceFilter = workspaceSelect.value || "all";
      renderHome();
      return;
    }
    const sortSelect = event.target.closest("[data-home-project-sort]");
    if (sortSelect) {
      state.homeProjectSort = sortSelect.value || "latest";
      renderHome();
      return;
    }
    // Task status change within home workspace dashboard
    const statusSelect = event.target.closest("[data-workspace-task-status]");
    if (statusSelect) {
      updateWorkspaceTask(statusSelect.dataset.workspaceTaskStatus, { status: statusSelect.value });
      renderHome();
      return;
    }
    // Task template change
    const templateSelect = event.target.closest("[data-workspace-task-template]");
    if (templateSelect) {
      applyWorkspaceTaskTemplateToForm(refs.homeWorkspaceDashboard, templateSelect.value);
    }
  });

  refs.homeProjectsSubtitle?.addEventListener("click", (event) => {
    const filterTrigger = event.target.closest("[data-home-project-filter]");
    if (!filterTrigger) return;
    state.homeProjectFilter = filterTrigger.dataset.homeProjectFilter || "all";
    renderHome();
  });

  refs.homeProjectsSubtitle?.addEventListener("change", (event) => {
    const formatSelect = event.target.closest("[data-home-project-format]");
    if (formatSelect) {
      state.homeProjectFormat = formatSelect.value || "all";
      renderHome();
      return;
    }
    const workspaceSelect = event.target.closest("[data-home-workspace-filter]");
    if (workspaceSelect) {
      state.homeWorkspaceFilter = workspaceSelect.value || "all";
      renderHome();
      return;
    }
    const sortSelect = event.target.closest("[data-home-project-sort]");
    if (!sortSelect) return;
    state.homeProjectSort = sortSelect.value || "latest";
    renderHome();
  });

  refs.workspaceDashboard?.addEventListener("click", (event) => {
    const profileTrigger = event.target.closest("[data-profile-uid]");
    if (profileTrigger) {
      showCollabProfile({
        uid: profileTrigger.dataset.profileUid || "",
        name: profileTrigger.dataset.profileName || "",
        photoURL: profileTrigger.dataset.profilePhotourl || ""
      });
      return;
    }
    const action = event.target.closest("[data-workspace-home-action]")?.dataset.workspaceHomeAction;
    if (!action) return;
    if (action === "new-project") {
      createProjectInsideCurrentWorkspace();
      return;
    }
    if (action === "open-popup") {
      showWorkspacePopup();
      return;
    }
    if (action === "add-task") {
      addWorkspaceTaskFromDashboard();
      return;
    }
    if (action === "mark-all-notifications-read") {
      markAllWorkspaceNotificationsRead();
      return;
    }
    if (action === "mark-notification-read") {
      const notificationId = event.target.closest("[data-notification-id]")?.dataset.notificationId;
      if (notificationId) markWorkspaceNotificationRead(notificationId, true);
      return;
    }
    if (action === "set-task-filter") {
      state.workspaceTaskFilter = event.target.closest("[data-task-filter]")?.dataset.taskFilter || "all";
      renderWorkspaceView();
      return;
    }
    if (action === "edit-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) editWorkspaceTask(taskId);
      return;
    }
    if (action === "delete-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) deleteWorkspaceTask(taskId);
      return;
    }
    if (action === "comment-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) commentOnWorkspaceTask(taskId);
      return;
    }
    if (action === "open-task-project") {
      const trigger = event.target.closest("[data-task-project-id]");
      const projectId = trigger?.dataset.taskProjectId;
      const taskId = trigger?.dataset.taskId;
      const task = taskId ? getWorkspaceTaskById(taskId) : null;
      if (projectId) {
        openProject(projectId, { focusLineId: task?.lineId || task?.sceneId || "" });
      }
      return;
    }
    if (action === "open-task-memory") {
      const trigger = event.target.closest("[data-memory-project-id]");
      const projectId = trigger?.dataset.memoryProjectId;
      if (projectId) {
        openProject(projectId);
      }
      setTimeout(() => {
        showStoryMemoryPopup();
      }, 60);
      return;
    }
    if (action === "open-notification") {
      const trigger = event.target.closest("[data-notification-id]");
      const projectId = trigger?.dataset.taskProjectId;
      const notificationId = trigger?.dataset.notificationId;
      if (notificationId && !notificationId.startsWith("due-")) markWorkspaceNotificationRead(notificationId, true);
      if (projectId) {
        const notification = getWorkspaceNotifications().find((item) => item.id === notificationId);
        const task = notification?.taskId
          ? getWorkspaceTaskById(notification.taskId)
          : (trigger?.dataset.taskId ? getWorkspaceTaskById(trigger.dataset.taskId) : null);
        openProject(projectId, { focusLineId: task?.lineId || task?.sceneId || "" });
      }
      return;
    }
    if (action === "run-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) runAiTask(taskId);
      return;
    }
    if (action === "review-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) reviewAiTaskResult(taskId);
      return;
    }
    if (action === "apply-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) applyAiTaskResult(taskId);
      return;
    }
    if (action === "dismiss-ai-task") {
      const taskId = event.target.closest("[data-task-id]")?.dataset.taskId;
      if (taskId) dismissAiTaskResult(taskId);
      return;
    }
  });

  refs.workspaceDashboard?.addEventListener("change", (event) => {
    const templateSelect = event.target.closest("[data-workspace-task-template]");
    if (templateSelect) {
      applyWorkspaceTaskTemplateToForm(refs.workspaceDashboard, templateSelect.value);
      return;
    }
    const taskSortSelect = event.target.closest("[data-workspace-home-action='set-task-sort']");
    if (taskSortSelect) {
      state.workspaceTaskSort = taskSortSelect.value || "latest";
      renderWorkspaceView();
      return;
    }
    const statusSelect = event.target.closest("[data-workspace-task-status]");
    if (statusSelect) {
      updateWorkspaceTask(statusSelect.dataset.workspaceTaskStatus, { status: statusSelect.value });
    }
  });

  refs.goHomeBtn.addEventListener("click", () => {
    saveAndGoHome();
  });

  document.getElementById("addStoryElementBtn")?.addEventListener("click", () => {
    showStoryMemoryBuilder();
  });

  document.getElementById("smartProofreadBtn")?.addEventListener("click", () => {
    AI.triggerSmartProofread();
  });
  document.addEventListener("selectionchange", () => {
    window.requestAnimationFrame(updateSelectionToolbar);
  });
  window.addEventListener("resize", hideSelectionToolbar);
  refs.screenplayEditor?.addEventListener("scroll", hideSelectionToolbar);

  // Meta Inputs
  [refs.titleInput, refs.authorInput, refs.contactInput, refs.companyInput, refs.detailsInput, refs.loglineInput]
    .forEach((input) => input.addEventListener("input", handleMetaInput));

  // Tool Selection
  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => handleToolSelection(button.dataset.insert));
  });

  // Menus and Themes
  refs.menuTriggers.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu(button.dataset.menuTrigger);
    });
    button.addEventListener("mouseenter", () => {
      if (window.innerWidth > 900) {
        toggleMenu(button.dataset.menuTrigger, true);
      }
    });
  });

  document.querySelectorAll(".nav-menu").forEach((menu) => {
    menu.addEventListener("mouseleave", () => {
      if (window.innerWidth > 900) {
        closeMenus();
      }
    });
    // Accordion behavior for menu groups
    menu.addEventListener("click", (e) => {
      const summary = e.target.closest(".menu-group-summary");
      if (summary) {
        const details = summary.parentElement;
        if (!details.open) {
          menu.querySelectorAll(".menu-group[open]").forEach((group) => {
            if (group !== details) group.removeAttribute("open");
          });
        }
      }
    });
  });

  refs.themeButtons.forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeValue));
  });

  refs.languageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setLanguage(button.dataset.languageValue);
      renderHome();
      if (!refs.studioView.hidden) {
        renderStudio();
      }
      persistProjects(false);
      closeMenus();
    });
  });

  refs.writingLanguageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setWritingLanguage(button.dataset.writingLanguageValue);
      primeSpellingDictionary();
      persistProjects(false);
      closeMenus();
    });
  });

  refs.localBackupToggle?.addEventListener("change", () => {
    toggleLocalBackup(refs.localBackupToggle.checked);
  });
  refs.localSaveInterval?.addEventListener("change", () => {
    const value = parseInt(refs.localSaveInterval.value, 10);
    state.localSaveIntervalMinutes = [5, 10, 60].includes(value) ? value : 5;
    persistProjects(false);
    if (state.localBackupEnabled && state.localSaveFileHandle) {
      startLocalSaveTimer();
    }
  });
  refs.chooseLocalSaveFileBtn?.addEventListener("click", async () => {
    const result = await chooseLocalSaveFile();
    if (result.ok) {
      startLocalSaveTimer();
    } else if (result.reason === "unsupported") {
      customAlert("Local save requires a Chromium-based browser (Chrome, Edge, Opera).");
    }
  });

  document.querySelectorAll("[data-menu-action]").forEach((button) => {
    button.addEventListener("click", () => handleMenuAction(button.dataset.menuAction));
  });

  document.querySelectorAll("[data-format-type]").forEach((button) => {
    button.addEventListener("click", () => {
      handleToolSelection(button.dataset.formatType);
      closeMenus();
    });
  });

  // View Options
  document.querySelectorAll("[data-view-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
        const optionKey = button.dataset.viewToggle;
        state.viewOptions[optionKey] = !state.viewOptions[optionKey];
        applyViewState();
        renderPreview();
        queueSave();
    });
  });

  document.querySelectorAll("[data-text-size]").forEach((button) => {
    button.addEventListener("click", () => {
        state.viewOptions.textSize = parseInt(button.dataset.textSize);
        applyViewState();
        queueSave();
        closeMenus();
    });
  });

  // Project Actions
  refs.saveBtn.addEventListener("click", () => persistProjects(true));
  refs.exportTxtBtn.addEventListener("click", exportTxt);
  refs.exportJsonBtn.addEventListener("click", exportJson);
  refs.exportWordBtn.addEventListener("click", exportWord);
  refs.exportPdfBtn.addEventListener("click", exportPdf);
  refs.fileInput.addEventListener("change", importFile);

  refs.autoNumberToggle.addEventListener("change", () => {
    state.autoNumberScenes = refs.autoNumberToggle.checked;
    renderStudio();
    queueSave();
  });

  const syncBgAnim = (enabled) => {
    state.backgroundAnimation = enabled;
    if (refs.bgAnimationToggle) refs.bgAnimationToggle.checked = enabled;
    if (refs.bgAnimationLandingToggle) refs.bgAnimationLandingToggle.checked = enabled;
    applyToolbarState();
    persistProjects(false);
  };

  refs.bgAnimationToggle?.addEventListener("change", () => {
    syncBgAnim(refs.bgAnimationToggle.checked);
  });

  refs.bgAnimationLandingToggle?.addEventListener("change", () => {
    syncBgAnim(refs.bgAnimationLandingToggle.checked);
  });

  refs.aiAssistToggle.addEventListener("change", () => {
    state.aiAssist = refs.aiAssistToggle.checked;
    refs.aiPanel.hidden = !state.aiAssist;
    applyToolbarState();
    queueSave();
    updateSelectionToolbar();
  });

  refs.grammarCheckToggle.addEventListener("change", () => {
    setGrammarCheck(refs.grammarCheckToggle.checked);
    queueSave();
    updateSelectionToolbar();
  });

  refs.aiSuggestBtn.addEventListener("click", insertAiAssistNote);

  // Layout Toggles
  refs.leftRailToggle?.addEventListener("click", () => {
    togglePane("left");
    setButtonGlyph(refs.leftRailToggle, refs.leftPane.classList.contains("is-hidden") ? "&#9654;" : "&#9664;");
  });
  refs.rightRailToggle?.addEventListener("click", () => {
    togglePane("right");
    setButtonGlyph(refs.rightRailToggle, refs.rightPane.classList.contains("is-hidden") ? "&#9664;" : "&#9654;");
  });
  refs.toolStripToggle.addEventListener("click", () => {
        state.toolStripCollapsed = !state.toolStripCollapsed;
        applyToolbarState();
        setButtonGlyph(refs.toolStripToggle, state.toolStripCollapsed ? "&#9660;" : "&#9650;");
        persistProjects(false);
    });

  refs.quickDisplayBg?.addEventListener("change", () => {
    state.backgroundAnimation = refs.quickDisplayBg.checked;
    applyToolbarState();
    persistProjects(false);
  });
  refs.quickDisplayActiveBlock?.addEventListener("change", () => {
    const shouldShow = refs.quickDisplayActiveBlock.checked;
    refs.leftPane.classList.toggle("is-hidden", !shouldShow);
    refs.leftResize?.classList.toggle("is-hidden", !shouldShow);
    refs.studioLayout.classList.toggle("left-pane-hidden", !shouldShow);
    applyViewState();
    persistProjects(false);
  });
  refs.quickDisplayPreview?.addEventListener("change", () => {
    const shouldShow = refs.quickDisplayPreview.checked;
    refs.rightPane.classList.toggle("is-hidden", !shouldShow);
    refs.rightResize?.classList.toggle("is-hidden", !shouldShow);
    refs.studioLayout.classList.toggle("right-pane-hidden", !shouldShow);
    applyViewState();
    persistProjects(false);
  });
  refs.quickDisplayFocusMode?.addEventListener("change", () => {
    state.viewOptions.focusMode = refs.quickDisplayFocusMode.checked;
    if (!state.viewOptions.focusMode) {
      clearTimeout(focusModeTimer);
      document.body.classList.remove("focus-mode-active");
    }
    applyViewState();
    persistProjects(false);
  });
  refs.quickDisplayFullscreen?.addEventListener("change", () => {
    if (refs.quickDisplayFullscreen.checked) {
      document.documentElement.requestFullscreen?.();
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    applyViewState();
  });

  refs.leftPaneSectionToggle.addEventListener("click", () => {
    togglePaneSection(refs.leftPaneBody, refs.leftPaneSectionToggle);
    setButtonGlyph(refs.leftPaneSectionToggle, refs.leftPaneBody.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;");
  });
  refs.rightPaneSectionToggle.addEventListener("click", () => {
    togglePaneSection(refs.rightPaneBody, refs.rightPaneSectionToggle);
    setButtonGlyph(refs.rightPaneSectionToggle, refs.rightPaneBody.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;");
  });

  refs.leftPaneBody.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-left-pane-section-toggle]");
    if (toggle) {
      toggleLeftPaneSection(toggle.dataset.leftPaneSectionToggle);
    }
  });

  refs.leftPaneBlockControls?.addEventListener("click", (event) => {
    const moveBtn = event.target.closest("[data-left-pane-move]");
    if (moveBtn) {
      moveLeftPaneBlock(moveBtn.dataset.leftPaneKey, moveBtn.dataset.leftPaneMove);
    }
  });

  refs.leftPaneBlockControls?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-left-pane-visibility]");
    if (checkbox) {
      setLeftPaneBlockVisibility(checkbox.dataset.leftPaneVisibility, checkbox.checked);
    }
  });

  window.addEventListener("workspaceInviteRequested", async (event) => {
    const email = event.detail?.email;
    const role = event.detail?.role || "editor";
    if (!email) {
      return;
    }
    const result = await inviteCollaborator(email, role);
    window.dispatchEvent(new CustomEvent("workspaceInviteResult", { detail: result }));
    if (result?.ok) {
      await customAlert("Workspace invite sent.", "Workspace");
    } else if (result?.reason) {
      await customAlert(result.reason, "Workspace");
    }
  });

  window.addEventListener("workspaceRenameRequested", async (event) => {
    const result = await renameWorkspace(event.detail?.projectId, event.detail?.name);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Workspace name saved." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceRoleChangeRequested", async (event) => {
    const result = await updateCollaboratorRole(event.detail?.projectId, event.detail?.collaboratorUid, event.detail?.role);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Member role updated." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceReminderRequested", async (event) => {
    const result = await addWorkspaceReminder(event.detail?.projectId, {
      text: event.detail?.text,
      dueAt: event.detail?.dueAt
    });
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Reminder added." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceReminderToggleRequested", async (event) => {
    const result = await toggleWorkspaceReminder(event.detail?.projectId, event.detail?.reminderId);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Reminder updated." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceReminderDeleteRequested", async (event) => {
    const result = await deleteWorkspaceReminder(event.detail?.projectId, event.detail?.reminderId);
    window.dispatchEvent(new CustomEvent("workspaceMutationResult", {
      detail: { ...result, message: result.ok ? "Reminder deleted." : "" }
    }));
    if (result.ok) renderStudio();
  });

  window.addEventListener("workspaceMemberProfileRequested", (event) => {
    showCollabProfile({
      uid: event.detail?.uid || "",
      name: event.detail?.name || "",
      photoURL: event.detail?.photoURL || ""
    });
  });

  refs.duplicateProjectBtn.addEventListener("click", duplicateProject);
  refs.deleteProjectBtn.addEventListener("click", deleteProject);

  initResizeHandle(refs.leftResize, "left");
  initResizeHandle(refs.rightResize, "right");

  refs.helpBtn.addEventListener("click", () => refs.helpDialog.showModal());
  document.querySelectorAll('[data-home-nav="shortcuts"]').forEach(btn => {
      btn.addEventListener("click", () => refs.helpDialog.showModal());
  });

  // Global Keys & Clicks
  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("click", (event) => {
      if (!event.target.closest(".nav-stack")) {
        closeMenus();
      }
      if (!event.target.closest("#suggestionTray") && !event.target.closest(".script-block")) {
        hideSuggestionTray(true);
        clearSuggestionContext();
      }
  });

  // Delegated Editor Events
  refs.screenplayEditor.addEventListener("focusin", (e) => {
      if (e.target.classList.contains("script-block")) {
          setActiveBlock(e.target.dataset.id);
      }
  });

  refs.screenplayEditor.addEventListener("click", async (e) => {
    const taskMarker = e.target.closest("[data-script-task-target]");
    if (taskMarker) {
      const [firstTaskId] = String(taskMarker.dataset.taskIds || "").split(",").filter(Boolean);
      if (firstTaskId) {
        await commentOnWorkspaceTask(firstTaskId);
      }
      return;
    }
    const block = e.target.closest(".script-block");
    if (block) {
        setActiveBlock(block.dataset.id);
        await maybeShowSpellingSuggestions(block, e.target, e.clientX, e.clientY);
    }
    if (e.target.closest(".scene-toggle")) {
        const row = e.target.closest(".script-block-row");
        toggleSceneCollapse(row.dataset.id);
    }
  });

  refs.screenplayEditor.addEventListener("input", (e) => {
      if (e.target.classList.contains("script-block")) {
          handleBlockInput(e.target.dataset.id, e.target);
      }
  });

  refs.screenplayEditor.addEventListener("keydown", (e) => {
      if (e.target.classList.contains("script-block")) {
          handleBlockKeydown(e, e.target.dataset.id);
      }
  });

  refs.screenplayEditor.addEventListener("contextmenu", (e) => {
    const target = e.target.nodeType === Node.TEXT_NODE ? e.target.parentElement : e.target;
    const block = target?.closest?.(".script-block");
    if (block?.dataset?.id) {
      setActiveBlock(block.dataset.id);
    }
    e.preventDefault();
    e.stopPropagation();
    ContextMenu.show(e.clientX, e.clientY, block || getActiveEditableBlock());
  });

  refs.screenplayEditor.addEventListener("copy", (e) => {
      const selection = window.getSelection();
      if (selection.isCollapsed) return;

      const project = getCurrentProject();
      if (!project) return;

      const selectedLines = [];
      const range = selection.getRangeAt(0);
      const blocks = refs.screenplayEditor.querySelectorAll(".script-block");

      blocks.forEach(block => {
          if (selection.containsNode(block, true)) {
              const line = getLine(block.dataset.id);
              if (line) selectedLines.push(line.text);
          }
      });

      if (selectedLines.length > 0) {
          e.clipboardData.setData("text/plain", selectedLines.join("\n"));
          e.preventDefault();
      }
  });

  refs.screenplayEditor.addEventListener("paste", (e) => {
      if (!e.target.classList.contains("script-block")) return;

      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;

      const pastedLines = text.split(/\r?\n/);
      const project = getCurrentProject();
      const activeId = state.activeBlockId;
      if (!project || !activeId) return;

      const index = getLineIndex(activeId);
      const currentLine = project.lines[index];
      const offset = getCaretOffset(e.target);

      const textBefore = currentLine.text.substring(0, offset);
      const textAfter = currentLine.text.substring(offset);

      if (pastedLines.length === 1) {
          // Simple single line paste
          currentLine.text = textBefore + pastedLines[0] + textAfter;
          renderStudio();
          focusBlock(activeId);
          setCaretOffset(refs.screenplayEditor.querySelector(`.script-block[data-id="${activeId}"]`), offset + pastedLines[0].length);
      } else {
          // Multi-line natural paste
          // 1. Update current block with text before cursor + first pasted line
          currentLine.text = textBefore + pastedLines[0];

          // 2. Create new blocks for middle lines
          const middleLines = pastedLines.slice(1, -1);
          const newBlocks = middleLines.map(content => ({
              id: uid(),
              type: inferTypeFromText(content, "", ""),
              text: content
          }));

          // 3. Create final block with last pasted line + text after cursor
          const lastContent = pastedLines[pastedLines.length - 1];
          const finalBlock = {
              id: uid(),
              type: inferTypeFromText(lastContent, "", ""),
              text: lastContent + textAfter
          };

          project.lines.splice(index + 1, 0, ...newBlocks, finalBlock);

          project.updatedAt = new Date().toISOString();
          renderStudio();
          focusBlock(finalBlock.id);
          setCaretOffset(refs.screenplayEditor.querySelector(`.script-block[data-id="${finalBlock.id}"]`), lastContent.length);
      }

      queueSave();
  });

  // Project Grid (Delegated)
  refs.projectGrid.addEventListener("click", (e) => {
      const filterTrigger = e.target.closest("[data-home-project-filter]");
      if (filterTrigger) {
          state.homeProjectFilter = filterTrigger.dataset.homeProjectFilter || "all";
          renderHome();
          return;
      }
      const formatSelect = e.target.closest("[data-home-project-format]");
      if (formatSelect) {
          state.homeProjectFormat = formatSelect.value || "all";
          renderHome();
          return;
      }
      const workspaceTrigger = e.target.closest("[data-open-workspace-id]");
      if (workspaceTrigger) {
          openWorkspaceDashboard(workspaceTrigger.dataset.openWorkspaceId);
          return;
      }
      const card = e.target.closest(".project-card");
      if (!card) return;
      const projectId = card.dataset.projectId;

      if (e.target.closest(".project-delete")) {
          removeProject(projectId);
      } else if (e.target.closest('[data-project-action="rename"]')) {
          renameProjectById(projectId);
      } else if (e.target.closest('[data-project-action="duplicate"]')) {
          duplicateProjectById(projectId);
      } else {
          openProject(projectId);
      }
  });

  // Recent Projects (Delegated)
  [refs.homeRecentProjects, refs.studioRecentProjects].forEach(container => {
      if (!container) return;
      container.addEventListener("click", (e) => {
        const btn = e.target.closest(".recent-project-button");
        if (btn) {
            openProject(btn.dataset.projectId);
            closeMenus();
        }
      });
  });

  // Suggestion Tray (Delegated)
  refs.suggestionList.addEventListener("click", (e) => {
      const btn = e.target.closest(".suggestion-pill");
      if (btn) {
          e.preventDefault();
          e.stopPropagation();
          applySuggestion(btn.dataset.suggestionValue);
      }
  });

  // Scene/Character List (Delegated)
  refs.sceneList.addEventListener("click", (e) => {
      const item = e.target.closest(".list-item");
      if (item) focusBlock(item.dataset.lineId);
  });

  refs.characterList?.addEventListener("click", (e) => {
      const item = e.target.closest(".list-item");
      if (!item) return;

      if (e.target.closest(".list-item-meta")) {
          e.preventDefault();
          e.stopPropagation();
          showCharacterScenes(item.dataset.characterName, (id) => focusBlock(id));
      } else {
          focusBlock(item.dataset.lineId);
      }
  });

  // Collaboration events
  const collabInviteBtn = document.getElementById('collabInviteBtn');
  const collabInviteEmail = document.getElementById('collabInviteEmail');
  const collabInviteStatus = document.getElementById('collabInviteStatus');
  if (collabInviteBtn && collabInviteEmail) {
    collabInviteBtn.addEventListener('click', async () => {
      const email = collabInviteEmail.value.trim();
      if (!email) return;
      collabInviteBtn.disabled = true;
      let result;
      try {
        result = await inviteCollaborator(email);
      } catch (err) {
        result = { ok: false, reason: err.message || 'An error occurred.' };
      }
      collabInviteBtn.disabled = false;
      if (collabInviteStatus) {
        collabInviteStatus.textContent = result.ok ? 'Invitation sent!' : result.reason;
        collabInviteStatus.className = `collab-status-msg${result.ok ? ' collab-status-ok' : ' collab-status-err'}`;
        setTimeout(() => { collabInviteStatus.textContent = ''; collabInviteStatus.className = 'collab-status-msg'; }, 5000);
      }
      if (result.ok) { collabInviteEmail.value = ''; renderCollaboratorList(); }
    });
    collabInviteEmail.addEventListener('keydown', e => {
      if (e.key === 'Enter') collabInviteBtn.click();
    });
  }

  const collabAddCommentBtn = document.getElementById('collabAddCommentBtn');
  const collabCommentText = document.getElementById('collabCommentText');
  if (collabAddCommentBtn && collabCommentText) {
    collabAddCommentBtn.addEventListener('click', async () => {
      const project = getCurrentProject();
      if (!project) return;
      const text = collabCommentText.value?.trim();
      if (!text) return;
      const lineId = state.activeBlockId;
      if (!lineId) {
        await customAlert('Click on a line in the script first — comments must be attached to a specific line.', 'No line selected');
        return;
      }
      await addComment(project.id, text, { lineId });
      collabCommentText.value = '';
    });
  }

  // Re-render studio when a remote collaborator updates the shared project
  window.addEventListener('sharedProjectUpdated', () => {
    if (!refs.studioView?.hidden) renderStudio();
  });

  // Comment compose overlay
  document.getElementById('commentComposeSubmit')?.addEventListener('click', submitCommentCompose);
  document.getElementById('commentComposeCancel')?.addEventListener('click', hideCommentCompose);
  document.getElementById('commentComposeText')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitCommentCompose();
    if (e.key === 'Escape') hideCommentCompose();
  });

  // Left pane comment filters
  document.getElementById('commentFilterUser')?.addEventListener('change', e => setCommentFilter('user', e.target.value));
  document.getElementById('commentFilterStatus')?.addEventListener('change', e => setCommentFilter('status', e.target.value));
  document.getElementById('commentFilterSort')?.addEventListener('change', e => setCommentFilter('sort', e.target.value));
  document.getElementById('viewCommentsBtn')?.addEventListener('click', showCommentPanel);

  // Focus a line from a comment click
  window.addEventListener('focusScriptLine', ({ detail }) => {
    if (detail?.lineId) focusBlock(detail.lineId);
  });

  window.addEventListener('proofreadCleanupApplied', () => {
    renderStudio();
  });

  // Add AIassist (Eya) to workspace when requested
  window.addEventListener("workspaceAddAIAssist", ({ detail }) => {
    const projectId = detail?.projectId;
    if (!projectId) return;
    updateWorkspaceAcrossProjects(state.currentWorkspaceId || projectId, (workspace) => workspace);
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;
    if (!project.collaborators) project.collaborators = {};
    if (!project.collaborators["ai_assist"]) {
      project.collaborators["ai_assist"] = {
        role: "editor",
        name: "Eya",
        email: "ai@eyawriter.app",
        username: "AIassist",
        isAIAssist: true,
        photoURL: ""
      };
      upsertProject(project);
      persistProjects(true, { syncInputs: false });
      showToast("@AIassist (Eya) added to the workspace. AI features are now available to all members.", "success");
    }
  });

  // @mention dropdown for workspace task inputs
  document.addEventListener("input", handleWorkspaceMentionInput);
  document.addEventListener("keydown", handleWorkspaceMentionKeydown);
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#workspaceMentionDropdown")) {
      document.getElementById("workspaceMentionDropdown")?.remove();
    }
  });
}

function getWorkspaceMemberList() {
  const workspaceProject = getWorkspaceRootProject(state.currentWorkspaceId);
  if (!workspaceProject) return [];
  const ownerLabel = workspaceProject.ownerName || workspaceProject.ownerEmail || "Workspace Owner";
  const members = [
    { id: workspaceProject.ownerId || "owner", handle: `@${ownerLabel.replace(/\s+/g, "")}`, label: ownerLabel },
    ...Object.entries(workspaceProject.collaborators || {}).map(([uid, person]) => {
      const name = person.username || person.name || person.email || "Collaborator";
      return { id: uid, handle: `@${name.replace(/\s+/g, "")}`, label: name };
    }),
    { id: "ai_assist", handle: "@AIassist", label: "Eya · AI Assistant" }
  ];
  return members;
}

function handleWorkspaceMentionInput(e) {
  const target = e.target;
  const isTaskInput = target.closest("[data-workspace-task-title], [data-workspace-task-description], [data-workspace-task-handoff]");
  if (!isTaskInput) return;
  const val = target.value || "";
  const cursor = target.selectionStart || 0;
  const textBefore = val.slice(0, cursor);
  const atMatch = textBefore.match(/@(\w*)$/);
  if (!atMatch) {
    document.getElementById("workspaceMentionDropdown")?.remove();
    return;
  }
  const query = atMatch[1].toLowerCase();
  const members = getWorkspaceMemberList().filter((m) => m.handle.toLowerCase().includes(query) || m.label.toLowerCase().includes(query));
  showWorkspaceMentionDropdown(target, members, (handle) => {
    const before = val.slice(0, cursor).replace(/@\w*$/, handle + " ");
    const after = val.slice(cursor);
    target.value = before + after;
    target.selectionStart = target.selectionEnd = before.length;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("workspaceMentionDropdown")?.remove();
  });
}

function handleWorkspaceMentionKeydown(e) {
  const dropdown = document.getElementById("workspaceMentionDropdown");
  if (!dropdown) return;
  if (e.key === "Escape") { dropdown.remove(); return; }
  const items = [...dropdown.querySelectorAll("[data-mention-item]")];
  const active = dropdown.querySelector("[data-mention-item].is-active");
  const idx = items.indexOf(active);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = items[(idx + 1) % items.length];
    items.forEach((el) => el.classList.remove("is-active"));
    next?.classList.add("is-active");
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = items[(idx - 1 + items.length) % items.length];
    items.forEach((el) => el.classList.remove("is-active"));
    prev?.classList.add("is-active");
  } else if (e.key === "Enter" && active) {
    e.preventDefault();
    active.click();
  }
}

function showWorkspaceMentionDropdown(anchor, members, onSelect) {
  document.getElementById("workspaceMentionDropdown")?.remove();
  if (!members.length) return;
  const dropdown = document.createElement("div");
  dropdown.id = "workspaceMentionDropdown";
  dropdown.className = "workspace-mention-dropdown";
  dropdown.innerHTML = members.map((m, i) => `
    <button class="workspace-mention-item${i === 0 ? " is-active" : ""}" type="button" data-mention-item data-handle="${escapeHtml(m.handle)}">
      <strong>${escapeHtml(m.handle)}</strong>
      <span>${escapeHtml(m.label)}</span>
    </button>
  `).join("");
  dropdown.addEventListener("click", (e) => {
    const item = e.target.closest("[data-mention-item]");
    if (item) onSelect(item.dataset.handle);
  });
  const rect = anchor.getBoundingClientRect();
  dropdown.style.position = "fixed";
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.zIndex = "9999";
  document.body.appendChild(dropdown);
}

// Action Handlers
export function openProject(projectId, options = {}) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    if (project.isWorkspaceRoot) {
      openWorkspaceDashboard(project.workspace?.id || project.id);
      return;
    }
    const projectLoadToast = options.silentLoadToast ? null : showToast("Opening project...", "loading", { duration: 0 });
    state.currentProjectId = project.id;
  state.currentWorkspaceId = project.workspace?.id !== project.id ? project.workspace?.id || null : null;
  hasShownReadOnlyNotice = false;

  // Reset history for the new project
  state.history = [];
  state.historyIndex = -1;
  pushHistory();

  state.activeBlockId = project.lines[0]?.id || null;
  state.activeType = project.lines[0]?.type || "action";

  refs.aiAssistToggle.checked = state.aiAssist;
  refs.grammarCheckToggle.checked = state.grammarCheck;
  document.body.classList.toggle("spelling-mode-active", state.grammarCheck);
  document.body.classList.toggle("grammar-mode-active", state.grammarCheck);
  refs.autoNumberToggle.checked = state.autoNumberScenes;
  if (refs.bgAnimationToggle) {
    refs.bgAnimationToggle.checked = state.backgroundAnimation;
  }
  refs.aiPanel.hidden = !state.aiAssist;

  syncInputsFromProject(project);
  showStudio();
  renderStudio();
  onStudioEnter(projectId);
    primeSpellingDictionary();
    if (options.focusLineId) {
      focusBlock(options.focusLineId);
    } else if (state.activeBlockId) {
      focusBlock(state.activeBlockId);
    }

    checkFirstWorkBackup();
    if (projectLoadToast) {
      updateToast(projectLoadToast, "Project opened.", "success", { duration: 1200 });
    }
}

export function renderStudio() {
  const project = getCurrentProject();
  if (!project) return;
  syncInputsFromProject(project);
  renderStudioProjectContext();
  renderEditor();
  renderCoverPreview();
  renderPreview();
  renderSceneList();
  renderCharacterList();
  renderStoryMemory();
  renderMetrics();
  renderCurrentScriptId();
  renderRecentProjectMenus();
  renderLeftPaneLayout();
  applyViewState();
  applyToolbarState();
  if (refs.leftRailToggle) {
    setButtonGlyph(refs.leftRailToggle, refs.leftPane.classList.contains("is-hidden") ? "&#9654;" : "&#9664;");
  }
  if (refs.rightRailToggle) {
    setButtonGlyph(refs.rightRailToggle, refs.rightPane.classList.contains("is-hidden") ? "&#9664;" : "&#9654;");
  }
  setButtonGlyph(refs.leftPaneSectionToggle, refs.leftPaneBody.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;");
  setButtonGlyph(refs.rightPaneSectionToggle, refs.rightPaneBody.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;");
  applyTranslations();
  updateSuggestions();
  updateCommentIcons();
}

export function duplicateActiveBlock() {
  if (!canEditCurrentProjectWithNotice()) return;
  const project = getCurrentProject();
  const index = getLineIndex(state.activeBlockId);
  if (!project || index < 0) {
    return;
  }

  const line = project.lines[index];
  const newId = addBlock(line.type, line.text, index + 1);
  renderStudio();
  focusBlock(newId, true);
  queueSave();
}

function handleMetaInput() {
  syncProjectFromInputs();
  schedulePreviewRefresh({ includeCover: true });
  scheduleStudioSidebarRefresh({ includeHome: false, includeAnalytics: false });
  queueSave();
}

function togglePaneSection(body, button) {
  body.classList.toggle("is-collapsed");
  button.innerHTML = body.classList.contains("is-collapsed") ? "&#9660;" : "&#9650;";
}

function readEditableText(element) {
  if (!element) {
    return "";
  }

  const raw = typeof element.innerText === "string" && element.innerText.length
    ? element.innerText
    : (element.textContent || "");

  return raw
    .replace(/\r/g, "")
    .replace(/\n$/, "");
}

function canEditCurrentProjectWithNotice() {
  const project = getCurrentProject();
  if (canEditProject(project)) {
    hasShownReadOnlyNotice = false;
    return true;
  }

  if (!hasShownReadOnlyNotice) {
    hasShownReadOnlyNotice = true;
    customAlert("Viewer access is read-only. Ask the workspace owner to promote you to Editor if you need to make changes.", "Read-only Workspace");
  }

  return false;
}

function scheduleStudioSidebarRefresh({ includeHome = false, includeAnalytics = true } = {}) {
  if (studioSidebarRefreshFrame) {
    return;
  }

  studioSidebarRefreshFrame = window.requestAnimationFrame(() => {
    studioSidebarRefreshFrame = 0;
    renderSceneList();
    renderCharacterList();
    renderMetrics();
    if (includeHome) {
      renderHome();
    }
    if (includeAnalytics && document.querySelector('[data-left-pane-block="analytics"] .panel-section-body:not([hidden])')) {
      renderAnalytics();
    }
  });
}

function handleBlockInput(id, element) {
  if (!canEditCurrentProjectWithNotice()) {
    renderStudio();
    return;
  }

  const line = getLine(id);
  const project = getCurrentProject();
  if (!line || !project) return;

  // Secondary (right) field of a dual row: update line.secondary only
  if (element.dataset.secondary === "true") {
    const normalized = normalizeLineText(readEditableText(element), "dual", true);
    line.secondary = normalized;
    project.updatedAt = new Date().toISOString();
    setActiveBlock(id);
    schedulePreviewRefresh();
    scheduleStudioSidebarRefresh({ includeHome: false, includeAnalytics: true });
    updateSuggestions();
    setTypingFocusModeActive();
    queueSave();
    return;
  }

  const offset = getCaretOffset(element);
  const beforeText = readEditableText(element);
  let normalized = normalizeLineText(beforeText, line.type, true);
  let autoCompleted = false;

  if (line.type === "character") {
    const completion = getCharacterAutocomplete(normalized, id);
    if (completion && completion !== normalized) {
      const completionSuffix = completion.substring(normalized.length);
      normalized = completion;
      element.textContent = completion;
      selectTextSuffix(element, beforeText.length, completion.length);
      autoCompleted = true;
    }
  }

  if (!autoCompleted && normalized !== beforeText) {
    let newOffset = offset;
    // If we added a '(' at the beginning, shift offset
    if (line.type === "parenthetical" && !beforeText.startsWith("(") && normalized.startsWith("(")) {
        newOffset++;
    }
    if (line.type === "note" && !beforeText.startsWith("[") && normalized.startsWith("[")) {
        newOffset++;
    }

    const activeLine = getLine(state.activeBlockId);
    if (activeLine && (activeLine.type === "parenthetical" || activeLine.type === "note") && (normalized === "" || normalized === "()" || normalized === "[]")) {
        // Don't force set if it breaks typing feel for empty wrappers
    } else {
        element.textContent = normalized;
        setCaretOffset(element, newOffset);
    }
  }

  line.text = normalized;
  project.updatedAt = new Date().toISOString();
  clearSuggestionContext();

  const shouldRefreshSpelling = state.grammarCheck
    && hasLanguageDictionary(state.writingLanguage)
    && Boolean(window.getSelection()?.isCollapsed);
  const caretOffset = shouldRefreshSpelling ? getCaretOffset(element) : 0;
  if (shouldRefreshSpelling) {
    refreshEditableBlockDisplay(element, line, project);
    setCaretOffset(element, Math.min(caretOffset, element.textContent.length));
  }

  setActiveBlock(id);
  schedulePreviewRefresh();
  scheduleStudioSidebarRefresh({ includeHome: false, includeAnalytics: true });
  if (line.type === "scene") {
    hideSuggestionTray(true);
  } else {
    updateSuggestions();
  }
  setTypingFocusModeActive();
  queueSave();
}

let lastKeyDownCode = "";
let _enterPrevBlockId = null;  // tracks block left behind when Enter creates a new one

function insertSoftLineBreak(id, element) {
  if (!element) {
    return;
  }

  element.focus();
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const br = document.createElement("br");
  const trailingTextNode = document.createTextNode("");

  range.insertNode(trailingTextNode);
  range.insertNode(br);

  const nextRange = document.createRange();
  nextRange.setStart(trailingTextNode, 0);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);

  handleBlockInput(id, element);
}

export function intelligentSplit(element) {
  const id = element.dataset.id;
  const project = getCurrentProject();
  const index = getLineIndex(id);
  const line = project?.lines[index];
  if (!line) return;

  const offset = getCaretOffset(element);
  const textBefore = line.text.substring(0, offset);
  const textAfter = line.text.substring(offset);

  line.text = textBefore;
  // Get the next type in sequence
  const currentTypeIdx = TYPE_SEQUENCE.indexOf(line.type);
  const nextType = TYPE_SEQUENCE[(currentTypeIdx + 1) % TYPE_SEQUENCE.length];
  const newId = addBlock(nextType, textAfter, index + 1);

  renderStudio();
  focusBlock(newId, !textAfter);
  queueSave();
}

function handleBlockKeydown(event, id) {
  const project = getCurrentProject();
  const index = getLineIndex(id);
  const line = project?.lines[index];
  if (!line) return;

  const code = event.code;
  const isSecondary = event.target.dataset.secondary === "true";

  // --- Dual secondary field: Enter / Tab advance to next dual row ---
  if (isSecondary && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
    event.preventDefault();
    line.secondary = normalizeLineText(event.target.textContent || "", line.type);
    project.updatedAt = new Date().toISOString();
    if (line.type === "character") {
      const newId = addBlock("dialogue", "", index + 1);
      const newLine = getLine(newId);
      if (newLine) newLine.secondary = "";
      renderStudio();
      focusBlock(newId);
    } else {
      const newId = addBlock("action", "", index + 1);
      renderStudio();
      focusBlock(newId);
    }
    queueSave();
    return;
  }

  // Handle Break function (Backtick + Enter)
  if (event.key === "Enter" && lastKeyDownCode === "Backquote") {
    event.preventDefault();
    intelligentSplit(event.target);
    return;
  }

  lastKeyDownCode = code;

  if (event.key === "Delete") {
    const isEmpty = !activeEl.textContent.trim();
    if (!isEmpty) {
      // Let the browser delete one character forward — do not touch the line
      return;
    }
    event.preventDefault();
    project.updatedAt = new Date().toISOString();
    if (project.lines.length === 1) {
      line.text = "";
      renderStudio();
      focusBlock(line.id, true);
    } else {
      const fallbackIndex = Math.min(index, project.lines.length - 2);
      const targetId = project.lines[fallbackIndex >= index ? fallbackIndex + 1 : fallbackIndex]?.id || project.lines[Math.max(0, index - 1)].id;
      project.lines.splice(index, 1);
      state.activeBlockId = targetId;
      renderStudio();
      focusBlock(targetId);
    }
    queueSave();
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    // Primary field of a dual row: move focus to secondary
    if (line.secondary !== undefined && !isSecondary) {
      focusSecondaryBlock(id);
      return;
    }
    const offset = getCaretOffset(event.target);
    const textBefore = line.text.substring(0, offset);
    const textAfter = line.text.substring(offset);

    line.text = textBefore;
    const nextType = inferNextType(index);
    _enterPrevBlockId = id;  // protect this block from focusout deletion during render
    const newId = addBlock(nextType, textAfter || getDefaultText(nextType, index), index + 1);

    renderStudio();
    _enterPrevBlockId = null;
    focusBlock(newId, !textAfter);
    queueSave();
    return;
  }

  if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    insertSoftLineBreak(id, event.target);
    return;
  }

  if (event.key === "Backspace") {
    const offset = getCaretOffset(event.target);
    if (offset === 0 && index > 0) {
      event.preventDefault();
      const prevLine = project.lines[index - 1];
      const prevTextLength = prevLine.text.length;
      prevLine.text += line.text;
      project.lines.splice(index, 1);
      state.activeBlockId = prevLine.id;
      project.updatedAt = new Date().toISOString();
      renderStudio();
      const prevElement = refs.screenplayEditor.querySelector(`.script-block[data-id="${prevLine.id}"]:not([data-secondary])`);
      focusBlock(prevLine.id);
      setCaretOffset(prevElement, prevTextLength);
      queueSave();
      return;
    }

    if (!line.text.trim() && project.lines.length > 1) {
      event.preventDefault();
      const targetId = project.lines[Math.max(index - 1, 0)].id;
      project.lines.splice(index, 1);
      state.activeBlockId = targetId;
      project.updatedAt = new Date().toISOString();
      renderStudio();
      focusBlock(targetId);
      placeCaretAtEnd(refs.screenplayEditor.querySelector(`.script-block[data-id="${targetId}"]:not([data-secondary])`));
      queueSave();
      return;
    }
  }

  if (event.key === "Tab") {
    event.preventDefault();
    // Primary field of a dual row: move focus to secondary
    if (line.secondary !== undefined && !isSecondary) {
      focusSecondaryBlock(id);
      return;
    }
    cycleBlockType(id);
    return;
  }

  // Smart Navigation
  if (event.key === "ArrowUp") {
    const offset = getCaretOffset(event.target);
    if (offset === 0 || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        // Jump to previous scene
        for (let i = index - 1; i >= 0; i--) {
          if (project.lines[i].type === "scene") {
            focusBlock(project.lines[i].id);
            return;
          }
        }
        focusBlock(project.lines[0].id);
      } else {
        const prev = project.lines[index - 1];
        if (prev) focusBlock(prev.id);
      }
    }
  }

  if (event.key === "ArrowDown") {
    const offset = getCaretOffset(event.target);
    const length = line.text.length;
    if (offset === length || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        // Jump to next scene
        for (let i = index + 1; i < project.lines.length; i++) {
          if (project.lines[i].type === "scene") {
            focusBlock(project.lines[i].id);
            return;
          }
        }
        focusBlock(project.lines[project.lines.length - 1].id);
      } else {
        const next = project.lines[index + 1];
        if (next) focusBlock(next.id);
      }
    }
  }
}

function inferNextType(index) {
  const current = getCurrentProject()?.lines[index]?.type || "action";
  if (current === "scene") return "action";
  if (current === "action") return "action";
  if (current === "character") return "dialogue";
  if (current === "parenthetical") return "dialogue";
  if (current === "dialogue") return "character";
  if (current === "transition") return "scene";
  if (current === "dual") return "dialogue";
  if (current === "text") return "text";
  if (current === "note") return "note";
  return "action";
}

export function addBlock(type, text = "", index) {
  if (!canEditCurrentProjectWithNotice()) {
    return state.activeBlockId;
  }
  const project = getCurrentProject();
  const insertAt = Number.isInteger(index) ? index : project.lines.length;
  const line = { id: uid(), type, text: normalizeLineText(text, type) };
  project.lines.splice(insertAt, 0, line);
  project.updatedAt = new Date().toISOString();
  state.activeBlockId = line.id;
  state.activeType = type;
  return line.id;
}

function cycleBlockType(id) {
  const line = getLine(id);
  if (!line) return;
  const index = TYPE_SEQUENCE.indexOf(line.type);
  changeBlockType(id, TYPE_SEQUENCE[(index + 1) % TYPE_SEQUENCE.length]);
}

function changeBlockType(id, nextType) {
  if (!canEditCurrentProjectWithNotice()) return;
  const line = getLine(id);
  const project = getCurrentProject();
  if (!line || !project) return;

  line.type = nextType;
  line.text = normalizeConvertedText(line.text, nextType);
  project.updatedAt = new Date().toISOString();
  state.activeType = nextType;
  renderStudio();
  focusBlock(id, !line.text);
  queueSave();
}

function normalizeConvertedText(text, type) {
  const stripped = stripWrapperChars(String(text || "").trim());
  if (!stripped && type === "character") {
      return getSuggestedNextSpeaker(getLineIndex(state.activeBlockId));
  }
  return normalizeLineText(stripped, type);
}

function toggleSceneCollapse(sceneId) {
  const project = getCurrentProject();
  if (!project) return;
  const collapsed = new Set(project.collapsedSceneIds);
  if (collapsed.has(sceneId)) {
    collapsed.delete(sceneId);
  } else {
    collapsed.add(sceneId);
    if (state.activeBlockId !== sceneId && getOwningSceneId(state.activeBlockId) === sceneId) {
      state.activeBlockId = sceneId;
      state.activeType = "scene";
    }
  }
  project.collapsedSceneIds = [...collapsed];
  project.updatedAt = new Date().toISOString();
  renderStudio();
  focusBlock(sceneId);
  queueSave();
}

function applySuggestion(value) {
  const line = getLine(state.activeBlockId);
  const project = getCurrentProject();
  if (!line || !project) return;

  if (state.suggestionContext?.mode === "spelling" && state.suggestionContext.lineId === line.id) {
    const { start, end, word } = state.suggestionContext;
    const replacement = applyWordCase(value, word);
    line.text = normalizeLineText(`${line.text.slice(0, start)}${replacement}${line.text.slice(end)}`, line.type);
    clearSuggestionContext();
    project.updatedAt = new Date().toISOString();
    renderStudio();
    focusBlock(line.id);
    const activeBlock = refs.screenplayEditor.querySelector(`.script-block[data-id="${line.id}"]`);
    if (activeBlock) {
      setCaretOffset(activeBlock, Math.min(start + replacement.length, activeBlock.textContent.length));
    }
    queueSave();
    return;
  }

  clearSuggestionContext();
  line.text = normalizeLineText(value, line.type);
  project.updatedAt = new Date().toISOString();
  renderStudio();
  focusBlock(line.id);
  queueSave();
}

function handleToolSelection(type) {
  if (type === "dual") {
    const active = getLine(state.activeBlockId);
    if (active?.type === "character" && active.secondary === undefined) {
      active.secondary = "";
      const project = getCurrentProject();
      if (project) project.updatedAt = new Date().toISOString();
      renderStudio();
      focusSecondaryBlock(active.id);
      queueSave();
      return;
    }
  }

  const active = getLine(state.activeBlockId);
  if (!active) {
    const newId = addBlock(type, "");
    renderStudio();
    focusBlock(newId, true);
    queueSave();
    return;
  }
  changeBlockType(active.id, type);
}

function togglePane(side) {
  const isLeft = side === "left";
  const pane = isLeft ? refs.leftPane : refs.rightPane;
  const handle = isLeft ? refs.leftResize : refs.rightResize;
  const button = isLeft ? refs.leftRailToggle : refs.rightRailToggle;
  const collapsed = pane.classList.toggle("is-hidden");
  if (handle) handle.classList.toggle("is-hidden", collapsed);
  refs.studioLayout.classList.toggle(isLeft ? "left-pane-hidden" : "right-pane-hidden", collapsed);
  button.innerHTML = collapsed ? (isLeft ? "&#9654;" : "&#9664;") : (isLeft ? "&#9664;" : "&#9654;");
}

function initResizeHandle(handle, side) {
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = side === "left"
      ? parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-pane-width"), 10)
      : parseInt(getComputedStyle(document.documentElement).getPropertyValue("--right-pane-width"), 10);

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = side === "left"
        ? clamp(startWidth + delta, 220, 460)
        : clamp(startWidth - delta, 260, 520);
      document.documentElement.style.setProperty(side === "left" ? "--left-pane-width" : "--right-pane-width", `${nextWidth}px`);
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      persistProjects(false);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}

function handleMenuAction(action) {
  switch (action) {
    case "new-project":
      launchNewCreationFlow();
      break;
    case "open-projects":
      persistProjects(true);
      showHome();
      renderHome();
      break;
    case "save-project":
      persistProjects(true);
      break;
    case "save-home":
      saveAndGoHome();
      break;
    case "rename-project":
      renameCurrentProject();
      break;
    case "duplicate-project":
      duplicateProject();
      break;
    case "delete-project":
      deleteProject();
      break;
    case "import-file":
      refs.fileInput.click();
      break;
    case "export-txt":
      exportTxt();
      break;
    case "export-json":
      exportJson();
      break;
    case "export-word":
      exportWord();
      break;
    case "export-pdf":
      exportPdf();
      break;
    case "preview-new-tab":
      openPreviewWindow(false);
      break;
    case "print-project":
      printWithHiddenFrame();
      break;
    case "exit-studio":
      persistProjects(true);
      showHome();
      renderHome();
      break;
    case "undo":
      undo();
      renderStudio();
      break;
    case "redo":
      redo();
      renderStudio();
      break;
    case "insert-page-break":
      insertMenuBlock("text", "--- PAGE BREAK ---");
      break;
    case "insert-hyperlink":
      insertHyperlink();
      break;
    case "insert-image":
      handleToolSelection("image");
      break;
    case "select-all": {
        const target = getActiveEditableBlock();
        if (target) { target.focus(); selectElementText(target); }
        break;
    }
    case "text-copy":
      ContextMenu.performAction("copy", getActiveEditableBlock());
      break;
    case "text-cut":
      ContextMenu.performAction("cut", getActiveEditableBlock());
      queueSave();
      break;
    case "text-paste":
      ContextMenu.performAction("paste", getActiveEditableBlock());
      queueSave();
      break;
    case "text-duplicate":
      ContextMenu.performAction("duplicate", getActiveEditableBlock());
      break;
    case "text-caps-all":
      ContextMenu.performAction("caps-all", getActiveEditableBlock());
      queueSave();
      break;
    case "text-caps-sentence":
      ContextMenu.performAction("caps-sentence", getActiveEditableBlock());
      queueSave();
      break;
    case "text-caps-each":
      ContextMenu.performAction("caps-each", getActiveEditableBlock());
      queueSave();
      break;
    case "text-caps-low":
      ContextMenu.performAction("caps-low", getActiveEditableBlock());
      queueSave();
      break;
    case "text-caps-random":
      ContextMenu.performAction("caps-random", getActiveEditableBlock());
      queueSave();
      break;
    case "find":
      findInScript();
      break;
    case "filter":
      setScriptFilter();
      break;
    case "clear-filter":
      clearScriptFilter();
      break;
    case "fullscreen":
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        document.documentElement.requestFullscreen?.();
      }
      break;
    case "proofread":
      showProofreadReport();
      break;
    case "toggle-ai-assistant":
      state.aiAssist = true;
      refs.aiAssistToggle.checked = state.aiAssist;
      refs.aiPanel.hidden = !state.aiAssist;
      applyToolbarState();
      updateMenuStateButtons();
      showModal({
        title: "AI Assistant",
        message: "AI Assistant is ready. Use the assistant on the active block for rewrites, next beats, or dialogue help.",
        confirmLabel: "Launch Assistant",
        cancelLabel: "Close"
      }).then((confirmed) => {
        if (confirmed) {
          AI.triggerAssistant();
        }
      });
      queueSave();
      break;
    case "toggle-grammar-check":
      showModal({
        title: "Grammar Check",
        message: state.grammarCheck
          ? "Grammar check is active for the editor. You can turn it off or keep reviewing the current script."
          : "Turn on grammar check to review spelling and language issues across the current script.",
        confirmLabel: state.grammarCheck ? "Turn Off" : "Turn On",
        cancelLabel: "Close"
      }).then((confirmed) => {
        if (confirmed) {
          setGrammarCheck(!state.grammarCheck);
        }
      });
      break;
    case "toggle-auto-number":
      refs.autoNumberToggle.checked = !refs.autoNumberToggle.checked;
      state.autoNumberScenes = refs.autoNumberToggle.checked;
      renderStudio();
      queueSave();
      break;
    case "show-work-tracking":
      showWorkTracking();
      break;
    case "show-metrics": {
      const container = document.createElement("div");
      container.className = "metric-grid";
      const project = getCurrentProject();
      const words = serializeScript(project).match(/\b[\w'-]+\b/g) || [];
      const characters = new Set(project.lines.filter((line) => line.type === "character" && line.text.trim()).map((line) => line.text.trim().toUpperCase()));
      const scenes = project.lines.filter((line) => line.type === "scene" && line.text.trim()).length;

      container.innerHTML = `
        <div><span>Words</span><strong>${words.length.toLocaleString()}</strong></div>
        <div><span>Pages est.</span><strong>${Math.max(1, Math.round((words.length / 180) * 10) / 10).toFixed(1)}</strong></div>
        <div><span>Characters</span><strong>${characters.size}</strong></div>
        <div><span>Scenes</span><strong>${scenes}</strong></div>
      `;
      showModal({ title: "Metrics", message: container, showConfirm: false, cancelLabel: "Close" });
      break;
    }
    case "open-notepad":
      openNotepad();
      break;
    case "open-story-memory":
      showStoryMemoryPopup();
      break;
    case "add-story-element":
      showStoryMemoryBuilder();
      break;
    case "open-scenes": {
      const container = document.createElement("div");
      container.className = "modal-list";
      container.appendChild(refs.sceneList.cloneNode(true));
      showModal({ title: "Scenes", message: container, showConfirm: false, cancelLabel: "Close" });
      break;
    }
    case "open-characters":
      showCharactersInterface(false, (id) => focusBlock(id));
      break;
    case "add-character":
      showCharactersInterface(true, (id) => focusBlock(id));
      break;
    case "pick-story-memory":
      showStoryMemoryPicker();
      break;
    case "open-workspace":
      showWorkspacePopup();
      break;
    case "open-analytics": {
      const container = document.createElement("div");
      container.id = "analyticsDashboardContent";
      showModal({ title: "Writing Analytics", message: container, showConfirm: false, cancelLabel: "Close" });
      renderAnalytics();
      break;
    }
    case "smart-proofread":
      AI.triggerSmartProofread();
      break;
    case "customize-active-blocks":
      showCustomizeActiveBlocksModal();
      break;
  }
  closeMenus();
  if (action === "toggle-grammar-check") {
    queueSave();
  }
}

function execEditorCommand(command) {
  const target = getActiveEditableBlock();
  if (!target) {
    return;
  }
  target.focus();
  if (typeof document.execCommand === "function") {
    document.execCommand(command);
  }
}

function saveAndGoHome() {
  if (isDisposableUntitledDraft()) {
    discardUntitledDraftIfNeeded().then(() => {
      state.currentWorkspaceId = null;
      showHome();
      renderHome();
    });
    return;
  }
  persistProjects(true);
  state.currentWorkspaceId = null;
  showHome();
  renderHome();
}

function setGrammarCheck(enabled) {
  state.grammarCheck = enabled;
  refs.grammarCheckToggle.checked = enabled;
  document.body.classList.toggle("spelling-mode-active", enabled);
  document.body.classList.toggle("grammar-mode-active", enabled);
  clearSuggestionContext();
  clearSpellingHighlights(refs.screenplayEditor);
  renderStudio();
  primeSpellingDictionary();
}

function setWritingLanguage(language) {
  state.writingLanguage = ["en", "fr", "de"].includes(language) ? language : "en";
  applyWritingLanguageButtons();
  if (state.grammarCheck && !refs.studioView.hidden) {
    renderStudio();
  }
}

function applyWritingLanguageButtons() {
  refs.writingLanguageButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.writingLanguageValue === state.writingLanguage);
  });
}

async function toggleLocalBackup(enable) {
  if (enable) {
    if (!isLocalSaveSupported()) {
      customAlert("Local backup requires a Chromium-based browser (Chrome, Edge, Opera).");
      if (refs.localBackupToggle) refs.localBackupToggle.checked = false;
      return;
    }
    state.localBackupEnabled = true;
    applyLocalBackupUI();
    persistProjects(false);
    if (!state.localSaveFileHandle) {
      const result = await chooseLocalSaveFile();
      if (!result.ok) {
        state.localBackupEnabled = false;
        applyLocalBackupUI();
        persistProjects(false);
        return;
      }
    }
    startLocalSaveTimer();
  } else {
    state.localBackupEnabled = false;
    applyLocalBackupUI();
    persistProjects(false);
    stopLocalSaveTimer();
  }
}

export function applySaveModeButtons() {
  applyLocalBackupUI();
}

function applyLocalBackupUI() {
  if (refs.localBackupToggle) {
    refs.localBackupToggle.checked = state.localBackupEnabled;
  }
  if (refs.localSaveControls) {
    refs.localSaveControls.hidden = !state.localBackupEnabled;
  }
  if (refs.localSaveInterval) {
    refs.localSaveInterval.value = String(state.localSaveIntervalMinutes);
  }
  if (refs.localSaveFileLabel) {
    refs.localSaveFileLabel.textContent = state.localSaveFileHandle
      ? `Backup file: ${state.localSaveFileHandle.name}`
      : "No file selected";
  }
}

function primeSpellingDictionary() {
  if (!state.grammarCheck) {
    return;
  }

  ensureLanguageDictionary(state.writingLanguage)
    .then(() => {
      if (state.grammarCheck && !refs.studioView.hidden) {
        renderStudio();
      }
    })
    .catch((error) => {
      console.error("Unable to load spelling dictionary:", error);
    });
}

async function maybeShowSpellingSuggestions(block, target = null, clientX = null, clientY = null) {
  if (!state.grammarCheck) {
    return;
  }

  const line = getLine(block.dataset.id);
  const project = getCurrentProject();
  if (!line || !project) {
    return;
  }

  if (!hasLanguageDictionary(state.writingLanguage)) {
    try {
      await ensureLanguageDictionary(state.writingLanguage);
    } catch (error) {
      console.error("Unable to load spelling suggestions:", error);
      return;
    }
  }

  const clickedContext = resolveClickedSpellingContext(block, line, project, target, clientX, clientY);
  if (clickedContext) {
    showSpellingSuggestions(clickedContext, { x: clientX, y: clientY });
    highlightSpellingIssue(block, clickedContext);
    return;
  }

  const offset = getCaretOffset(block);
  const context = getSpellingContextAtOffset(line.text, offset, {
    language: state.writingLanguage,
    project,
    lineId: line.id
  });

  if (!context) {
    clearSpellingHighlights(refs.screenplayEditor);
    updateSuggestions();
    return;
  }

  showSpellingSuggestions(context, { rect: block.getBoundingClientRect() });
  highlightSpellingIssue(block, context);
}

function resolveClickedSpellingContext(block, line, project, target, clientX, clientY) {
  const directIssue = target?.closest?.(".spelling-error");
  const pointIssue = getSpellingIssueFromPoint(block, clientX, clientY);
  const issue = directIssue || pointIssue;

  if (issue) {
    const start = Number(issue.dataset.spellingStart);
    const end = Number(issue.dataset.spellingEnd);
    const word = issue.dataset.spellingWord || line.text.slice(start, end);

    if (issue.dataset.grammarSuggestions) {
      const suggestions = JSON.parse(issue.dataset.grammarSuggestions);
      if (suggestions.length) {
        return { mode: "spelling", lineId: line.id, start, end, word, suggestions };
      }
    }

    const suggestions = getSpellingSuggestions(word, {
      language: state.writingLanguage,
      project
    });

    if (suggestions.length) {
      return {
        mode: "spelling",
        lineId: line.id,
        start,
        end,
        word,
        suggestions
      };
    }
  }

  const offsetFromPoint = getCaretOffsetFromPoint(block, clientX, clientY);
  if (offsetFromPoint >= 0) {
    return getSpellingContextAtOffset(line.text, offsetFromPoint, {
      language: state.writingLanguage,
      project,
      lineId: line.id
    });
  }

  return null;
}

function getSpellingIssueFromPoint(block, clientX, clientY) {
  return getPointContext(block, clientX, clientY)?.element?.closest?.(".spelling-error") || null;
}

function getCaretOffsetFromPoint(block, clientX, clientY) {
  return getPointContext(block, clientX, clientY)?.offset ?? -1;
}

function getPointContext(block, clientX, clientY) {
  if (!block || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  let container = null;
  let offset = 0;

  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(clientX, clientY);
    container = position?.offsetNode || null;
    offset = position?.offset || 0;
  } else if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(clientX, clientY);
    container = range?.startContainer || null;
    offset = range?.startOffset || 0;
  }

  if (!container) {
    return null;
  }

  const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
  if (!element || !block.contains(element)) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(container, offset);

  return {
    element,
    offset: range.toString().length
  };
}

function setButtonGlyph(button, entity) {
  if (button) {
    button.innerHTML = entity;
  }
}

async function renameCurrentProject() {
  const project = getCurrentProject();
  if (!project) return;
  const currentUid = auth.currentUser?.uid;
  if (project.isShared && project.ownerId && project.ownerId !== currentUid) {
    await customAlert("Only the project owner can rename a shared file.", "Permission Denied");
    return;
  }
  const nextTitle = await customPrompt("Rename this project:", project.title, "Rename Project");
  if (nextTitle === null) return;
  project.title = nextTitle.trim() || "Untitled Script";
  project.updatedAt = new Date().toISOString();
  syncInputsFromProject(project);
  renderStudio();
  queueSave();
}

async function duplicateProject() {
  const current = getCurrentProject();
  if (!current) return;
  const confirm = await customPrompt(`Type "yes" to duplicate "${current.title}":`, "", "Duplicate Project");
  if (!confirm || confirm.trim().toLowerCase() !== "yes") {
    if (confirm !== null) await customAlert("Duplication cancelled. You must type \"yes\" to confirm.", "Cancelled");
    return;
  }
  const copy = cloneProject({ ...current, title: `${current.title} Copy` }, true);
  upsertProject(copy);
  openProject(copy.id);
  persistProjects(true);
}

async function renameProjectById(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const currentUid = auth.currentUser?.uid;
  if (project.isShared && project.ownerId && project.ownerId !== currentUid) {
    await customAlert("Only the project owner can rename a shared file.", "Permission Denied");
    return;
  }
  const nextTitle = await customPrompt("Rename this project:", project.title, "Rename Project");
  if (!nextTitle || !nextTitle.trim()) return;
  project.title = nextTitle.trim();
  project.updatedAt = new Date().toISOString();
  upsertProject(project);
  persistProjects(true, { syncInputs: false });
  renderHome();
  if (state.currentProjectId === project.id) {
    renderStudio();
  }
}

async function duplicateProjectById(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  const confirm = await customPrompt(`Type "yes" to duplicate "${project.title}":`, "", "Duplicate Project");
  if (!confirm || confirm.trim().toLowerCase() !== "yes") {
    if (confirm !== null) await customAlert("Duplication cancelled. You must type \"yes\" to confirm.", "Cancelled");
    return;
  }
  const copy = cloneProject({ ...project, title: `${project.title} Copy` }, true);
  upsertProject(copy);
  persistProjects(true, { syncInputs: false });
  renderHome();
}

function deleteProject() {
  const current = getCurrentProject();
  if (current) removeProject(current.id);
}

async function removeProject(id) {
  const target = state.projects.find((item) => item.id === id);
  if (!target) return;

  const entityLabel = target.isWorkspaceRoot ? "workspace" : "project";
  const confirmation = await customPrompt(`This will permanently delete the ${entityLabel} "${target.title}".\n\nTo confirm, please retype the ${entityLabel} name below:`, "", "Confirm Deletion");

  if (confirmation !== target.title) {
    if (confirmation !== null) {
      await customAlert("Deletion cancelled. The name you typed did not match.", "Cancelled");
    }
    return;
  }

  const workspaceId = target.workspace?.id || target.id;
  state.projects = state.projects.filter((item) => {
    if (target.isWorkspaceRoot) {
      return item.workspace?.id !== workspaceId;
    }
    return item.id !== id;
  });
  if (!state.projects.length) {
    const fallback = createProjectWithOptions();
    state.projects = [fallback];
  }
  if (target.isWorkspaceRoot || state.currentWorkspaceId === workspaceId) {
    state.currentWorkspaceId = null;
  }
  state.currentProjectId = state.projects[0].id;
  persistProjects(true, { syncInputs: false });
  deleteProjectFromCloud(id);
  showHome();
  renderHome();
}

function handleGlobalKeydown(event) {
  const key = event.key.toLowerCase();
  const code = event.code;

  // Ctrl/Cmd + S to Save
  if ((event.ctrlKey || event.metaKey) && key === "s") {
    event.preventDefault();
    persistProjects(true);
    return;
  }

  // Undo / Redo
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) {
        redo();
    } else {
        undo();
    }
    renderStudio();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && key === "y") {
    event.preventDefault();
    redo();
    renderStudio();
    return;
  }

  // Duplicate Block
  if ((event.ctrlKey || event.metaKey) && key === "d") {
    event.preventDefault();
    duplicateActiveBlock();
    return;
  }

  // Number keys for suggestions
  if (state.visibleSuggestions.length && /^[1-9]$/.test(event.key)) {
    const choice = state.visibleSuggestions[Number(event.key) - 1];
    if (choice) {
      event.preventDefault();
      applySuggestion(choice.value);
      return;
    }
  }

  // Alt + Key for block types
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const charCode = code?.startsWith('Key') ? code.substring(3).toLowerCase() : key;
    const map = {
      s: "shot",
      a: "action",
      c: "character",
      d: "dialogue",
      t: "transition",
      p: "parenthetical",
      o: "shot",
      x: "text",
      n: "note",
      u: "dual",
      i: "image",
      e: "scene"
    };

    const blockType = map[charCode] || map[key];

    if (blockType) {
      event.preventDefault();
      handleToolSelection(blockType);
    }

    // Alt + G for AI Grammar
    if ((charCode === 'g' || key === 'g') && state.aiAssist) {
      event.preventDefault();
      const activeEl = getActiveEditableBlock();
      if (activeEl) {
        const row = activeEl.closest('.script-block-row');
        if (row) AI.triggerAction(row, "Grammar");
      }
    }
  }

  // Escape to close menus
  if (event.key === "Escape") {
    closeMenus();
  }
}

function insertAiAssistNote() {
  if (!canEditCurrentProjectWithNotice()) return;
  const project = getCurrentProject();
  if (!project) return;
  const index = getLineIndex(state.activeBlockId);
  const prompt = "AI ASSIST: Suggest the next beat, sharpen the scene objective, and keep the current voice.";
  const newId = addBlock("note", prompt, index + 1);
  renderStudio();
  focusBlock(newId, true);
  queueSave();
}

function insertMenuBlock(type, text) {
  if (!canEditCurrentProjectWithNotice()) return;
  const index = Math.max(getLineIndex(state.activeBlockId), -1);
  const newId = addBlock(type, text, index + 1);
  renderStudio();
  focusBlock(newId, true);
  queueSave();
}

async function insertHyperlink() {
  const url = await customPrompt("Enter the hyperlink URL:", "https://", "Insert Hyperlink");
  if (url === null || !url.trim()) return;
  const label = await customPrompt("Optional display text:", "", "Link Label");
  const cleanedUrl = url.trim();
  const cleanedLabel = label === null ? "" : label.trim();
  const text = cleanedLabel ? `${cleanedLabel} <${cleanedUrl}>` : cleanedUrl;
  insertMenuBlock("text", text);
}

export async function findInScript() {
  const project = getCurrentProject();
  if (!project) return;
  const query = await customPrompt("Find text in this script:", state.filterQuery, "Find");
  if (query === null) return;
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) {
    clearScriptFilter();
    return;
  }
  const match = project.lines.find((line) => `${TYPE_LABELS[line.type]} ${getTypeLabel(line.type)} ${line.text}`.toLowerCase().includes(cleaned));
  if (!match) {
    await customAlert(t("editor.noMatches", { query }), "No Matches");
    return;
  }
  state.filterQuery = "";
  renderStudio();
  focusBlock(match.id, true);
}

async function setScriptFilter() {
  const project = getCurrentProject();
  if (!project) return;
  const nextFilter = await customPrompt("Filter visible lines by text or line function:", state.filterQuery, "Filter Script");
  if (nextFilter === null) return;
  state.filterQuery = nextFilter.trim();
  renderStudio();
}

function clearScriptFilter() {
  if (!state.filterQuery) return;
  state.filterQuery = "";
  renderStudio();
}

function exportTxt() {
    const project = syncProjectFromInputs() || getCurrentProject();
    if (!project) return;

  const preparedLines = buildPreparedExportLines(project);

  const coverParts = [
    project.title || "Untitled Script",
    project.author ? `by ${project.author}` : "",
    [project.contact, project.company, project.details].filter(Boolean).join("\n"),
    project.logline || ""
  ].filter(Boolean);
  const cover = coverParts.join("\n\n");

  const pageBreak = "\n\n" + "-".repeat(60) + "\n\n";
    const scriptBody = preparedLines.map((line) => line.displayText).join("\n\n");

    const content = [cover, scriptBody].filter(Boolean).join(pageBreak) + "\n";
    downloadFile(`${slugify(project.title)}.txt`, content, "text/plain;charset=utf-8");
    showToast("Export complete.", "success");
}

function exportJson() {
    const project = syncProjectFromInputs() || getCurrentProject();
    downloadFile(`${slugify(project.title)}.json`, JSON.stringify(project, null, 2), "application/json");
    showToast("Export complete.", "success");
}

async function exportWord() {
      const project = syncProjectFromInputs() || getCurrentProject();
      if (!project) return;
      const exportToast = showToast("Preparing Word export...", "loading", { duration: 0 });

      try {
        const blob = await buildWordDocxBlob(project);
        downloadFile(`${slugify(project.title)}.docx`, blob, DOCX_MIME_TYPE);
        updateToast(exportToast, "Export complete.", "success");
      } catch (error) {
        console.error("DOCX export failed", error);
        updateToast(exportToast, "Word export failed.", "error", { duration: 4200 });
        customAlert("Word export could not be created. Please try again after the DOCX engine finishes loading.", "Word Export");
      }
}

function exportPdf() {
  printWithHiddenFrame();
}

function openPreviewWindow(autoPrint) {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const previewWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!previewWindow) {
    customAlert("Allow pop-ups for this site so EyaWriter can open the print window for PDF export.", "PDF Export");
    return;
  }
  previewWindow.document.open();
  previewWindow.document.write(buildPrintableDocument(project, autoPrint));
  previewWindow.document.close();
  previewWindow.focus();
}

function printWithHiddenFrame() {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const exportToast = showToast("Preparing PDF export...", "loading", { duration: 0 });

  const existingFrame = document.querySelector("#printExportFrame");
  if (existingFrame) {
    existingFrame.remove();
  }

  const frame = document.createElement("iframe");
  frame.id = "printExportFrame";
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);

  const cleanup = () => window.setTimeout(() => frame.remove(), 1500);
  frame.onload = () => {
    const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        cleanup();
        updateToast(exportToast, "PDF export failed.", "error", { duration: 4200 });
        customAlert("PDF export could not open the print dialog. Try again or use Print from the output menu.", "PDF Export");
        return;
      }

    frameWindow.focus();
      window.setTimeout(() => {
        try {
          frameWindow.print();
          updateToast(exportToast, "Print dialog opened.", "success", { duration: 2400 });
        } catch (error) {
          console.error("Unable to start PDF print flow", error);
          updateToast(exportToast, "PDF export failed.", "error", { duration: 4200 });
          customAlert("PDF export could not open the print dialog. Try again or use Print from the output menu.", "PDF Export");
        } finally {
          cleanup();
      }
    }, 350);
  };

  frame.srcdoc = buildPrintableDocument(project, false);
}

function buildPreparedExportLines(project) {
  let sceneNumber = 0;

  return project.lines.reduce((accumulator, line) => {
    const normalized = formatLineText(line.text, line.type);
    if (!normalized) {
      return accumulator;
    }

    if (line.type === "scene") {
      sceneNumber += 1;
    }

    accumulator.push({
      id: line.id,
      type: line.type,
      displayText: state.autoNumberScenes && line.type === "scene" ? `${sceneNumber}. ${normalized}` : normalized
    });

    return accumulator;
  }, []);
}

function importFile(event) {
  const [file] = event.target.files || [];
  const project = getCurrentProject();
  if (!file || !project) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    let nextProject;

    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        nextProject = sanitizeProject(JSON.parse(text));
      } catch (error) {
        console.error("Invalid JSON import", error);
        return;
      }
    } else {
      nextProject = sanitizeProject({
        ...project,
        title: file.name.replace(/\.[^.]+$/, ""),
        lines: parseTextToLines(text)
      });
    }

    nextProject.id = uid();
    nextProject.createdAt = new Date().toISOString();
    upsertProject(nextProject);
    openProject(nextProject.id);
    persistProjects(true);
  };

  reader.readAsText(file);
  refs.fileInput.value = "";
}

function openNotepad() {
  const dialog = document.getElementById("notepadDialog");
  const closeBtn = document.getElementById("closeNotepad");

  if (!dialog) return;

  // Initialize Summernote if not already done
  if (!$( '#summernote' ).data('summernote')) {
    $( '#summernote' ).summernote({
      placeholder: 'Type your notes here...',
      tabsize: 2,
      height: 400,
      toolbar: [
        ['style', ['style']],
        ['font', ['bold', 'italic', 'underline', 'clear']],
        ['fontname', ['fontname']],
        ['color', ['color']],
        ['para', ['ul', 'ol', 'paragraph']],
        ['table', ['table']],
        ['insert', ['link']],
        ['view', ['fullscreen', 'codeview', 'help']]
      ]
    });
  }

  dialog.showModal();

  closeBtn.onclick = () => {
    dialog.close();
  };
}

async function checkFirstWorkBackup() {
  if (state.localBackupEnabled || state.backupPrompted) return;

  state.backupPrompted = true;
  persistProjects(false);

  const confirmed = await customConfirm(
    "Would you like to enable Local Backup? This automatically saves a copy of your work to a folder on your computer for extra safety.",
    "Enable Local Backup?"
  );

  if (confirmed) {
    const result = await chooseLocalSaveFile();
    if (result.ok) {
      state.localBackupEnabled = true;
      applySaveModeButtons();
      persistProjects(false);
    }
  }
}
