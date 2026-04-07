import { stripWrapperChars } from "./pagination.js";
import { state } from './state.js';
import { refs } from './refs.js';
import {
  STORAGE_KEY, TYPE_SEQUENCE, TYPE_LABELS, AUTO_UPPERCASE_TYPES,
  SCENE_TIMES, DEFAULT_SUGGESTIONS, DEFAULT_VIEW_OPTIONS, PAGE_UNIT_CAPACITY
} from './constants.js';
import {
  uid, clamp, escapeHtml, slugify, formatDateTime,
  sanitizeViewOptions, downloadFile, createTextNode,
  placeCaretAtEnd, selectElementText, selectTextSuffix
} from './utils.js';
import {
  loadProjects, persistProjects
} from './storage.js';
import {
  sanitizeProject, cloneProject, createProject,
  getCurrentProject, getLine, getLineIndex, upsertProject
} from './project.js';
import {
  paginateScriptLines, findLastSpeaker, estimateLineUnits
} from './pagination.js';
import {
  renderHome, renderRecentProjectMenus, renderStudio,
  renderEditor, renderCoverPreview, renderPreview,
  renderSceneList, renderCharacterList, renderMetrics
} from './renderers.js';
import {
  handleToolSelection, cycleBlockType, changeBlockType,
  handleBlockInput, handleBlockKeydown, updateSuggestions,
  applySuggestion
} from './actions.js';

const sampleProject = {
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

// --- Initialisation ---

boot();

function boot() {
  loadProjects(sampleProject, sanitizeProject, (proj, id) => cloneProject(proj, id, sanitizeProject, normalizeLineText), normalizeLineText);
  bindEvents();
  showHome();
  renderHome(refs, openProject, removeProject, renderRecentProjectMenus);
  applyToolbarState();
  applyTheme();
  applyViewState();
}

function bindEvents() {
  refs.newProjectBtn.addEventListener("click", () => {
    const project = createProject(sanitizeProject, normalizeLineText, upsertProject, persistProjectsBound);
    openProject(project.id);
  });

  refs.goHomeBtn.addEventListener("click", () => {
    persistProjectsBound(true);
    showHome();
    renderHome(refs, openProject, removeProject, renderRecentProjectMenus);
  });

  [refs.titleInput, refs.authorInput, refs.contactInput, refs.companyInput, refs.detailsInput, refs.loglineInput]
    .forEach((input) => input.addEventListener("input", handleMetaInput));

  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => handleToolSelectionBound(button.dataset.insert));
  });

  document.querySelectorAll("[data-home-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.homeNav === "shortcuts") {
        refs.helpDialog.showModal();
      }
    });
  });

  refs.menuTriggers.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu(button.dataset.menuTrigger);
    });
  });

  refs.themeButtons.forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeValue));
  });

  document.querySelectorAll("[data-menu-action]").forEach((button) => {
    button.addEventListener("click", () => handleMenuAction(button.dataset.menuAction));
  });

  document.querySelectorAll("[data-format-type]").forEach((button) => {
    button.addEventListener("click", () => {
      handleToolSelectionBound(button.dataset.formatType);
      closeMenus();
    });
  });

  document.querySelectorAll("[data-view-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleViewOption(button.dataset.viewToggle));
  });

  document.querySelectorAll("[data-text-size]").forEach((button) => {
    button.addEventListener("click", () => setTextSize(button.dataset.textSize));
  });

  refs.saveBtn.addEventListener("click", () => persistProjectsBound(true));
  refs.exportTxtBtn.addEventListener("click", exportTxt);
  refs.exportJsonBtn.addEventListener("click", exportJson);
  refs.exportWordBtn.addEventListener("click", exportWord);
  refs.exportPdfBtn.addEventListener("click", exportPdf);
  refs.fileInput.addEventListener("change", importFile);
  refs.helpBtn.addEventListener("click", () => refs.helpDialog.showModal());
  refs.autoCapsToggle.addEventListener("change", () => {
    const project = getCurrentProject();
    if (!project) {
      return;
    }
    project.lines = project.lines.map((line) => ({
      ...line,
      text: normalizeLineText(stripWrapperChars(line.text), line.type)
    }));
    renderStudioBound();
    queueSave();
  });
  refs.typewriterToggle.addEventListener("change", () => {
    document.body.classList.toggle("typewriter-mode", refs.typewriterToggle.checked);
  });
  refs.autoNumberToggle.addEventListener("change", () => {
    state.autoNumberScenes = refs.autoNumberToggle.checked;
    renderPreviewBound();
    queueSave();
  });
  refs.aiAssistToggle.addEventListener("change", () => {
    state.aiAssist = refs.aiAssistToggle.checked;
    refs.aiPanel.hidden = !state.aiAssist;
    queueSave();
  });
  refs.aiSuggestBtn.addEventListener("click", insertAiAssistNote);
  refs.leftRailToggle.addEventListener("click", () => togglePane("left"));
  refs.rightRailToggle.addEventListener("click", () => togglePane("right"));
  refs.toolStripToggle.addEventListener("click", toggleToolStrip);
  refs.leftPaneSectionToggle.addEventListener("click", () => togglePaneSection(refs.leftPaneBody, refs.leftPaneSectionToggle));
  refs.rightPaneSectionToggle.addEventListener("click", () => togglePaneSection(refs.rightPaneBody, refs.rightPaneSectionToggle));
  refs.duplicateProjectBtn.addEventListener("click", duplicateProject);
  refs.loadSampleBtn.addEventListener("click", replaceWithSample);
  refs.deleteProjectBtn.addEventListener("click", deleteProject);

  initResizeHandle(refs.leftResize, "left");
  initResizeHandle(refs.rightResize, "right");
  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("click", handleDocumentClick);
}

