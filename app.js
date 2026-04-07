const STORAGE_KEY = "eyawriter-projects-v5";
const TYPE_SEQUENCE = ["scene", "action", "character", "dialogue", "transition", "parenthetical", "shot", "text", "note", "dual", "image"];
const TYPE_LABELS = {
  scene: "Scene",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  transition: "Transition",
  parenthetical: "Parenthetical",
  shot: "Shot",
  text: "Text",
  note: "Note",
  dual: "Dual",
  image: "Image"
};
const AUTO_UPPERCASE_TYPES = new Set(["scene", "character", "shot", "transition", "dual"]);
const SCENE_TIMES = ["DAY", "NIGHT", "LATER", "DAWN", "DUSK", "MORNING", "EVENING", "CONT'D"];
const DEFAULT_SUGGESTIONS = {
  scene: ["INT. - DAY", "EXT. - DAY", "INT. - NIGHT", "EXT. - NIGHT", "INT./EXT. - DAY", "INT./EXT. - NIGHT"],
  transition: ["CUT TO:", "DISSOLVE TO:", "SMASH CUT TO:", "MATCH CUT TO:", "FADE OUT."],
  shot: ["CLOSE ON", "WIDE SHOT", "INSERT", "POV", "OVERHEAD SHOT"],
  parenthetical: ["beat", "quietly", "whispering", "under breath", "into phone"],
  note: ["NOTE: "],
  image: ["IMAGE: ", "INSERT IMAGE: "]
};
const DEFAULT_VIEW_OPTIONS = {
  ruler: false,
  pageNumbers: true,
  pageCount: true,
  showOutline: true,
  textSize: 12
};
const PAGE_UNIT_CAPACITY = 54;

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

const state = {
  projects: [],
  currentProjectId: null,
  activeBlockId: null,
  activeType: "action",
  visibleSuggestions: [],
  saveTimer: null,
  aiAssist: false,
  toolStripCollapsed: false,
  autoNumberScenes: false,
  theme: "rose",
  viewOptions: { ...DEFAULT_VIEW_OPTIONS },
  filterQuery: ""
};

