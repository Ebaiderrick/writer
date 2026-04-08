import { state, TYPE_SEQUENCE, TYPE_LABELS } from './config.js';
import { refs } from './dom.js';
import {
  getCurrentProject, getLine, getLineIndex, persistProjects, queueSave,
  createProject, upsertProject, sanitizeProject, cloneProject,
  syncProjectFromInputs, serializeScript, replaceWithSample as restoreSample
} from './project.js';
import {
  renderEditor, setActiveBlock, focusBlock, getActiveEditableBlock,
  getOwningSceneId, getCharacterAutocomplete
} from './editor.js';
import { renderPreview, renderCoverPreview, buildPrintableDocument } from './preview.js';
import {
  renderHome, renderRecentProjectMenus, syncInputsFromProject,
  showStudio, showHome, applyViewState, setTheme, toggleMenu,
  closeMenus, applyToolbarState, renderMetrics, renderSceneList,
  renderCharacterList, showProofreadReport, showWorkTracking, revealMetricsPanel
} from './ui.js';
import {
  normalizeLineText, stripWrapperChars, buildContinuedSceneSuggestions,
  slugify, downloadFile, selectElementText, parseTextToLines, uid,
  placeCaretAtEnd, getCaretOffset, setCaretOffset
} from './utils.js';