// --- Wrappers and Bounds ---

function persistProjectsBound(forceSavedBadge = false) {
    persistProjects(forceSavedBadge, refs, syncProjectFromInputs, () => renderHome(refs, openProject, removeProject, renderRecentProjectMenus));
}

function handleToolSelectionBound(type) {
    handleToolSelection(type, getLine, addBlock, renderStudioBound, focusBlock, queueSave, changeBlockTypeBound);
}

function changeBlockTypeBound(id, nextType) {
    changeBlockType(id, nextType, getLine, getCurrentProject, normalizeConvertedText, renderStudioBound, focusBlock, queueSave);
}

function renderStudioBound() {
    renderStudio(refs, syncInputsFromProject, renderEditorBound, renderCoverPreviewBound, renderPreviewBound, renderSceneListBound, renderCharacterListBound, renderMetricsBound, updateActiveTool, updateSuggestionsBound, applyViewState, renderRecentProjectMenus, openProject);
}

function renderEditorBound() {
    renderEditor(refs, getCurrentProject, buildVisibleFilterSet, toggleSceneCollapse, setActiveBlock, handleBlockInputBound, handleBlockKeydownBound);
}

function handleBlockInputBound(id, element) {
    handleBlockInput(id, element, getLine, getCurrentProject, getCharacterAutocomplete, normalizeLineText, selectTextSuffix, placeCaretAtEnd, setActiveBlock, renderPreviewBound, renderSceneListBound, renderCharacterListBound, renderMetricsBound, () => renderHome(refs, openProject, removeProject, renderRecentProjectMenus), updateSuggestionsBound, queueSave);
}

function handleBlockKeydownBound(event, id) {
    handleBlockKeydown(event, id, getCurrentProject, getLineIndex, inferNextType, addBlock, renderStudioBound, focusBlock, queueSave, (lineId) => cycleBlockType(lineId, getLine, changeBlockTypeBound));
}

function updateSuggestionsBound() {
    updateSuggestions(refs, getLine, buildSuggestions, applySuggestionBound);
}

function applySuggestionBound(value) {
    applySuggestion(value, getLine, getCurrentProject, normalizeLineText, renderStudioBound, focusBlock, queueSave);
}

function renderCoverPreviewBound() {
    renderCoverPreview(refs, syncProjectFromInputs, getCurrentProject);
}

function renderPreviewBound() {
    renderPreview(refs, getCurrentProject, buildPreviewData);
}

function renderSceneListBound() {
    renderSceneList(refs, getCurrentProject, normalizeLineText, getSceneFirstLine, focusBlock);
}

function renderCharacterListBound() {
    renderCharacterList(refs, getCurrentProject, normalizeLineText, focusBlock);
}

function renderMetricsBound() {
    renderMetrics(refs, getCurrentProject, serializeScript, normalizeLineText);
}

// --- Helper Functions (Remaining in main for now or logic heavy) ---

function showHome() {
  refs.homeView.hidden = false;
  refs.studioView.hidden = true;
}

function showStudio() {
  refs.homeView.hidden = true;
  refs.studioView.hidden = false;
}

function openProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) {
    return;
  }
  state.currentProjectId = project.id;
  state.activeBlockId = project.lines[0]?.id || null;
  state.activeType = project.lines[0]?.type || "action";
  refs.aiAssistToggle.checked = state.aiAssist;
  refs.autoNumberToggle.checked = state.autoNumberScenes;
  refs.aiPanel.hidden = !state.aiAssist;
  syncInputsFromProject(project);
  showStudio();
  renderStudioBound();
  if (state.activeBlockId) {
    focusBlock(state.activeBlockId);
  }
}

function syncInputsFromProject(project) {
  refs.titleInput.value = project.title;
  refs.authorInput.value = project.author;
  refs.contactInput.value = project.contact;
  refs.companyInput.value = project.company;
  refs.detailsInput.value = project.details;
  refs.loglineInput.value = project.logline;
}