const refs = {
  homeView: document.querySelector("#homeView"),
  studioView: document.querySelector("#studioView"),
  toolStrip: document.querySelector("#toolStrip"),
  studioLayout: document.querySelector("#studioLayout"),
  projectGrid: document.querySelector("#projectGrid"),
  newProjectBtn: document.querySelector("#newProjectBtn"),
  goHomeBtn: document.querySelector("#goHomeBtn"),
  saveBadge: document.querySelector("#saveBadge"),
  titleInput: document.querySelector("#titleInput"),
  authorInput: document.querySelector("#authorInput"),
  contactInput: document.querySelector("#contactInput"),
  companyInput: document.querySelector("#companyInput"),
  detailsInput: document.querySelector("#detailsInput"),
  loglineInput: document.querySelector("#loglineInput"),
  activeModeLabel: document.querySelector("#activeModeLabel"),
  suggestionTray: document.querySelector("#suggestionTray"),
  suggestionTitle: document.querySelector("#suggestionTitle"),
  suggestionList: document.querySelector("#suggestionList"),
  autoCapsToggle: document.querySelector("#autoCapsToggle"),
  autoNumberToggle: document.querySelector("#autoNumberToggle"),
  typewriterToggle: document.querySelector("#typewriterToggle"),
  aiAssistToggle: document.querySelector("#aiAssistToggle"),
  aiPanel: document.querySelector("#aiPanel"),
  aiSuggestBtn: document.querySelector("#aiSuggestBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  exportTxtBtn: document.querySelector("#exportTxtBtn"),
  exportJsonBtn: document.querySelector("#exportJsonBtn"),
  exportWordBtn: document.querySelector("#exportWordBtn"),
  exportPdfBtn: document.querySelector("#exportPdfBtn"),
  fileInput: document.querySelector("#fileInput"),
  helpBtn: document.querySelector("#helpBtn"),
  helpDialog: document.querySelector("#helpDialog"),
  leftPane: document.querySelector("#leftPane"),
  rightPane: document.querySelector("#rightPane"),
  leftPaneBody: document.querySelector("#leftPaneBody"),
  rightPaneBody: document.querySelector("#rightPaneBody"),
  leftRailToggle: document.querySelector("#leftRailToggle"),
  rightRailToggle: document.querySelector("#rightRailToggle"),
  toolStripToggle: document.querySelector("#toolStripToggle"),
  leftPaneSectionToggle: document.querySelector("#leftPaneSectionToggle"),
  rightPaneSectionToggle: document.querySelector("#rightPaneSectionToggle"),
  leftResize: document.querySelector("#leftResize"),
  rightResize: document.querySelector("#rightResize"),
  screenplayEditor: document.querySelector("#screenplayEditor"),
  coverPreview: document.querySelector("#coverPreview"),
  preview: document.querySelector("#preview"),
  sceneList: document.querySelector("#sceneList"),
  characterList: document.querySelector("#characterList"),
  sceneCount: document.querySelector("#sceneCount"),
  wordCount: document.querySelector("#wordCount"),
  pageCount: document.querySelector("#pageCount"),
  characterCount: document.querySelector("#characterCount"),
  noteCount: document.querySelector("#noteCount"),
  duplicateProjectBtn: document.querySelector("#duplicateProjectBtn"),
  loadSampleBtn: document.querySelector("#loadSampleBtn"),
  deleteProjectBtn: document.querySelector("#deleteProjectBtn"),
  homeRecentProjects: document.querySelector("#homeRecentProjects"),
  studioRecentProjects: document.querySelector("#studioRecentProjects"),
  menuTriggers: document.querySelectorAll("[data-menu-trigger]"),
  themeButtons: document.querySelectorAll("[data-theme-value]")
};

boot();

function boot() {
  loadProjects();
  bindEvents();
  showHome();
  renderHome();
  applyToolbarState();
  applyTheme();
  applyViewState();
}

function bindEvents() {
  refs.newProjectBtn.addEventListener("click", () => {
    const project = createProject();
    openProject(project.id);
  });

  refs.goHomeBtn.addEventListener("click", () => {
    persistProjects(true);
    showHome();
    renderHome();
  });

  [refs.titleInput, refs.authorInput, refs.contactInput, refs.companyInput, refs.detailsInput, refs.loglineInput]
    .forEach((input) => input.addEventListener("input", handleMetaInput));

  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => handleToolSelection(button.dataset.insert));
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
      handleToolSelection(button.dataset.formatType);
      closeMenus();
    });
  });

  document.querySelectorAll("[data-view-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleViewOption(button.dataset.viewToggle));
  });

  document.querySelectorAll("[data-text-size]").forEach((button) => {
    button.addEventListener("click", () => setTextSize(button.dataset.textSize));
  });

  refs.saveBtn.addEventListener("click", () => persistProjects(true));
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
    renderStudio();
    queueSave();
  });
  refs.typewriterToggle.addEventListener("change", () => {
    document.body.classList.toggle("typewriter-mode", refs.typewriterToggle.checked);
  });
  refs.autoNumberToggle.addEventListener("change", () => {
    state.autoNumberScenes = refs.autoNumberToggle.checked;
    renderPreview();
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

function loadProjects() {
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

function sanitizeProject(project) {
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

function cloneProject(project, withNewId) {
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

function createProject() {
  const project = sanitizeProject({
    id: uid("project"),
    title: `Script Name ${state.projects.length + 1}`,
    lines: [{ id: uid(), type: "action", text: "" }]
  });
  upsertProject(project);
  persistProjects(true);
  return project;
}

function getCurrentProject() {
  return state.projects.find((project) => project.id === state.currentProjectId) || null;
}

function getLine(id) {
  return getCurrentProject()?.lines.find((line) => line.id === id) || null;
}

function getLineIndex(id) {
  const project = getCurrentProject();
  return project ? project.lines.findIndex((line) => line.id === id) : -1;
}

function upsertProject(project) {
  const next = sanitizeProject(project);
  const index = state.projects.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    state.projects.splice(index, 1, next);
  } else {
    state.projects.unshift(next);
  }
}

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
  renderStudio();
  if (state.activeBlockId) {
    focusBlock(state.activeBlockId);
  }
}

function renderHome() {
  refs.projectGrid.innerHTML = "";
  const template = document.querySelector("#projectCardTemplate");
  const projects = [...state.projects].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  projects.forEach((project) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const openButton = node.querySelector(".project-card-open");
    const deleteButton = node.querySelector(".project-delete");
    const sceneCount = project.lines.filter((line) => line.type === "scene" && line.text.trim()).length;
    const characterCount = new Set(project.lines.filter((line) => line.type === "character" && line.text.trim()).map((line) => line.text.trim().toUpperCase())).size;

    node.querySelector(".project-card-title").textContent = project.title;
    node.querySelector(".project-scenes").textContent = `Scenes: ${sceneCount}`;
    node.querySelector(".project-characters").textContent = `Characters: ${characterCount}`;
    node.querySelector(".project-card-logline").textContent = project.logline || "Description automatically appears here as the script grows.";
    node.querySelector(".project-card-updated").textContent = `Last Modified: ${formatDateTime(project.updatedAt)}`;

    openButton.addEventListener("click", () => openProject(project.id));
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeProject(project.id);
    });

    refs.projectGrid.appendChild(node);
  });

  renderRecentProjectMenus();
}

