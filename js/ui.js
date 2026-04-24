import { state, TYPE_LABELS, LEFT_PANE_BLOCK_DEFS } from './config.js';
import { refs } from './dom.js';
import { getSceneIdForIndex } from './editor.js';
import { getCurrentProject, persistProjects, serializeScript } from './project.js';
import { escapeHtml, formatDateTime, normalizeLineText, formatLineText, createTextNode } from './utils.js';
import { updateBackground } from './background.js';

const MENU_GLYPHS = {
  left: "&#9664;",
  right: "&#9654;",
  up: "&#9650;",
  down: "&#9660;"
};

export function showAuth() {
  refs.homeView.hidden = true;
  refs.studioView.hidden = true;
  refs.authView.hidden = false;
}

export function showHome() {
  refs.authView.hidden = true;
  refs.homeView.hidden = false;
  refs.studioView.hidden = true;
}

export function showStudio() {
  refs.homeView.hidden = true;
  refs.studioView.hidden = false;
}

export function renderHome() {
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
    node.querySelector(".project-card-updated").textContent = `Modified: ${formatDateTime(project.updatedAt)}`;

    // Note: Event listeners will be bound in events.js, but we need the IDs here
    node.dataset.projectId = project.id;
    node.querySelector(".project-card-open").dataset.projectId = project.id;

    refs.projectGrid.appendChild(node);
  });

  renderRecentProjectMenus();
}

export function renderRecentProjectMenus() {
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
      button.dataset.projectId = project.id;
      button.innerHTML = `<span>${escapeHtml(project.title)}</span><small>${escapeHtml(formatDateTime(project.updatedAt))}</small>`;
      container.appendChild(button);
    });
  });
}

export function renderSceneList() {
  const project = getCurrentProject();
  if (!project) return;
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
    node.querySelector(".list-item-title").textContent = `${order + 1}. ${formatLineText(scene.text, "scene")}`;
    node.querySelector(".list-item-meta").textContent = getSceneFirstLine(project, scene.index);
    node.dataset.lineId = scene.id;
    refs.sceneList.appendChild(node);
  });
}

export function getSceneFirstLine(project, sceneIndex) {
  for (let index = sceneIndex + 1; index < project.lines.length; index += 1) {
    const line = project.lines[index];
    if (line.type === "scene") break;

    const text = formatLineText(line.text, line.type);
    if (!text) continue;

    if (line.type === "character" || line.type === "dual") {
      // Find the first dialogue line for this character to give a better preview
      for (let j = index + 1; j < Math.min(index + 4, project.lines.length); j++) {
        const nextLine = project.lines[j];
        if (nextLine.type === "scene") break;
        if (nextLine.type === "dialogue" && nextLine.text.trim()) {
          return `${text}: "${formatLineText(nextLine.text, "dialogue")}"`;
        }
      }
    }
    return text;
  }
  return "";
}

export function renderCharacterList() {
  const project = getCurrentProject();
  if (!project) return;
  const characters = new Map();

  project.lines.forEach((line, index) => {
    if ((line.type !== "character" && line.type !== "dual") || !line.text.trim()) {
      return;
    }
    const name = formatLineText(line.text, line.type);
    const key = name.trim().toUpperCase();
    const current = characters.get(key) || { name: name.trim(), count: 0, firstId: line.id, firstIndex: index };
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
      node.dataset.lineId = character.firstId;
      node.dataset.characterName = character.name;
      refs.characterList.appendChild(node);
    });
}

export function showCharacterScenes(characterName, onSelect) {
  const project = getCurrentProject();
  if (!project) return;

  const sceneIds = new Set();
  const targetName = characterName.trim().toUpperCase();
  project.lines.forEach((line, index) => {
    if ((line.type === "character" || line.type === "dual") && normalizeLineText(line.text, line.type).trim().toUpperCase() === targetName) {
      const sceneId = getSceneIdForIndex(index, project);
      if (sceneId) {
        sceneIds.add(sceneId);
      }
    }
  });

  if (sceneIds.size === 0) {
    customAlert(`${characterName} doesn't have any dialogue scenes yet.`, "No scenes found");
    return;
  }

  const container = document.createElement("div");
  container.className = "modal-list";

  const lineIdToIndex = new Map(project.lines.map((l, i) => [l.id, i]));
  const sortedSceneIds = [...sceneIds].sort((a, b) => {
    return (lineIdToIndex.get(a) ?? 0) - (lineIdToIndex.get(b) ?? 0);
  });

  sortedSceneIds.forEach((sceneId) => {
    const sceneLine = project.lines.find(l => l.id === sceneId);
    if (!sceneLine) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "modal-list-item";

    const sceneIndex = project.lines.findIndex(l => l.id === sceneId);
    const sceneNumber = project.lines.slice(0, sceneIndex + 1).filter(l => l.type === 'scene').length;
    const heading = formatLineText(sceneLine.text, "scene");
    const displayHeading = state.autoNumberScenes ? `${sceneNumber}. ${heading}` : heading;

    const subtext = getSceneFirstLine(project, sceneIndex);
    btn.innerHTML = `<strong>${escapeHtml(displayHeading)}</strong><small>${escapeHtml(subtext)}</small>`;
    btn.onclick = () => {
      onSelect(sceneId);
      modalRefs.dialog.close();
    };
    container.appendChild(btn);
  });

  showModal({
    title: `Scenes featuring ${characterName}`,
    message: container,
    showCancel: true,
    cancelLabel: "Close",
    showConfirm: false
  });
}