function syncProjectFromInputs() {
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

function handleMetaInput() {
  syncProjectFromInputs();
  renderCoverPreviewBound();
  renderPreviewBound();
  renderHome(refs, openProject, removeProject, renderRecentProjectMenus);
  queueSave();
}

function buildPreviewData(project) {
  const preparedLines = [];
  let sceneNumber = 0;

  project.lines.forEach((line) => {
    const normalized = normalizeLineText(line.text, line.type);
    if (!normalized) {
      return;
    }
    if (line.type === "scene") {
      sceneNumber += 1;
    }
    preparedLines.push({
      id: line.id,
      type: line.type,
      displayText: state.autoNumberScenes && line.type === "scene" ? `${sceneNumber}. ${normalized}` : normalized
    });
  });

  return {
    scriptPages: paginateScriptLines(preparedLines, (t, tex) => estimateLineUnits(t, tex, stripWrapperChars), stripWrapperChars, (l, i) => findLastSpeaker(l, i, stripWrapperChars))
  };
}

function buildVisibleFilterSet(project) {
  const query = state.filterQuery.trim().toLowerCase();
  if (!query) {
    return null;
  }

  const visible = new Set();
  project.lines.forEach((line, index) => {
    if (!buildSearchText(line).includes(query)) {
      return;
    }
    visible.add(line.id);
    const ownerSceneId = getSceneIdForIndex(index, project);
    if (ownerSceneId) {
      visible.add(ownerSceneId);
    }
  });

  return visible;
}

function buildSearchText(line) {
  return `${TYPE_LABELS[line.type]} ${normalizeLineText(line.text, line.type)}`.toLowerCase();
}

function getSceneIdForIndex(index, project = getCurrentProject()) {
  if (!project || index < 0) {
    return "";
  }
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (project.lines[cursor]?.type === "scene") {
      return project.lines[cursor].id;
    }
  }
  return "";
}

function getOwningSceneId(lineId) {
  return getSceneIdForIndex(getLineIndex(lineId));
}

function toggleSceneCollapse(sceneId) {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
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
  renderEditorBound();
  focusBlock(sceneId);
  queueSave();
}

function setActiveBlock(id) {
  state.activeBlockId = id;
  state.activeType = getLine(id)?.type || "action";
  refs.screenplayEditor.querySelectorAll(".script-block-row").forEach((row) => {
    row.classList.toggle("is-active", row.dataset.id === id);
  });
  updateActiveTool();
  updateSuggestionsBound();
}

function updateActiveTool() {
  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.insert === state.activeType);
  });
  refs.activeModeLabel.textContent = ">";
  refs.activeModeLabel.title = `Active block: ${TYPE_LABELS[state.activeType] || "Action"}`;
}

function addBlock(type, text = "", index) {
  const project = getCurrentProject();
  const insertAt = Number.isInteger(index) ? index : project.lines.length;
  const line = { id: uid(), type, text: normalizeLineText(text, type) };
  project.lines.splice(insertAt, 0, line);
  project.updatedAt = new Date().toISOString();
  state.activeBlockId = line.id;
  state.activeType = type;
  return line.id;
}

function inferNextType(index) {
  const current = getCurrentProject()?.lines[index]?.type || "action";
  if (current === "scene") return "action";
  if (current === "character") return "dialogue";
  if (current === "parenthetical") return "dialogue";
  if (current === "dialogue") return "character";
  if (current === "transition") return "scene";
  if (current === "dual") return "dialogue";
  return "action";
}

function getSuggestedNextSpeaker(contextIndex) {
  const project = getCurrentProject();
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

function buildSuggestions(type, currentText) {
  const project = getCurrentProject();
  const trimmed = currentText.trim().toUpperCase();
  if (!project) {
    return [];
  }

  if (type === "character") {
    const all = [...new Set(project.lines
      .filter((line) => line.type === "character" && line.text.trim())
      .map((line) => normalizeLineText(line.text, "character")))];
    const lead = getSuggestedNextSpeaker(getLineIndex(state.activeBlockId));
    return [lead, ...all]
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .filter((value) => !trimmed || value.includes(trimmed))
      .map((value) => ({ label: value, value }));
  }

  if (type === "scene") {
    const sceneHeadings = project.lines
      .filter((line) => line.type === "scene" && line.text.trim())
      .map((line) => normalizeLineText(line.text, "scene"));
    const previousScene = getPreviousSceneHeading(getLineIndex(state.activeBlockId));
    const carryOvers = previousScene ? buildContinuedSceneSuggestions(previousScene) : [];
    return [...new Set([...DEFAULT_SUGGESTIONS.scene, ...carryOvers, ...sceneHeadings])]
      .filter((value) => !trimmed || value.includes(trimmed))
      .map((value) => ({ label: value, value }));
  }

  if (type === "transition") {
    return [...new Set(DEFAULT_SUGGESTIONS.transition)]
      .filter((value) => !trimmed || value.includes(trimmed))
      .map((value) => ({ label: value, value }));
  }

  if (type === "shot" || type === "parenthetical" || type === "note" || type === "image") {
    return (DEFAULT_SUGGESTIONS[type] || [])
      .filter((value) => !trimmed || value.toUpperCase().includes(trimmed))
      .map((value) => ({
        label: type === "parenthetical" ? `(${value})` : (type === "note" ? `[${value}]` : value),
        value
      }));
  }

  return [];
}

function getPreviousSceneHeading(activeIndex) {
  const project = getCurrentProject();
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    if (project.lines[index]?.type === "scene" && project.lines[index].text.trim()) {
      return normalizeLineText(project.lines[index].text, "scene");
    }
  }
  return "";
}