function renderRecentProjectMenus() {
  const containers = [refs.homeRecentProjects, refs.studioRecentProjects].filter(Boolean);
  if (!containers.length) {
    return;
  }

  const projects = [...state.projects]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);

  containers.forEach((container) => {
    container.innerHTML = "";
    projects.forEach((project) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-menu-button recent-project-button";
      button.innerHTML = `<span>${escapeHtml(project.title)}</span><small>${escapeHtml(formatDateTime(project.updatedAt))}</small>`;
      button.addEventListener("click", () => {
        openProject(project.id);
        closeMenus();
      });
      container.appendChild(button);
    });
  });
}

function renderStudio() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  syncInputsFromProject(project);
  renderEditor();
  renderCoverPreview();
  renderPreview();
  renderSceneList();
  renderCharacterList();
  renderMetrics();
  updateActiveTool();
  updateSuggestions();
  applyViewState();
  renderRecentProjectMenus();
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
  renderCoverPreview();
  renderPreview();
  renderHome();
  queueSave();
}

function renderEditor() {
  const project = getCurrentProject();
  refs.screenplayEditor.innerHTML = "";
  const template = document.querySelector("#blockTemplate");
  const filterSet = buildVisibleFilterSet(project);
  let currentSceneId = "";
  let collapsedSceneId = "";
  let visibleRows = 0;

  project.lines.forEach((line) => {
    const row = template.content.firstElementChild.cloneNode(true);
    const toggle = row.querySelector(".scene-toggle");
    const tag = row.querySelector(".block-tag");
    const block = row.querySelector(".script-block");

    row.dataset.id = line.id;
    if (line.id === state.activeBlockId) {
      row.classList.add("is-active");
    }

    if (line.type === "scene") {
      currentSceneId = line.id;
      const isCollapsed = project.collapsedSceneIds.includes(line.id);
      collapsedSceneId = isCollapsed ? line.id : "";
      toggle.hidden = false;
      toggle.textContent = isCollapsed ? ">" : "v";
      toggle.title = isCollapsed ? "Expand scene" : "Collapse scene";
      toggle.setAttribute("aria-label", isCollapsed ? "Expand scene" : "Collapse scene");
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleSceneCollapse(line.id);
      });
    } else {
      toggle.hidden = true;
    }

    row.dataset.sceneOwner = currentSceneId;
    tag.textContent = TYPE_LABELS[line.type];
    block.dataset.id = line.id;
    block.dataset.type = line.type;
    block.textContent = line.text;

    const hiddenByScene = !filterSet && Boolean(collapsedSceneId && line.type !== "scene");
    const hiddenByFilter = Boolean(filterSet && !filterSet.has(line.id));
    row.classList.toggle("is-scene-hidden", hiddenByScene);
    row.classList.toggle("is-filtered-out", hiddenByFilter);

    if (!hiddenByScene && !hiddenByFilter) {
      visibleRows += 1;
    }

    block.addEventListener("focus", () => setActiveBlock(line.id));
    block.addEventListener("click", () => setActiveBlock(line.id));
    block.addEventListener("input", () => handleBlockInput(line.id, block));
    block.addEventListener("keydown", (event) => handleBlockKeydown(event, line.id));

    refs.screenplayEditor.appendChild(row);
  });

  if (!visibleRows && state.filterQuery.trim()) {
    refs.screenplayEditor.appendChild(createTextNode(`No lines match "${state.filterQuery}".`));
  }
}

