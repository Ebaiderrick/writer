import { state } from './state.js';
import { TYPE_LABELS } from './constants.js';
import { escapeHtml, formatDateTime, createTextNode } from './utils.js';

export function renderHome(refs, openProject, removeProject, renderRecentProjectMenus) {
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

  renderRecentProjectMenus(refs, openProject);
}

export function renderRecentProjectMenus(refs, openProject, closeMenus) {
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
        if (closeMenus) closeMenus();
      });
      container.appendChild(button);
    });
  });
}

export function renderStudio(refs, syncInputsFromProject, renderEditor, renderCoverPreview, renderPreview, renderSceneList, renderCharacterList, renderMetrics, updateActiveTool, updateSuggestions, applyViewState, renderRecentProjectMenus, openProject) {
  const project = state.projects.find((p) => p.id === state.currentProjectId);
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
  renderRecentProjectMenus(refs, openProject);
}

export function renderEditor(refs, getCurrentProject, buildVisibleFilterSet, toggleSceneCollapse, setActiveBlock, handleBlockInput, handleBlockKeydown) {
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

export function renderCoverPreview(refs, syncProjectFromInputs, getCurrentProject) {
  const project = syncProjectFromInputs() || getCurrentProject();
  const coverText = `\n\n\n\n\n\n\n\n\n\n${escapeHtml(project.title)}\n\n\nby\n\n${escapeHtml(project.author || "Author")}\n\n\n${escapeHtml(project.contact || "")}\n${escapeHtml(project.company || "")}\n${escapeHtml(project.details || "")}\n\n${escapeHtml(project.logline || "")}`;
  refs.coverPreview.innerHTML = `
    <div class="cover-sheet">
      <pre class="cover-text">${coverText}</pre>
    </div>
  `;
}

export function renderPreview(refs, getCurrentProject, buildPreviewData) {
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

export function renderSceneList(refs, getCurrentProject, normalizeLineText, getSceneFirstLine, focusBlock) {
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

export function renderCharacterList(refs, getCurrentProject, normalizeLineText, focusBlock) {
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

export function renderMetrics(refs, getCurrentProject, serializeScript, normalizeLineText) {
  const project = getCurrentProject();
  const words = serializeScript(project).match(/\b[\w'-]+\b/g) || [];
  const characters = new Set(project.lines.filter((line) => line.type === "character" && line.text.trim()).map((line) => normalizeLineText(line.text, "character")));
  const notes = project.lines.filter((line) => line.type === "note" && line.text.trim()).length;

  refs.wordCount.textContent = words.length.toLocaleString();
  refs.pageCount.textContent = Math.max(1, Math.round((words.length / 180) * 10) / 10).toFixed(1);
  refs.characterCount.textContent = characters.size.toString();
  refs.noteCount.textContent = notes.toString();
}