function buildContinuedSceneSuggestions(previousScene) {
  const base = sceneBase(previousScene);
  if (!base) {
    return [];
  }
  return SCENE_TIMES.map((time) => `${base} - ${time}`);
}

function sceneBase(heading) {
  const match = heading.match(/^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.)\s*(.*?)(?:\s*-\s*[A-Z'\/. ]+)?$/i);
  if (!match) {
    return heading;
  }
  const prefix = match[1].toUpperCase().replace("INT/EXT.", "INT./EXT.");
  const location = match[2].trim();
  return location ? `${prefix} ${location.toUpperCase()}` : prefix;
}

function getCharacterAutocomplete(text, activeId) {
  const cleaned = text.trim().toUpperCase();
  if (cleaned.length < 2) {
    return "";
  }
  const matches = buildSuggestions("character", cleaned)
    .map((item) => item.value)
    .filter((value) => value.startsWith(cleaned));
  const exact = getLine(activeId)?.text?.trim().toUpperCase() === cleaned;
  if (exact || matches.length !== 1) {
    return "";
  }
  return matches[0];
}

function handleGlobalKeydown(event) {
  const key = event.key.toLowerCase();

  if ((event.ctrlKey || event.metaKey) && key === "s") {
    event.preventDefault();
    persistProjectsBound(true);
    return;
  }

  if (state.visibleSuggestions.length && /^[1-9]$/.test(event.key)) {
    const choice = state.visibleSuggestions[Number(event.key) - 1];
    if (choice) {
      event.preventDefault();
      applySuggestionBound(choice.value);
      return;
    }
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const map = {
      s: "scene",
      a: "action",
      c: "character",
      d: "dialogue",
      t: "transition",
      p: "parenthetical",
      o: "shot",
      x: "text",
      n: "note",
      u: "dual",
      i: "image"
    };
    if (map[key]) {
      event.preventDefault();
      handleToolSelectionBound(map[key]);
    }
  }

  if (event.key === "Escape") {
    closeMenus();
  }
}

function handleMenuAction(action) {
  switch (action) {
    case "new-project":
      openProject(createProject(sanitizeProject, normalizeLineText, upsertProject, persistProjectsBound).id);
      break;
    case "open-projects":
      persistProjectsBound(true);
      showHome();
      renderHome(refs, openProject, removeProject, renderRecentProjectMenus);
      break;
    case "save-project":
      persistProjectsBound(true);
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
      printProject();
      break;
    case "exit-studio":
      persistProjectsBound(true);
      showHome();
      renderHome(refs, openProject, removeProject, renderRecentProjectMenus);
      break;
    case "undo":
      execEditorCommand("undo");
      break;
    case "redo":
      execEditorCommand("redo");
      break;
    case "insert-page-break":
      insertMenuBlock("text", "--- PAGE BREAK ---");
      break;
    case "insert-hyperlink":
      insertHyperlink();
      break;
    case "insert-image":
      handleToolSelectionBound("image");
      break;
    case "select-all":
      selectActiveBlock();
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
      toggleFullscreen();
      break;
    case "proofread":
      showProofreadReport();
      break;
    case "toggle-ai-assistant":
      toggleAiAssistantFromMenu();
      break;
    case "show-work-tracking":
      showWorkTracking();
      break;
    case "show-metrics":
      revealMetricsPanel();
      break;
    default:
      break;
  }

  closeMenus();
}

function renameCurrentProject() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const nextTitle = window.prompt("Rename this project:", project.title);
  if (nextTitle === null) {
    return;
  }
  project.title = nextTitle.trim() || "Untitled Script";
  project.updatedAt = new Date().toISOString();
  syncInputsFromProject(project);
  renderStudioBound();
  queueSave();
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

function insertMenuBlock(type, text) {
  const index = Math.max(getLineIndex(state.activeBlockId), -1);
  const newId = addBlock(type, text, index + 1);
  renderStudioBound();
  focusBlock(newId, true);
  queueSave();
}

function insertHyperlink() {
  const url = window.prompt("Enter the hyperlink URL:");
  if (url === null || !url.trim()) {
    return;
  }
  const label = window.prompt("Optional display text:", "");
  const cleanedUrl = url.trim();
  const cleanedLabel = label === null ? "" : label.trim();
  const text = cleanedLabel ? `${cleanedLabel} <${cleanedUrl}>` : cleanedUrl;
  insertMenuBlock("text", text);
}

function selectActiveBlock() {
  const target = getActiveEditableBlock();
  if (!target) {
    return;
  }
  target.focus();
  selectElementText(target);
}

function findInScript() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const query = window.prompt("Find text in this script:", state.filterQuery);
  if (query === null) {
    return;
  }
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) {
    clearScriptFilter();
    return;
  }
  const match = project.lines.find((line) => buildSearchText(line).includes(cleaned));
  if (!match) {
    window.alert(`No matches found for "${query}".`);
    return;
  }
  state.filterQuery = "";
  renderStudioBound();
  focusBlock(match.id, true);
}