function renderCoverPreview() {
  const project = syncProjectFromInputs() || getCurrentProject();
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\nby\n\n${escapeHtml(project.author || "Author")}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  refs.coverPreview.innerHTML = `
    <div class="cover-sheet">
      <pre class="cover-text">${coverText}</pre>
    </div>
  `;
}

function renderPreview() {
  const project = getCurrentProject();
  refs.preview.innerHTML = "";
  const previewData = buildPreviewData(project);

  const pages = document.createElement("div");
  pages.className = "preview-pages";

  const coverPage = document.createElement("section");
  coverPage.className = "preview-page-sheet cover";
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\nby\n\n${escapeHtml(project.author || "Author")}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  coverPage.innerHTML = `<pre class="preview-cover-text">${coverText}</pre>`;
  pages.appendChild(coverPage);

  previewData.scriptPages.forEach((pageLines, pageIndex) => {
    const scriptPage = document.createElement("section");
    scriptPage.className = "preview-page-sheet";

    if (pageIndex > 0) {
      const header = document.createElement("div");
      header.className = "preview-page-header";
      header.textContent = (pageIndex + 1) + ".";
      scriptPage.appendChild(header);
    }

    const body = document.createElement("div");
    body.className = "preview-page-body";

    pageLines.forEach((line) => {
      const node = document.createElement("p");
      node.className = `preview-line ${line.type}`;
      node.textContent = line.displayText;
      body.appendChild(node);
    });

    if (!pageLines.length) {
      body.appendChild(createTextNode("Your screenplay preview appears here."));
    }

    scriptPage.appendChild(body);
    pages.appendChild(scriptPage);
  });

  refs.preview.appendChild(pages);
}

function renderSceneList() {
  const project = getCurrentProject();
  const scenes = project.lines
    .map((line, index) => ({ ...line, index }))
    .filter((line) => line.type === "scene");

  refs.sceneList.innerHTML = "";
  refs.sceneCount.textContent = `${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"}`;

  if (!scenes.length) {
    refs.sceneList.appendChild(createTextNode("Scene headings will appear here."));
    return;
  }

  const template = document.querySelector("#listItemTemplate");
  scenes.forEach((scene, order) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".list-item-title").textContent = `${order + 1}. ${normalizeLineText(scene.text, "scene")}`;
    node.querySelector(".list-item-meta").textContent = getSceneFirstLine(project, scene.index);
    node.addEventListener("click", () => focusBlock(scene.id));
    refs.sceneList.appendChild(node);
  });
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
    scriptPages: paginateScriptLines(preparedLines)
  };
}

function paginateScriptLines(lines) {
  const pages = [];
  let currentPage = [];
  let usedUnits = 0;
  let currentSceneLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let spacing = 0;
    if (currentPage.length > 0) {
      const prevType = currentPage[currentPage.length - 1].type;
      if (line.type === "scene") spacing = 2;
      else if (line.type === "dialogue" || line.type === "parenthetical") {
        if (!["character", "parenthetical", "dialogue"].includes(prevType)) spacing = 1;
      } else if (line.type !== "blank") spacing = 1;
    }

    let lineUnits = estimateLineUnits(line.type, line.displayText);
    let needPageBreak = (usedUnits + spacing + lineUnits > PAGE_UNIT_CAPACITY);

    if (!needPageBreak && line.type === "character") {
      let lookaheadUnits = lineUnits;
      let dialogueLines = 0;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.type === "dialogue" || nextLine.type === "parenthetical") {
          lookaheadUnits += estimateLineUnits(nextLine.type, nextLine.displayText);
          if (nextLine.type === "dialogue") dialogueLines += Math.ceil(stripWrapperChars(nextLine.displayText).length / 35);
          if (dialogueLines >= 2) break;
        } else break;
      }
      if (usedUnits + spacing + lookaheadUnits > PAGE_UNIT_CAPACITY) needPageBreak = true;
    }

    if (needPageBreak && currentPage.length > 0) {
      const lastLine = currentPage[currentPage.length - 1];
      if (lastLine.type === "dialogue" || lastLine.type === "parenthetical") {
        currentPage.push({ type: "dialogue-more", displayText: "(MORE)" });
        pages.push(currentPage);
        const speaker = findLastSpeaker(lines, i);
        currentPage = [{ type: "character", displayText: speaker + " (CONT'D)" }];
        usedUnits = estimateLineUnits("character", speaker + " (CONT'D)");
        spacing = 0;
      } else {
        const lastWasScene = currentSceneLines.length > 0;
        if (lastWasScene) currentPage.push({ type: "continuity", displayText: "CONTINUED:" });
        pages.push(currentPage);
        currentPage = [];
        usedUnits = 0;
        spacing = 0;
        if (lastWasScene) {
          currentPage.push({ type: "continuity", displayText: "CONTINUED:" });
          usedUnits += 1;
        }
      }
    }

    if (spacing > 0) {
      for (let s = 0; s < spacing; s++) {
        currentPage.push({ type: "blank", displayText: "" });
      }
      usedUnits += spacing;
    }

    currentPage.push(line);
    usedUnits += lineUnits;
    if (line.type === "scene") currentSceneLines = [line];
    else if (line.type !== "blank") currentSceneLines.push(line);
  }

  if (currentPage.length) pages.push(currentPage);
  return pages;
}