export function syncInputsFromProject(project) {
  refs.titleInput.value = project.title;
  refs.authorInput.value = project.author;
  refs.contactInput.value = project.contact;
  refs.companyInput.value = project.company;
  refs.detailsInput.value = project.details;
  refs.loglineInput.value = project.logline;
}

function getLeftPaneBlockMeta(key) {
  return LEFT_PANE_BLOCK_DEFS.find((block) => block.key === key) || null;
}

function positionMenuUnderTrigger(menu, trigger) {
  if (!menu || !trigger || window.innerWidth <= 900) {
    return;
  }

  const container = trigger.closest(".nav-stack") || menu.offsetParent || document.body;
  const containerRect = container.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const maxLeft = Math.max(0, containerRect.width - menuRect.width);
  const alignedLeft = triggerRect.left - containerRect.left;

  menu.style.left = `${Math.min(Math.max(alignedLeft, 0), maxLeft)}px`;
}

function getLeftPaneBlockState(key) {
  return state.leftPaneBlocks.find((block) => block.key === key) || null;
}

export function renderLeftPaneBlockControls() {
  if (!refs.leftPaneBlockControls) {
    return;
  }

  refs.leftPaneBlockControls.innerHTML = "";
  state.leftPaneBlocks.forEach((block, index) => {
    const meta = getLeftPaneBlockMeta(block.key);
    if (!meta) {
      return;
    }

    const row = document.createElement("div");
    row.className = "block-customizer-item";
    const labelMarkup = block.key === "current"
      ? `<span class="block-customizer-label is-fixed"><span>${escapeHtml(meta.label)}</span></span>`
      : `<label class="block-customizer-label">
          <input type="checkbox" data-left-pane-visibility="${escapeHtml(block.key)}" ${block.visible ? "checked" : ""}>
          <span>${escapeHtml(meta.label)}</span>
        </label>`;
    row.innerHTML = `
      ${labelMarkup}
      <div class="block-customizer-actions">
        <button class="block-customizer-move" type="button" aria-label="Move ${escapeHtml(meta.label)} up" data-left-pane-move="up" data-left-pane-key="${escapeHtml(block.key)}" ${index === 0 ? "disabled" : ""}>${MENU_GLYPHS.up}</button>
        <button class="block-customizer-move" type="button" aria-label="Move ${escapeHtml(meta.label)} down" data-left-pane-move="down" data-left-pane-key="${escapeHtml(block.key)}" ${index === state.leftPaneBlocks.length - 1 ? "disabled" : ""}>${MENU_GLYPHS.down}</button>
      </div>
    `;
    refs.leftPaneBlockControls.appendChild(row);
  });
}

export function renderLeftPaneLayout() {
  if (!refs.leftPaneBody) {
    return;
  }

  const sections = new Map(
    Array.from(refs.leftPaneBody.querySelectorAll("[data-left-pane-block]"))
      .map((section) => [section.dataset.leftPaneBlock, section])
  );
  let visibleCount = 0;

  state.leftPaneBlocks.forEach((block, index) => {
    const section = sections.get(block.key);
    if (!section) {
      return;
    }

    const label = section.dataset.leftPaneLabel || getLeftPaneBlockMeta(block.key)?.label || block.key;
    section.style.order = String(index + 1);
    section.hidden = !block.visible;
    if (block.visible) {
      visibleCount += 1;
    }

    const body = section.querySelector(".panel-section-body");
    if (body) {
      body.hidden = block.collapsed;
    }

    const toggle = section.querySelector("[data-left-pane-section-toggle]");
    if (toggle) {
      toggle.innerHTML = block.collapsed ? MENU_GLYPHS.right : MENU_GLYPHS.down;
      toggle.setAttribute("aria-expanded", String(!block.collapsed));
      toggle.setAttribute("aria-label", `${block.collapsed ? "Expand" : "Collapse"} ${label}`);
    }
  });

  if (refs.leftPaneEmptyState) {
    refs.leftPaneEmptyState.hidden = visibleCount > 0;
  }

  renderLeftPaneBlockControls();
}