function setScriptFilter() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const nextFilter = window.prompt("Filter visible lines by text or line function:", state.filterQuery);
  if (nextFilter === null) {
    return;
  }
  state.filterQuery = nextFilter.trim();
  renderStudioBound();
  if (!state.filterQuery) {
    return;
  }
  const visibleSet = buildVisibleFilterSet(project);
  const firstVisible = project.lines.find((line) => visibleSet?.has(line.id));
  if (firstVisible) {
    focusBlock(firstVisible.id);
  }
}

function clearScriptFilter() {
  if (!state.filterQuery) {
    return;
  }
  state.filterQuery = "";
  renderStudioBound();
}

function toggleViewOption(optionKey) {
  if (!(optionKey in state.viewOptions)) {
    return;
  }
  state.viewOptions[optionKey] = !state.viewOptions[optionKey];
  applyViewState();
  renderPreviewBound();
  queueSave();
}

function setTextSize(value) {
  state.viewOptions.textSize = clamp(value, 11, 14);
  applyViewState();
  queueSave();
  closeMenus();
}

function applyViewState() {
  document.body.classList.toggle("show-ruler", state.viewOptions.ruler);
  document.body.classList.toggle("outline-hidden", !state.viewOptions.showOutline);
  document.documentElement.style.setProperty("--script-font-size", `${state.viewOptions.textSize}pt`);
  updateMenuStateButtons();
}

function updateMenuStateButtons() {
  document.querySelectorAll("[data-view-toggle]").forEach((button) => {
    button.classList.toggle("is-active", Boolean(state.viewOptions[button.dataset.viewToggle]));
  });

  document.querySelectorAll("[data-text-size]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.textSize) === state.viewOptions.textSize);
  });

  document.querySelectorAll("[data-menu-action='toggle-ai-assistant']").forEach((button) => {
    button.classList.toggle("is-active", state.aiAssist);
  });

  document.querySelectorAll("[data-menu-action='filter']").forEach((button) => {
    button.classList.toggle("is-active", Boolean(state.filterQuery));
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  document.documentElement.requestFullscreen?.();
}

function toggleAiAssistantFromMenu() {
  state.aiAssist = !state.aiAssist;
  refs.aiAssistToggle.checked = state.aiAssist;
  refs.aiPanel.hidden = !state.aiAssist;
  updateMenuStateButtons();
  queueSave();
}

function showProofreadReport() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }

  const issues = [];
  const emptyScenes = project.lines.filter((line) => line.type === "scene" && !normalizeLineText(line.text, "scene")).length;
  const weakSceneLines = project.lines.filter((line) => line.type === "scene" && line.text && !/^(INT\.|EXT\.|INT\.\/EXT\.|EST\.)/i.test(normalizeLineText(line.text, "scene"))).length;
  const loneCharacters = project.lines.filter((line, index) => line.type === "character" && !project.lines[index + 1]?.text?.trim()).length;

  if (emptyScenes) {
    issues.push(`${emptyScenes} empty scene heading${emptyScenes === 1 ? "" : "s"}`);
  }
  if (weakSceneLines) {
    issues.push(`${weakSceneLines} scene heading${weakSceneLines === 1 ? "" : "s"} without a standard INT./EXT. start`);
  }
  if (loneCharacters) {
    issues.push(`${loneCharacters} character cue${loneCharacters === 1 ? "" : "s"} with no following line`);
  }

  window.alert(issues.length ? `Proofread highlights:\n- ${issues.join("\n- ")}` : "Proofread highlights:\n- No obvious screenplay-format issues were found in the current draft.");
}