function findLastSpeaker(lines, currentIndex) {
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (lines[i].type === "character") return stripWrapperChars(lines[i].displayText).replace(" (CONT'D)", "");
  }
  return "CHARACTER";
}

function estimateLineUnits(type, text) {
  if (type === "blank") return 1;
  const compact = stripWrapperChars(text);
  let width = 60;
  if (type === "dialogue") width = 35;
  else if (type === "parenthetical") width = 25;
  else if (type === "character" || type === "dual") width = 38;
  else if (type === "transition") width = 24;

  const wrappedLines = Math.max(1, Math.ceil(compact.length / width));
  return wrappedLines;
}

function buildPreviewFooterLabel(pageNumber, totalPages) {
  if (state.viewOptions.pageNumbers && state.viewOptions.pageCount) {
    return `Page ${pageNumber} of ${totalPages}`;
  }
  if (state.viewOptions.pageNumbers) {
    return `Page ${pageNumber}`;
  }
  if (state.viewOptions.pageCount) {
    return `${totalPages} pages`;
  }
  return "";
}

function getSceneFirstLine(project, sceneIndex) {
  for (let index = sceneIndex + 1; index < project.lines.length; index += 1) {
    const line = project.lines[index];
    if (line.type === "scene") {
      break;
    }
    const text = normalizeLineText(line.text, line.type);
    if (text) {
      return text;
    }
  }
  return "";
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
  renderEditor();
  focusBlock(sceneId);
  queueSave();
}

function renderCharacterList() {
  const project = getCurrentProject();
  const characters = new Map();

  project.lines.forEach((line, index) => {
    if (line.type !== "character" || !line.text.trim()) {
      return;
    }
    const key = normalizeLineText(line.text, "character");
    const current = characters.get(key) || { name: key, count: 0, firstId: line.id, firstIndex: index };
    current.count += 1;
    characters.set(key, current);
  });

  refs.characterList.innerHTML = "";
  if (!characters.size) {
    refs.characterList.appendChild(createTextNode("Characters will appear here."));
    return;
  }

  const template = document.querySelector("#listItemTemplate");
  [...characters.values()]
    .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)
    .forEach((character) => {
      const node = template.content.firstElementChild.cloneNode(true);
      node.querySelector(".list-item-title").textContent = character.name;
      node.querySelector(".list-item-meta").textContent = `${character.count} entries`;
      node.addEventListener("click", () => focusBlock(character.firstId));
      refs.characterList.appendChild(node);
    });
}