export function toggleLeftPaneSection(key) {
  const block = getLeftPaneBlockState(key);
  if (!block) {
    return;
  }

  block.collapsed = !block.collapsed;
  renderLeftPaneLayout();
  persistProjects(false);
}

export function setLeftPaneBlockVisibility(key, visible) {
  if (key === "current") {
    return;
  }

  const block = getLeftPaneBlockState(key);
  if (!block) {
    return;
  }

  block.visible = visible;
  if (visible) {
    block.collapsed = false;
  }
  renderLeftPaneLayout();
  persistProjects(false);
}

export function moveLeftPaneBlock(key, direction) {
  const index = state.leftPaneBlocks.findIndex((block) => block.key === key);
  if (index < 0) {
    return;
  }

  const nextIndex = direction === "up"
    ? Math.max(0, index - 1)
    : Math.min(state.leftPaneBlocks.length - 1, index + 1);

  if (nextIndex === index) {
    return;
  }

  const [block] = state.leftPaneBlocks.splice(index, 1);
  state.leftPaneBlocks.splice(nextIndex, 0, block);
  renderLeftPaneLayout();
  persistProjects(false);
}

export function updateMenuStateButtons() {
  document.querySelectorAll("[data-view-toggle]").forEach((button) => {
    button.classList.toggle("is-active", Boolean(state.viewOptions[button.dataset.viewToggle]));
  });

  document.querySelectorAll("[data-text-size]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.textSize) === state.viewOptions.textSize);
  });

  document.querySelectorAll("[data-menu-action='toggle-ai-assistant']").forEach((button) => {
    button.classList.toggle("is-active", state.aiAssist);
  });

  document.querySelectorAll("[data-menu-action='toggle-spelling-check']").forEach((button) => {
    button.classList.toggle("is-active", state.spellingCheck);
  });

  document.querySelectorAll("[data-menu-action='toggle-auto-number']").forEach((button) => {
    button.classList.toggle("is-active", Boolean(refs.autoNumberToggle?.checked));
  });

  document.querySelectorAll("[data-menu-action='toggle-typewriter-focus']").forEach((button) => {
    button.classList.toggle("is-active", Boolean(refs.typewriterToggle?.checked));
  });

  document.querySelectorAll("[data-menu-action='filter']").forEach((button) => {
    button.classList.toggle("is-active", Boolean(state.filterQuery));
  });
}

export function applyViewState() {
  document.body.classList.remove("show-ruler");
  document.body.classList.remove("outline-hidden");
  document.documentElement.style.setProperty("--script-font-size", `${state.viewOptions.textSize}pt`);
  refs.toolStripToggle.innerHTML = state.toolStripCollapsed ? MENU_GLYPHS.down : MENU_GLYPHS.up;
  updateMenuStateButtons();
}

export function setTheme(theme) {
  state.theme = theme === "rose" ? "cedar" : theme;
  applyTheme();
  closeMenus();
  persistProjects(false);
}

export function applyTheme() {
  document.documentElement.dataset.theme = state.theme === "rose" ? "cedar" : state.theme;
  refs.themeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.themeValue === (state.theme === "rose" ? "cedar" : state.theme));
  });
  updateBackground();
}

export function applyToolbarState() {
  document.body.classList.toggle("ai-assist-active", state.aiAssist);
  document.body.classList.toggle("spelling-mode-active", state.spellingCheck);
  refs.toolStrip.classList.toggle("is-collapsed", state.toolStripCollapsed);
  refs.toolStripToggle.innerHTML = state.toolStripCollapsed ? MENU_GLYPHS.down : MENU_GLYPHS.up;
  updateMenuStateButtons();
}