function showWorkTracking() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const scenes = project.lines.filter((line) => line.type === "scene" && line.text.trim()).length;
  const words = (serializeScript(project).match(/\b[\w'-]+\b/g) || []).length;
  window.alert([
    `Project: ${project.title}`,
    `Created: ${formatDateTime(project.createdAt)}`,
    `Last updated: ${formatDateTime(project.updatedAt)}`,
    `Scenes: ${scenes}`,
    `Words: ${words.toLocaleString()}`
  ].join("\n"));
}

function revealMetricsPanel() {
  if (refs.leftPane.classList.contains("is-hidden")) {
    togglePane("left");
  }
  if (refs.leftPaneBody.classList.contains("is-collapsed")) {
    togglePaneSection(refs.leftPaneBody, refs.leftPaneSectionToggle);
  }
  document.querySelector(".section-metrics")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function normalizeConvertedText(text, type) {
  const stripped = stripWrapperChars(String(text || "").trim());
  if (!stripped) {
    return type === "character" ? getSuggestedNextSpeaker(getLineIndex(state.activeBlockId)) : "";
  }
  return normalizeLineText(stripped, type);
}



function normalizeLineText(text, type) {
  const compact = String(text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^\s+/, "");

  if (!compact.trim()) {
    return "";
  }

  if (type === "note") {
    return `[${stripWrapperChars(compact)}]`;
  }

  if (type === "parenthetical") {
    return `(${stripWrapperChars(compact)})`;
  }

  if (type === "image") {
    const inner = stripWrapperChars(compact);
    return inner.toUpperCase().startsWith("IMAGE:") ? inner : `IMAGE: ${inner}`;
  }

  if (AUTO_UPPERCASE_TYPES.has(type) && refs.autoCapsToggle.checked) {
    return compact.toUpperCase();
  }

  return compact;
}

function serializeScript(project) {
  return project.lines.map((line) => normalizeLineText(line.text, line.type)).filter(Boolean).join("\n\n");
}

function queueSave() {
  refs.saveBadge.textContent = "Saving...";
  clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => persistProjectsBound(false), 200);
}

function exportTxt() {
  const project = syncProjectFromInputs() || getCurrentProject();
  const content = [
    project.title,
    project.author,
    project.contact,
    project.company,
    project.details,
    project.logline,
    "",
    serializeScript(project)
  ].filter(Boolean).join("\n");
  downloadFile(`${slugify(project.title)}.txt`, content, "text/plain");
}

function exportJson() {
  const project = syncProjectFromInputs() || getCurrentProject();
  downloadFile(`${slugify(project.title)}.json`, JSON.stringify(project, null, 2), "application/json");
}

function exportWord() {
  const project = syncProjectFromInputs() || getCurrentProject();
  const content = buildPrintableDocument(project);
  downloadFile(`${slugify(project.title)}.doc`, content, "application/msword");
}

function exportPdf() {
  openPreviewWindow(true);
}

function printProject() {
  openPreviewWindow(true);
}

function openPreviewWindow(autoPrint) {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) {
    return;
  }
  const previewWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!previewWindow) {
    window.alert("Preview pop-up was blocked. Please allow pop-ups for this app to print or save as PDF.");
    return;
  }
  previewWindow.document.open();
  previewWindow.document.write(buildPrintableDocument(project, autoPrint));
  previewWindow.document.close();
}