function renderMetrics() {
  const project = getCurrentProject();
  const words = serializeScript(project).match(/\b[\w'-]+\b/g) || [];
  const characters = new Set(project.lines.filter((line) => line.type === "character" && line.text.trim()).map((line) => normalizeLineText(line.text, "character")));
  const notes = project.lines.filter((line) => line.type === "note" && line.text.trim()).length;

  refs.wordCount.textContent = words.length.toLocaleString();
  refs.pageCount.textContent = Math.max(1, Math.round((words.length / 180) * 10) / 10).toFixed(1);
  refs.characterCount.textContent = characters.size.toString();
  refs.noteCount.textContent = notes.toString();
}

function handleBlockInput(id, element) {
  const line = getLine(id);
  const project = getCurrentProject();
  if (!line || !project) {
    return;
  }

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
    placeCaretAtEnd(element);
  }

  line.text = normalized;
  project.updatedAt = new Date().toISOString();
  setActiveBlock(id);
  renderPreview();
  renderSceneList();
  renderCharacterList();
  renderMetrics();
  renderHome();
  updateSuggestions();
  queueSave();
}

function handleBlockKeydown(event, id) {
  const project = getCurrentProject();
  const index = getLineIndex(id);
  const line = project?.lines[index];
  if (!line) {
    return;
  }

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
    const newId = addBlock(nextType, getDefaultText(nextType, index), index + 1);
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

function handleToolSelection(type) {
  const active = getLine(state.activeBlockId);
  if (!active) {
    const newId = addBlock(type, getDefaultText(type, -1));
    renderStudio();
    focusBlock(newId, true);
    queueSave();
    return;
  }
  changeBlockType(active.id, type);
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

function setActiveBlock(id) {
  state.activeBlockId = id;
  state.activeType = getLine(id)?.type || "action";
  refs.screenplayEditor.querySelectorAll(".script-block-row").forEach((row) => {
    row.classList.toggle("is-active", row.dataset.id === id);
  });
  updateActiveTool();
  updateSuggestions();
}

function updateActiveTool() {
  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.insert === state.activeType);
  });
  refs.activeModeLabel.textContent = ">";
  refs.activeModeLabel.title = `Active block: ${TYPE_LABELS[state.activeType] || "Action"}`;
}

function cycleBlockType(id) {
  const line = getLine(id);
  if (!line) {
    return;
  }
  const index = TYPE_SEQUENCE.indexOf(line.type);
  changeBlockType(id, TYPE_SEQUENCE[(index + 1) % TYPE_SEQUENCE.length]);
}