export function renderMetrics() {
  const project = getCurrentProject();
  if (!project) return;
  const words = serializeScript(project).match(/\b[\w'-]+\b/g) || [];
  const characters = new Set(project.lines.filter((line) => line.type === "character" && line.text.trim()).map((line) => line.text.trim().toUpperCase()));
  const notes = project.lines.filter((line) => line.type === "note" && line.text.trim()).length;

  refs.wordCount.textContent = words.length.toLocaleString();
  refs.pageCount.textContent = Math.max(1, Math.round((words.length / 180) * 10) / 10).toFixed(1);
  refs.characterCount.textContent = characters.size.toString();
  refs.noteCount.textContent = notes.toString();
}

export function closeMenus() {
  document.querySelectorAll(".nav-menu").forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll("[data-menu-trigger]").forEach((button) => {
    button.classList.remove("is-open");
  });
}

export function toggleMenu(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) {
    return;
  }
  const trigger = document.querySelector(`[data-menu-trigger="${menuId}"]`);
  const willOpen = menu.hidden;
  closeMenus();
  menu.hidden = !willOpen;
  trigger?.classList.toggle("is-open", willOpen);
  if (willOpen) {
    positionMenuUnderTrigger(menu, trigger);
  }
}

export async function showProofreadReport() {
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

  await customAlert(issues.length ? `Proofread highlights:\n- ${issues.join("\n- ")}` : "No obvious screenplay-format issues were found in the current draft.", "Proofread Report");
}

export async function showWorkTracking() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const scenes = project.lines.filter((line) => line.type === "scene" && line.text.trim()).length;
  const words = (serializeScript(project).match(/\b[\w'-]+\b/g) || []).length;
  await customAlert([
    `Project: ${project.title}`,
    `Created: ${formatDateTime(project.createdAt)}`,
    `Last updated: ${formatDateTime(project.updatedAt)}`,
    `Scenes: ${scenes}`,
    `Words: ${words.toLocaleString()}`
  ].join("\n"), "Work Tracking");
}

export function revealMetricsPanel() {
  const metricsBlock = getLeftPaneBlockState("metrics");
  if (metricsBlock) {
    metricsBlock.visible = true;
    metricsBlock.collapsed = false;
    renderLeftPaneLayout();
    persistProjects(false);
  }

  if (refs.leftPane.classList.contains("is-hidden")) {
    // This needs togglePane from events.js, but ui.js shouldn't depend on events.js
    // We can just manipulate the classes directly here or emit an event.
    refs.leftPane.classList.remove("is-hidden");
    refs.leftRailToggle.innerHTML = MENU_GLYPHS.left;
    refs.studioLayout.classList.remove("left-pane-hidden");
    if (refs.leftResize) refs.leftResize.classList.remove("is-hidden");
  }
  if (refs.leftPaneBody.classList.contains("is-collapsed")) {
      refs.leftPaneBody.classList.remove("is-collapsed");
      refs.leftPaneSectionToggle.innerHTML = MENU_GLYPHS.up;
  }
  refs.leftPaneSectionToggle.innerHTML = refs.leftPaneBody.classList.contains("is-collapsed") ? MENU_GLYPHS.down : MENU_GLYPHS.up;
  document.querySelector('[data-left-pane-block="metrics"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/**
 * Custom modern modal system
 */
const modalRefs = {
    get dialog() { return document.querySelector("#customModal"); },
    get title() { return document.querySelector("#modalTitle"); },
    get message() { return document.querySelector("#modalMessage"); },
    get inputContainer() { return document.querySelector("#modalInputContainer"); },
    get input() { return document.querySelector("#modalInput"); },
    get cancelBtn() { return document.querySelector("#modalCancelBtn"); },
    get confirmBtn() { return document.querySelector("#modalConfirmBtn"); }
};

function showModal({ title, message, showInput = false, defaultValue = "", confirmLabel = "OK", cancelLabel = "Cancel", showCancel = true, showConfirm = true }) {
    return new Promise((resolve) => {
        modalRefs.title.textContent = title;
        if (message instanceof HTMLElement) {
            modalRefs.message.textContent = "";
            modalRefs.message.appendChild(message);
        } else {
            modalRefs.message.textContent = message;
        }
        modalRefs.inputContainer.hidden = !showInput;
        modalRefs.input.value = defaultValue;
        modalRefs.confirmBtn.textContent = confirmLabel;
        modalRefs.confirmBtn.hidden = !showConfirm;
        modalRefs.cancelBtn.textContent = cancelLabel;
        modalRefs.cancelBtn.hidden = !showCancel;

        const cleanup = () => {
            modalRefs.confirmBtn.removeEventListener("click", onConfirm);
            modalRefs.cancelBtn.removeEventListener("click", onCancel);
            modalRefs.dialog.removeEventListener("close", onCancel);
        };

        const onConfirm = () => {
            cleanup();
            const value = showInput ? modalRefs.input.value : true;
            modalRefs.dialog.close();
            resolve(value);
        };

        const onCancel = () => {
            cleanup();
            modalRefs.dialog.close();
            resolve(showInput ? null : false);
        };

        modalRefs.confirmBtn.addEventListener("click", onConfirm);
        modalRefs.cancelBtn.addEventListener("click", onCancel);
        modalRefs.dialog.addEventListener("close", onCancel, { once: true });

        modalRefs.dialog.showModal();
        if (showInput) {
            modalRefs.input.focus();
            modalRefs.input.select();
        }
    });
}

export async function customAlert(message, title = "Alert") {
    return showModal({ title, message, showCancel: false });
}

export async function customConfirm(message, title = "Confirm") {
    return showModal({ title, message });
}

export async function customPrompt(message, defaultValue = "", title = "Prompt") {
    return showModal({ title, message, showInput: true, defaultValue });
}