function buildPrintableDocument(project, autoPrint = false) {
  const previewData = buildPreviewData(project);
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\nby\n\n${escapeHtml(project.author || "Author")}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  const coverMarkup = `
    <section class="print-page cover-page">
      <pre class="print-cover-text">${coverText}</pre>
    </section>
    <div class="print-page-break" aria-hidden="true"></div>
  `;

  const scriptMarkup = previewData.scriptPages.map((pageLines, index) => `
    <section class="print-page">
      ${index >= 0 ? `<div class="print-header">${index === 0 ? "" : (index + 1) + "."}</div>` : ""}
      <div class="print-body">
        ${pageLines.map((line) => `<p class="print-line ${line.type}">${escapeHtml(line.displayText)}</p>`).join("")}
      </div>
    </section>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="ProgId" content="Word.Document">
  <meta name="Generator" content="Microsoft Word">
  <title>${escapeHtml(project.title)}</title>
  <style>${getPrintableStyles()}</style>
</head>
<body data-theme="${escapeHtml(state.theme)}">
  <main class="print-shell">
    ${coverMarkup}
    ${scriptMarkup}
  </main>
  ${autoPrint ? "<script>window.addEventListener('load', function () { window.print(); });</script>" : ""}
</body>
</html>`;
}

function getPrintableStyles() {
  return `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f1ef;
      color: #111;
      font-family: "Courier New", monospace;
    }
    .print-shell {
      display: grid;
      gap: 0;
      padding: 24px;
    }
    .print-page {
      width: 8.5in;
      height: 11in;
      margin: 0 auto;
      padding: 1.0in 1.0in 1.0in 1.5in;
      background: #fff;
      color: #111;
      position: relative;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.08);
      page-break-after: always;
      break-after: page;
      overflow: hidden;
    }
    .cover-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      page-break-after: auto;
      break-after: auto;
    }
    .print-cover-text {
      font-family: inherit;
      font-size: inherit;
      white-space: pre-wrap;
      text-align: center;
      margin: 0;
    }
    .print-header {
      position: absolute;
      top: 0.5in;
      right: 1.0in;
      width: 1in;
      text-align: right;
      font-size: 12pt;
      font-family: "Courier New", Courier, monospace;
    }
    .print-body {
      width: 6in;
      font-size: 12pt;
      line-height: 12pt;
      font-family: "Courier New", Courier, monospace;
    }
    .print-line {
      margin: 0;
      min-height: 12pt;
      white-space: pre-wrap;
      width: 60ch;
    }
    .print-line.blank {
      min-height: 12pt;
    }
    .print-line.scene,
    .print-line.shot,
    .print-line.transition,
    .print-line.character,
    .print-line.dual {
      font-weight: 700;
      text-transform: uppercase;
    }
    .print-line.character,
    .print-line.dual {
      margin-left: 22ch;
      width: 38ch;
    }
    .print-line.dialogue {
      margin-left: 10ch;
      width: 35ch;
    }
    .print-line.parenthetical {
      margin-left: 16ch;
      width: 25ch;
    }
    .print-line.dialogue-more {
      margin-left: 10ch;
      width: 35ch;
    }
    .print-line.continuity {
      width: 60ch;
    }
    .print-line.transition {
      margin-left: auto;
      width: 100%;
      text-align: right;
    }
    .print-page-break {
      height: 0;
      page-break-after: always;
      break-after: page;
    }
    .print-footer {
      text-align: right;
      font-family: "Aptos", "Segoe UI", sans-serif;
      font-size: 11px;
      color: #666;
    }
    @page {
      size: letter;
      margin: 0.35in;
    }
    @media print {
      body {
        background: #fff;
      }
      .print-shell {
        padding: 0;
      }
      .print-page {
        box-shadow: none;
        margin: 0;
      }
    }
  `;
}

function importFile(event) {
  const [file] = event.target.files || [];
  const project = getCurrentProject();
  if (!file || !project) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    let nextProject;

    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        nextProject = sanitizeProject(JSON.parse(text), normalizeLineText);
      } catch (error) {
        console.error("Invalid JSON import", error);
        return;
      }
    } else {
      nextProject = sanitizeProject({
        ...project,
        title: file.name.replace(/\.[^.]+$/, ""),
        lines: parseTextToLines(text)
      }, normalizeLineText);
    }

    nextProject.id = project.id;
    nextProject.createdAt = project.createdAt;
    upsertProject(nextProject, sanitizeProject, normalizeLineText);
    openProject(nextProject.id);
    persistProjectsBound(true);
  };

  reader.readAsText(file);
  refs.fileInput.value = "";
}

function parseTextToLines(text) {
  const rawLines = text.replace(/\.\n/g, "\n").split(/\n{1,2}/).map((line) => line.trim()).filter(Boolean);
  return rawLines.map((line, index) => ({
    id: uid(),
    type: inferTypeFromText(line, rawLines[index - 1] || "", rawLines[index + 1] || ""),
    text: line
  }));
}

function inferTypeFromText(line, prevLine, nextLine) {
  if (/^(INT\.|EXT\.|INT\/EXT\.|INT\.\/EXT\.|EST\.)/i.test(line)) return "scene";
  if (/^(CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|FADE OUT\.)/i.test(line)) return "transition";
  if (/^(.*)$/.test(line)) return "parenthetical";
  if (/^\[.*\]$/.test(line)) return "note";
  if (/^(CLOSE ON|WIDE SHOT|INSERT|POV|OVERHEAD SHOT)/i.test(line)) return "shot";
  if (/^IMAGE:/i.test(line)) return "image";
  if (looksLikeCharacter(line, prevLine, nextLine)) return "character";
  if (prevLine && looksLikeCharacter(prevLine, "", line)) return "dialogue";
  return "action";
}