function changeBlockType(id, nextType) {
  const line = getLine(id);
  const project = getCurrentProject();
  if (!line || !project) {
    return;
  }

  line.type = nextType;
  line.text = normalizeConvertedText(line.text, nextType);
  project.updatedAt = new Date().toISOString();
  state.activeType = nextType;
  renderStudio();
  focusBlock(id, !line.text);
  queueSave();
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

function getDefaultText(type, contextIndex) {
  if (type === "character") {
    return getSuggestedNextSpeaker(contextIndex);
  }
  return "";
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

function updateSuggestions() {
  const line = getLine(state.activeBlockId);
  const type = line?.type || state.activeType;
  const suggestions = buildSuggestions(type, line?.text || "");
  state.visibleSuggestions = suggestions.slice(0, 9);
  refs.suggestionList.innerHTML = "";

  if (!state.visibleSuggestions.length) {
    refs.suggestionTray.hidden = true;
    return;
  }

  refs.suggestionTray.hidden = false;
  refs.suggestionTitle.textContent = `${TYPE_LABELS[type]} suggestions`;

  state.visibleSuggestions.forEach((suggestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-pill";
    button.textContent = `${index + 1}. ${suggestion.label}`;
    button.addEventListener("click", () => applySuggestion(suggestion.value));
    refs.suggestionList.appendChild(button);
  });
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

function applySuggestion(value) {
  const line = getLine(state.activeBlockId);
  const project = getCurrentProject();
  if (!line || !project) {
    return;
  }
  line.text = normalizeLineText(value, line.type);
  project.updatedAt = new Date().toISOString();
  renderStudio();
  focusBlock(line.id, true);
  queueSave();
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
    persistProjects(true);
    return;
  }

  if (state.visibleSuggestions.length && /^[1-9]$/.test(event.key)) {
    const choice = state.visibleSuggestions[Number(event.key) - 1];
    if (choice) {
      event.preventDefault();
      applySuggestion(choice.value);
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
      handleToolSelection(map[key]);
    }
  }

  if (event.key === "Escape") {
    closeMenus();
  }
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
      printProject();
      break;
    case "exit-studio":
      persistProjects(true);
      showHome();
      renderHome();
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
      handleToolSelection("image");
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
  renderStudio();
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
  renderStudio();
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
  renderStudio();
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
  renderStudio();
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
  renderStudio();
}

function toggleViewOption(optionKey) {
  if (!(optionKey in state.viewOptions)) {
    return;
  }
  state.viewOptions[optionKey] = !state.viewOptions[optionKey];
  applyViewState();
  renderPreview();
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

function stripWrapperChars(value) {
  return value.replace(/^\[(.*)\]$/s, "$1").replace(/^\((.*)\)$/s, "$1").trim();
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

function persistProjects(forceSavedBadge = false) {
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
  refs.saveBadge.textContent = forceSavedBadge ? "Saved locally" : "Saved";
  renderHome();
}

function queueSave() {
  refs.saveBadge.textContent = "Saving...";
  clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => persistProjects(false), 200);
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
  ${autoPrint ? "<script>window.addEventListener('load', function () { window.print(); });<\/script>" : ""}
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

function parseTextToLines(text) {
  const rawLines = text.replace(/\r\n/g, "\n").split(/\n{1,2}/).map((line) => line.trim()).filter(Boolean);
  return rawLines.map((line, index) => ({
    id: uid(),
    type: inferTypeFromText(line, rawLines[index - 1] || "", rawLines[index + 1] || ""),
    text: line
  }));
}

function inferTypeFromText(line, prevLine, nextLine) {
  if (/^(INT\.|EXT\.|INT\/EXT\.|INT\.\/EXT\.|EST\.)/i.test(line)) return "scene";
  if (/^(CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|FADE OUT\.)/i.test(line)) return "transition";
  if (/^\(.*\)$/.test(line)) return "parenthetical";
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
  const separated = !prevLine || /^(INT\.|EXT\.|\[|CUT TO:|FADE OUT\.)/i.test(prevLine);
  return isUppercase && (followedByDialogue || separated);
}

function duplicateProject() {
  const current = getCurrentProject();
  const copy = cloneProject({ ...current, title: `${current.title} Copy` }, true);
  upsertProject(copy);
  openProject(copy.id);
  persistProjects(true);
}

function replaceWithSample() {
  const current = getCurrentProject();
  const replacement = cloneProject(sampleProject, false);
  replacement.id = current.id;
  replacement.createdAt = current.createdAt;
  upsertProject(replacement);
  openProject(replacement.id);
  persistProjects(true);
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
    });
    state.projects = [replacement];
  }
  state.currentProjectId = state.projects[0].id;
  persistProjects(true);
  showHome();
  renderHome();
}

function insertAiAssistNote() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const index = getLineIndex(state.activeBlockId);
  const prompt = "AI ASSIST: Suggest the next beat, sharpen the scene objective, and keep the current voice.";
  const newId = addBlock("note", prompt, index + 1);
  renderStudio();
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
  persistProjects(false);
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
  persistProjects(false);
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
      persistProjects(false);
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
      renderStudio();
    }
  }

  const ownerSceneId = getOwningSceneId(id);
  const project = getCurrentProject();
  if (ownerSceneId && ownerSceneId !== id && project?.collapsedSceneIds.includes(ownerSceneId)) {
    project.collapsedSceneIds = project.collapsedSceneIds.filter((sceneId) => sceneId !== ownerSceneId);
    renderStudio();
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

function createTextNode(message) {
  const node = document.createElement("p");
  node.textContent = message;
  node.style.margin = "0";
  node.style.color = "#7a7a74";
  return node;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function slugify(value) {
  return (value || "eyawriter-script").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "eyawriter-script";
}

function sanitizeViewOptions(options) {
  return {
    ruler: Boolean(options?.ruler),
    pageNumbers: options?.pageNumbers === undefined ? true : Boolean(options.pageNumbers),
    pageCount: options?.pageCount === undefined ? true : Boolean(options.pageCount),
    showOutline: options?.showOutline === undefined ? true : Boolean(options.showOutline),
    textSize: clamp(options?.textSize ?? DEFAULT_VIEW_OPTIONS.textSize, 11, 14)
  };
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function uid(prefix = "line") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function placeCaretAtEnd(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectElementText(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectTextSuffix(element, startOffset, endOffset) {
  const selection = window.getSelection();
  const range = document.createRange();
  const textNode = element.firstChild;
  if (!textNode) {
    return;
  }
  range.setStart(textNode, clamp(startOffset, 0, textNode.length));
  range.setEnd(textNode, clamp(endOffset, 0, textNode.length));
  selection.removeAllRanges();
  selection.addRange(range);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