export function bindEvents() {
  // Navigation
  refs.newProjectBtn.addEventListener("click", () => {
    const project = createProject();
    openProject(project.id);
  });

  refs.goHomeBtn.addEventListener("click", () => {
    persistProjects(true);
    showHome();
    renderHome();
  });

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
  });

  refs.themeButtons.forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeValue));
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

  refs.autoCapsToggle.addEventListener("change", () => {
    const project = getCurrentProject();
    if (!project) return;
    project.lines = project.lines.map((line) => ({
      ...line,
      text: normalizeLineText(stripWrapperChars(line.text), line.type)
    }));
    renderStudio();
    queueSave();
  });

  refs.aiAssistToggle.addEventListener("change", () => {
    state.aiAssist = refs.aiAssistToggle.checked;
    refs.aiPanel.hidden = !state.aiAssist;
    queueSave();
  });

  refs.aiSuggestBtn.addEventListener("click", insertAiAssistNote);

  // Layout Toggles
  refs.leftRailToggle.addEventListener("click", () => togglePane("left"));
  refs.rightRailToggle.addEventListener("click", () => togglePane("right"));
  refs.toolStripToggle.addEventListener("click", () => {
      state.toolStripCollapsed = !state.toolStripCollapsed;
      applyToolbarState();
      persistProjects(false);
  });

  refs.leftPaneSectionToggle.addEventListener("click", () => togglePaneSection(refs.leftPaneBody, refs.leftPaneSectionToggle));
  refs.rightPaneSectionToggle.addEventListener("click", () => togglePaneSection(refs.rightPaneBody, refs.rightPaneSectionToggle));

  refs.duplicateProjectBtn.addEventListener("click", duplicateProject);
  refs.loadSampleBtn.addEventListener("click", replaceWithSample);
  refs.deleteProjectBtn.addEventListener("click", deleteProject);

  // Global Keys & Clicks
  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("click", (event) => {
      if (!event.target.closest(".nav-stack")) {
        closeMenus();
      }
  });

  // Delegated Editor Events
  refs.screenplayEditor.addEventListener("focusin", (e) => {
      if (e.target.classList.contains("script-block")) {
          setActiveBlock(e.target.dataset.id);
      }
  });

  refs.screenplayEditor.addEventListener("click", (e) => {
    if (e.target.classList.contains("script-block")) {
        setActiveBlock(e.target.dataset.id);
    }
    if (e.target.classList.contains("scene-toggle")) {
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

  // Project Grid (Delegated)
  refs.projectGrid.addEventListener("click", (e) => {
      const card = e.target.closest(".project-card");
      if (!card) return;
      const projectId = card.dataset.projectId;

      if (e.target.classList.contains("project-delete")) {
          removeProject(projectId);
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
          applySuggestion(btn.dataset.suggestionValue);
      }
  });

  // Scene/Character List (Delegated)
  refs.sceneList.addEventListener("click", (e) => {
      const item = e.target.closest(".list-item");
      if (item) focusBlock(item.dataset.lineId);
  });

  refs.characterList.addEventListener("click", (e) => {
      const item = e.target.closest(".list-item");
      if (item) focusBlock(item.dataset.lineId);
  });
}

// Action Handlers
export function openProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  state.currentProjectId = project.id;
  state.activeBlockId = project.lines[0]?.id || null;
  state.activeType = project.lines[0]?.type || "action";

  syncInputsFromProject(project);
  showStudio();
  renderStudio();
  if (state.activeBlockId) {
    focusBlock(state.activeBlockId);
  }
}

export function renderStudio() {
  const project = getCurrentProject();
  if (!project) return;
  syncInputsFromProject(project);
  renderEditor();
  renderCoverPreview();
  renderPreview();
  renderSceneList();
  renderCharacterList();
  renderMetrics();
  renderRecentProjectMenus();
  applyViewState();
}

function handleMetaInput() {
  syncProjectFromInputs();
  renderCoverPreview();
  renderPreview();
  renderHome();
  queueSave();
}

function togglePaneSection(body, button) {
  body.classList.toggle("is-collapsed");
  button.textContent = body.classList.contains("is-collapsed") ? "v" : "^";
}

function handleBlockInput(id, element) {
  const line = getLine(id);
  const project = getCurrentProject();
  if (!line || !project) return;

  const offset = getCaretOffset(element);
  const beforeText = element.textContent || "";
  let normalized = normalizeLineText(beforeText, line.type);
  let autoCompleted = false;

  if (line.type === "character") {
    const completion = getCharacterAutocomplete(normalized, id);
    if (completion && completion !== normalized) {
      normalized = completion;
      element.textContent = completion;
      selectTextSuffix(element, beforeText.trim().length, completion.length);
      autoCompleted = true;
    }
  }

  if (!autoCompleted && normalized !== beforeText) {
    element.textContent = normalized;
    setCaretOffset(element, offset);
  }

  line.text = normalized;
  project.updatedAt = new Date().toISOString();
  setActiveBlock(id);
  renderPreview();
  renderSceneList();
  renderCharacterList();
  renderMetrics();
  renderHome();
  queueSave();
}

function handleBlockKeydown(event, id) {
  const project = getCurrentProject();
  const index = getLineIndex(id);
  const line = project?.lines[index];
  if (!line) return;

  if (event.key === "Delete") {
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
    const nextType = inferNextType(index);
    const newId = addBlock(nextType, "", index + 1);
    renderStudio();
    focusBlock(newId, true);
    queueSave();
    return;
  }

  if (event.key === "Backspace" && !line.text.trim() && project.lines.length > 1) {
    event.preventDefault();
    const targetId = project.lines[Math.max(index - 1, 0)].id;
    project.lines.splice(index, 1);
    state.activeBlockId = targetId;
    project.updatedAt = new Date().toISOString();
    renderStudio();
    focusBlock(targetId);
    queueSave();
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    cycleBlockType(id);
  }
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

function cycleBlockType(id) {
  const line = getLine(id);
  if (!line) return;
  const index = TYPE_SEQUENCE.indexOf(line.type);
  changeBlockType(id, TYPE_SEQUENCE[(index + 1) % TYPE_SEQUENCE.length]);
}

function changeBlockType(id, nextType) {
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
  line.text = normalizeLineText(value, line.type);
  project.updatedAt = new Date().toISOString();
  renderStudio();
  focusBlock(line.id, true);
  queueSave();
}

function handleToolSelection(type) {
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
  button.textContent = collapsed ? (isLeft ? ">" : "<") : (isLeft ? "<" : ">");
}

function handleMenuAction(action) {
  switch (action) {
    case "new-project":
      openProject(createProject().id);
      break;
    case "open-projects":
      persistProjects(true);
      showHome();
      renderHome();
      break;
    case "save-project":
      persistProjects(true);
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
      openPreviewWindow(true);
      break;
    case "exit-studio":
      persistProjects(true);
      showHome();
      renderHome();
      break;
    case "undo":
      document.execCommand("undo");
      break;
    case "redo":
      document.execCommand("redo");
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
      state.aiAssist = !state.aiAssist;
      refs.aiAssistToggle.checked = state.aiAssist;
      refs.aiPanel.hidden = !state.aiAssist;
      updateMenuStateButtons();
      queueSave();
      break;
    case "show-work-tracking":
      showWorkTracking();
      break;
    case "show-metrics":
      revealMetricsPanel();
      break;
  }
  closeMenus();
}

function renameCurrentProject() {
  const project = getCurrentProject();
  if (!project) return;
  const nextTitle = window.prompt("Rename this project:", project.title);
  if (nextTitle === null) return;
  project.title = nextTitle.trim() || "Untitled Script";
  project.updatedAt = new Date().toISOString();
  syncInputsFromProject(project);
  renderStudio();
  queueSave();
}

function duplicateProject() {
  const current = getCurrentProject();
  const copy = cloneProject({ ...current, title: `${current.title} Copy` }, true);
  upsertProject(copy);
  openProject(copy.id);
  persistProjects(true);
}

function replaceWithSample() {
  const replacement = restoreSample();
  if (replacement) {
    openProject(replacement.id);
    persistProjects(true);
  }
}

function deleteProject() {
  const current = getCurrentProject();
  if (current) removeProject(current.id);
}

function removeProject(id) {
  const target = state.projects.find((item) => item.id === id);
  if (!target || !window.confirm(`Delete "${target.title}"?`)) return;
  state.projects = state.projects.filter((item) => item.id !== id);
  if (!state.projects.length) {
    state.projects = [createProject()];
  }
  state.currentProjectId = state.projects[0].id;
  persistProjects(true);
  showHome();
  renderHome();
}

function handleGlobalKeydown(event) {
  const key = event.key.toLowerCase();

  // Ctrl/Cmd + S to Save
  if ((event.ctrlKey || event.metaKey) && key === "s") {
    event.preventDefault();
    persistProjects(true);
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
      handleToolSelection(map[key]);
    }
  }

  // Escape to close menus
  if (event.key === "Escape") {
    closeMenus();
  }
}

function insertAiAssistNote() {
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
  const index = Math.max(getLineIndex(state.activeBlockId), -1);
  const newId = addBlock(type, text, index + 1);
  renderStudio();
  focusBlock(newId, true);
  queueSave();
}

function insertHyperlink() {
  const url = window.prompt("Enter the hyperlink URL:");
  if (url === null || !url.trim()) return;
  const label = window.prompt("Optional display text:", "");
  const cleanedUrl = url.trim();
  const cleanedLabel = label === null ? "" : label.trim();
  const text = cleanedLabel ? `${cleanedLabel} <${cleanedUrl}>` : cleanedUrl;
  insertMenuBlock("text", text);
}

function findInScript() {
  const project = getCurrentProject();
  if (!project) return;
  const query = window.prompt("Find text in this script:", state.filterQuery);
  if (query === null) return;
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) {
    clearScriptFilter();
    return;
  }
  const match = project.lines.find((line) => `${TYPE_LABELS[line.type]} ${line.text}`.toLowerCase().includes(cleaned));
  if (!match) {
    window.alert(`No matches found for "${query}".`);
    return;
  }
  state.filterQuery = "";
  renderStudio();
  focusBlock(match.id, true);
}

function setScriptFilter() {
  const project = getCurrentProject();
  if (!project) return;
  const nextFilter = window.prompt("Filter visible lines by text or line function:", state.filterQuery);
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
  const content = [project.title, project.author, "", serializeScript(project)].join("\n");
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

function exportPdf() { openPreviewWindow(true); }

function openPreviewWindow(autoPrint) {
  const project = syncProjectFromInputs() || getCurrentProject();
  if (!project) return;
  const previewWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!previewWindow) return;
  previewWindow.document.open();
  previewWindow.document.write(buildPrintableDocument(project, autoPrint));
  previewWindow.document.close();
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

    nextProject.id = project.id;
    nextProject.createdAt = project.createdAt;
    upsertProject(nextProject);
    openProject(nextProject.id);
    persistProjects(true);
  };

  reader.readAsText(file);
  refs.fileInput.value = "";
}