function looksLikeCharacter(line, prevLine, nextLine) {
  if (!line || line.length > 32 || /:/.test(line) || /\.$/.test(line)) {
    return false;
  }
  const isUppercase = line === line.toUpperCase();
  const followedByDialogue = nextLine && !/^(INT\.|EXT\.|CUT TO:|\[|IMAGE:)/i.test(nextLine);
  const separated = !prevLine || /^(INT\.|EXT\.|\.|CUT TO:|FADE OUT\.)/i.test(prevLine);
  return isUppercase && (followedByDialogue || separated);
}

function duplicateProject() {
  const current = getCurrentProject();
  const copy = cloneProject({ ...current, title: `${current.title} Copy` }, true, sanitizeProject, normalizeLineText);
  upsertProject(copy, sanitizeProject, normalizeLineText);
  openProject(copy.id);
  persistProjectsBound(true);
}

function replaceWithSample() {
  const current = getCurrentProject();
  const replacement = cloneProject(sampleProject, false, sanitizeProject, normalizeLineText);
  replacement.id = current.id;
  replacement.createdAt = current.createdAt;
  upsertProject(replacement, sanitizeProject, normalizeLineText);
  openProject(replacement.id);
  persistProjectsBound(true);
}

function deleteProject() {
  const current = getCurrentProject();
  if (!current) {
    return;
  }
  removeProject(current.id);
}

function removeProject(id) {
  const target = state.projects.find((item) => item.id === id);
  if (!target || !window.confirm(`Delete "${target.title}"?`)) {
    return;
  }
  state.projects = state.projects.filter((item) => item.id !== id);
  if (!state.projects.length) {
    const replacement = sanitizeProject({
      id: uid("project"),
      title: "Script Name 1",
      lines: [{ id: uid(), type: "action", text: "" }]
    }, normalizeLineText);
    state.projects = [replacement];
  }
  state.currentProjectId = state.projects[0].id;
  persistProjectsBound(true);
  showHome();
  renderHome(refs, openProject, removeProject, renderRecentProjectMenus);
}

function insertAiAssistNote() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const index = getLineIndex(state.activeBlockId);
  const prompt = "AI ASSIST: Suggest the next beat, sharpen the scene objective, and keep the current voice.";
  const newId = addBlock("note", prompt, index + 1);
  renderStudioBound();
  focusBlock(newId, true);
  queueSave();
}

function togglePane(side) {
  const isLeft = side === "left";
  const pane = isLeft ? refs.leftPane : refs.rightPane;
  const handle = isLeft ? refs.leftResize : refs.rightResize;
  const button = isLeft ? refs.leftRailToggle : refs.rightRailToggle;
  const collapsed = pane.classList.toggle("is-hidden");
  handle.classList.toggle("is-hidden", collapsed);
  refs.studioLayout.classList.toggle(isLeft ? "left-pane-hidden" : "right-pane-hidden", collapsed);
  button.textContent = collapsed ? (isLeft ? ">" : "<") : (isLeft ? "<" : ">");
}

function togglePaneSection(body, button) {
  body.classList.toggle("is-collapsed");
  button.textContent = body.classList.contains("is-collapsed") ? "v" : "^";
}

function toggleToolStrip() {
  state.toolStripCollapsed = !state.toolStripCollapsed;
  applyToolbarState();
  persistProjectsBound(false);
}

function applyToolbarState() {
  refs.toolStrip.classList.toggle("is-collapsed", state.toolStripCollapsed);
  refs.toolStripToggle.textContent = state.toolStripCollapsed ? "v" : "^";
}

function toggleMenu(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) {
    return;
  }
  const trigger = document.querySelector(`[data-menu-trigger="${menuId}"]`);
  const willOpen = menu.hidden;
  closeMenus();
  menu.hidden = !willOpen;
  trigger?.classList.toggle("is-open", willOpen);
}

function closeMenus() {
  document.querySelectorAll(".nav-menu").forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll("[data-menu-trigger]").forEach((button) => {
    button.classList.remove("is-open");
  });
}

function handleDocumentClick(event) {
  if (event.target.closest(".nav-stack")) {
    return;
  }
  closeMenus();
}

function setTheme(theme) {
  state.theme = theme;
  applyTheme();
  closeMenus();
  persistProjectsBound(false);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  refs.themeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.themeValue === state.theme);
  });
}

function initResizeHandle(handle, side) {
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
      persistProjectsBound(false);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}

function focusBlock(id, selectAll = false) {
  if (state.filterQuery) {
    const visibleSet = buildVisibleFilterSet(getCurrentProject());
    if (visibleSet && !visibleSet.has(id)) {
      state.filterQuery = "";
      renderStudioBound();
    }
  }

  const ownerSceneId = getOwningSceneId(id);
  const project = getCurrentProject();
  if (ownerSceneId && ownerSceneId !== id && project?.collapsedSceneIds.includes(ownerSceneId)) {
    project.collapsedSceneIds = project.collapsedSceneIds.filter((sceneId) => sceneId !== ownerSceneId);
    renderStudioBound();
  }

  const target = refs.screenplayEditor.querySelector(`.script-block[data-id="${id}"]`);
  if (!target) {
    return;
  }
  target.focus();
  if (selectAll) {
    selectElementText(target);
  } else {
    placeCaretAtEnd(target);
  }
  setActiveBlock(id);
  target.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function getActiveEditableBlock() {
  return refs.screenplayEditor.querySelector(`.script-block[data-id="${state.activeBlockId}"]`);
}
