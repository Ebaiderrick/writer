import { state, LEFT_PANE_BLOCK_DEFS } from './config.js';
import { refs } from './dom.js';
import { getSceneIdForIndex } from './editor.js';
import { getCurrentProject, persistProjects, serializeScript } from './project.js';
import { escapeHtml, formatDateTime, normalizeLineText, formatLineText, createTextNode } from './utils.js';
import { updateBackground, setBackgroundAnimationEnabled } from './background.js';
import { applyTranslations, t } from './i18n.js';
import { calculateAnalytics } from './analytics.js';
import { auth } from './firebase.js';

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
  // Populate user info in home topbar
  try {
    const session = JSON.parse(localStorage.getItem('eyawriter_session') || 'null');
    if (session?.loggedIn && refs.homeUserName && refs.homeUserEmail) {
      refs.homeUserName.textContent = session.name || '';
      refs.homeUserEmail.textContent = session.isDemoSession ? 'Demo mode' : (session.email || '');
    }
  } catch { /* ignore */ }

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
    node.querySelector(".project-script-id").textContent = project.scriptId;
    node.querySelector(".project-scenes").textContent = t("project.scenes", { count: sceneCount });
    node.querySelector(".project-characters").textContent = t("project.characters", { count: characterCount });
    node.querySelector(".project-card-logline").textContent = project.logline || t("project.descriptionFallback");
    node.querySelector(".project-card-updated").textContent = t("project.modified", { value: formatDateTime(project.updatedAt) });

    // Note: Event listeners will be bound in events.js, but we need the IDs here
    node.dataset.projectId = project.id;
    node.querySelector(".project-card-open").dataset.projectId = project.id;

    refs.projectGrid.appendChild(node);
  });

  renderRecentProjectMenus();
  applyTranslations();
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
    container.dataset.emptyLabel = t("recent.empty");
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
  refs.sceneCount.textContent = scenes.length === 1
    ? t("scene.countOne", { count: scenes.length })
    : t("scene.countOther", { count: scenes.length });

  if (!scenes.length) {
    refs.sceneList.appendChild(createTextNode(t("scene.empty")));
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
    refs.characterList.appendChild(createTextNode(t("character.empty")));
    return;
  }

  const template = document.querySelector("#listItemTemplate");
  [...characters.values()]
    .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)
      .forEach((character) => {
        const node = template.content.firstElementChild.cloneNode(true);
        node.querySelector(".list-item-title").textContent = character.name;
        node.querySelector(".list-item-meta").textContent = t("character.entries", { count: character.count });
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
    customAlert(t("character.noScenesBody", { name: characterName }), t("character.noScenesTitle"));
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
    title: t("character.scenesFeaturing", { name: characterName }),
    message: container,
    showCancel: true,
    cancelLabel: t("help.close"),
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

function getLeftPaneBlockLabel(key) {
  const meta = getLeftPaneBlockMeta(key);
  const translationKeys = {
    current: "pane.currentScript",
    workspace: "Team Workspace",
    tools: "pane.projectTools",
    scenes: "pane.scenes",
    characters: "pane.characters",
    metrics: "pane.metrics",
    "story-memory": "Story Memory",
    analytics: "Writing Analytics",
    notepad: "Notepad",
    "ai-assistant": "AI Assistant",
    "smart-proofread": "Smart Proofread",
    "work-tracking": "Work Tracking",
    proofread: "Style Proofread"
  };

  return t(translationKeys[key] || "") || meta?.label || key;
}

function getCustomizerGroupLabel(key) {
  if (key === "current") return "Core";
  if (["workspace", "comments"].includes(key)) return "Workspace";
  if (["notepad"].includes(key)) return "Tools";
  if (["scenes", "characters"].includes(key)) return "Writing";
  if (["ai-assistant", "story-memory", "smart-proofread"].includes(key)) return "AI";
  if (["metrics", "work-tracking", "proofread", "analytics"].includes(key)) return "Revision & Insight";
  return "Editor";
}

function buildCustomizerRowsMarkup() {
  const groups = new Map();
  state.leftPaneBlocks.forEach((block, index) => {
    const meta = getLeftPaneBlockMeta(block.key);
    if (!meta) {
      return;
    }

    const group = getCustomizerGroupLabel(block.key);
    const rows = groups.get(group) || [];
    const label = getLeftPaneBlockLabel(block.key);
    const toggleMarkup = block.key === "current"
      ? `<span class="block-customizer-label is-fixed"><span>${escapeHtml(label)}</span></span>`
      : `<label class="block-customizer-label">
          <input type="checkbox" data-left-pane-visibility="${escapeHtml(block.key)}" ${block.visible ? "checked" : ""}>
          <span>${escapeHtml(label)}</span>
        </label>`;

    rows.push(`
      <div class="block-customizer-item">
        ${toggleMarkup}
        <div class="block-customizer-actions">
          <button class="block-customizer-move" type="button" aria-label="Move ${escapeHtml(label)} up" data-left-pane-move="up" data-left-pane-key="${escapeHtml(block.key)}" ${index === 0 ? "disabled" : ""}>${MENU_GLYPHS.up}</button>
          <button class="block-customizer-move" type="button" aria-label="Move ${escapeHtml(label)} down" data-left-pane-move="down" data-left-pane-key="${escapeHtml(block.key)}" ${index === state.leftPaneBlocks.length - 1 ? "disabled" : ""}>${MENU_GLYPHS.down}</button>
        </div>
      </div>
    `);
    groups.set(group, rows);
  });

  return [...groups.entries()].map(([group, rows]) => `
    <section class="block-customizer-group">
      <div class="block-customizer-group-title">${escapeHtml(group)}</div>
      <div class="block-customizer-list">
        ${rows.join("")}
      </div>
    </section>
  `).join("");
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

  refs.leftPaneBlockControls.innerHTML = buildCustomizerRowsMarkup();
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

    const label = getLeftPaneBlockLabel(block.key);
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

  document.querySelectorAll("[data-menu-action='toggle-grammar-check']").forEach((button) => {
    button.classList.toggle("is-active", state.grammarCheck);
  });

  document.querySelectorAll("[data-menu-action='toggle-auto-number']").forEach((button) => {
    button.classList.toggle("is-active", Boolean(refs.autoNumberToggle?.checked));
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
  document.body.classList.toggle("spelling-mode-active", state.grammarCheck);
  refs.toolStrip.classList.toggle("is-collapsed", state.toolStripCollapsed);
  refs.toolStripToggle.innerHTML = state.toolStripCollapsed ? MENU_GLYPHS.down : MENU_GLYPHS.up;
  if (refs.bgAnimationToggle) {
    refs.bgAnimationToggle.checked = state.backgroundAnimation;
  }
  if (refs.bgAnimationLandingToggle) {
    refs.bgAnimationLandingToggle.checked = state.backgroundAnimation;
  }
  setBackgroundAnimationEnabled(state.backgroundAnimation);
  updateMenuStateButtons();
}

export function renderAnalytics(filter = 'all') {
  const project = getCurrentProject();
  const container = document.getElementById("analyticsDashboardContent");
  if (!project || !container) return;

  const data = calculateAnalytics(project, filter);
  const topWordsMarkup = data.topWords.length
    ? data.topWords.map(([word, count]) => `
        <div class="analytics-word-row">
          <span>${escapeHtml(word)}</span>
          <strong>${count}x</strong>
        </div>
      `).join("")
    : '<p class="collab-empty">Not enough words yet.</p>';

  container.innerHTML = `
    <div class="analytics-toolbar">
       <select id="analyticsFilter" class="comment-filter-select">
         <option value="all" ${filter === 'all' ? 'selected' : ''}>All Lines</option>
         <option value="dialogue" ${filter === 'dialogue' ? 'selected' : ''}>Dialogue Only</option>
         <option value="action" ${filter === 'action' ? 'selected' : ''}>Action Only</option>
       </select>
    </div>
    <div class="metric-grid analytics-metric-grid">
      <div><span>Total Words</span><strong>${data.totalWords.toLocaleString()}</strong></div>
      <div><span>Sentences</span><strong>${data.totalSentences}</strong></div>
      <div><span>Avg Sentence</span><strong>${data.avgSentenceLength}</strong></div>
      <div><span>Readability</span><strong>${data.readability}</strong></div>
    </div>
    <div class="analytics-section">
      <span class="nav-menu-label">Style Breakdown</span>
      <div class="analytics-breakdown-bar">
        <div style="width:${data.dialoguePercent}%;" class="analytics-breakdown-fill analytics-breakdown-dialogue" title="Dialogue: ${data.dialoguePercent}%"></div>
        <div style="width:${data.narrationPercent}%;" class="analytics-breakdown-fill analytics-breakdown-narration" title="Narration: ${data.narrationPercent}%"></div>
      </div>
      <div class="analytics-breakdown-legend">
        <span>Dialogue: ${data.dialoguePercent}%</span>
        <span>Narration: ${data.narrationPercent}%</span>
      </div>
    </div>
    <div class="analytics-section">
      <span class="nav-menu-label">Overused Words (>3 chars)</span>
      <div class="list-stack analytics-word-list">
        ${topWordsMarkup}
      </div>
    </div>
  `;

  container.querySelector("#analyticsFilter")?.addEventListener("change", (e) => {
    renderAnalytics(e.target.value);
  });
}

export function openAnalytics() {
  const block = getLeftPaneBlockState("analytics");
  if (block) {
    block.visible = true;
    block.collapsed = false;
    renderLeftPaneLayout();
    renderAnalytics();
    persistProjects(false);
  }

  if (refs.leftPane.classList.contains("is-hidden")) {
    refs.leftPane.classList.remove("is-hidden");
    refs.studioLayout.classList.remove("left-pane-hidden");
    if (refs.leftResize) refs.leftResize.classList.remove("is-hidden");
  }

  document.querySelector('[data-left-pane-block="analytics"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export async function showCustomizeActiveBlocksModal() {
  const container = document.createElement("div");
  container.className = "active-block-config-modal";
  container.innerHTML = `
    <p class="modal-copy">Choose what appears in the Active Block column and reorder it for a clearer workspace.</p>
    <div class="active-block-config-body">${buildCustomizerRowsMarkup()}</div>
  `;

  const rerender = () => {
    const body = container.querySelector(".active-block-config-body");
    if (body) {
      body.innerHTML = buildCustomizerRowsMarkup();
    }
  };

  container.addEventListener("click", (event) => {
    const moveBtn = event.target.closest("[data-left-pane-move]");
    if (!moveBtn) {
      return;
    }
    moveLeftPaneBlock(moveBtn.dataset.leftPaneKey, moveBtn.dataset.leftPaneMove);
    rerender();
  });

  container.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-left-pane-visibility]");
    if (!checkbox) {
      return;
    }
    setLeftPaneBlockVisibility(checkbox.dataset.leftPaneVisibility, checkbox.checked);
    rerender();
  });

  await showModal({
    title: "Customize Active Blocks",
    message: container,
    showConfirm: false,
    cancelLabel: "Close"
  });
}

export async function showStoryMemoryPopup() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }

  const memory = project.storyMemory || { characters: [], locations: [], scenes: [], themes: [] };
  const sections = [
    { key: "characters", label: "Characters" },
    { key: "locations", label: "Locations" },
    { key: "scenes", label: "Scenes" },
    { key: "themes", label: "Themes" }
  ];

  const container = document.createElement("div");
  container.className = "modal-list story-memory-popup";
  container.innerHTML = `
    <div class="story-memory-popup-actions">
      <button class="ghost-button btn-sm" type="button" data-story-memory-action="add">Add Element</button>
      <button class="ghost-button btn-sm" type="button" data-story-memory-action="insert">Insert Into Active Block</button>
    </div>
    ${sections.map(({ key, label }) => `
      <section class="story-memory-popup-group">
        <h4>${escapeHtml(label)}</h4>
        <div class="list-stack">
          ${(memory[key] || []).map((item) => `
            <button class="list-item" type="button" data-story-memory-edit="${escapeHtml(item.id)}">
              <span class="list-item-title">${escapeHtml(item.name)}</span>
              <span class="list-item-meta">${escapeHtml(item.description || "No description yet")}</span>
            </button>
          `).join("") || '<p class="collab-empty">Nothing added yet.</p>'}
        </div>
      </section>
    `).join("")}
  `;

  container.addEventListener("click", (event) => {
    const action = event.target.closest("[data-story-memory-action]")?.dataset.storyMemoryAction;
    if (action === "add") {
      modalRefs.dialog.close();
      showEditStoryElementModal();
      return;
    }
    if (action === "insert") {
      modalRefs.dialog.close();
      showStoryMemoryPicker();
      return;
    }

    const editId = event.target.closest("[data-story-memory-edit]")?.dataset.storyMemoryEdit;
    if (!editId) {
      return;
    }
    const allItems = sections.flatMap(({ key }) => (memory[key] || []).map((item) => ({ ...item, bucket: key })));
    const selected = allItems.find((item) => item.id === editId);
    if (selected) {
      modalRefs.dialog.close();
      showEditStoryElementModal({
        ...selected,
        type: selected.bucket.slice(0, -1).replace(/^./, (char) => char.toUpperCase())
      });
    }
  });

  await showModal({
    title: "Story Memory",
    message: container,
    showConfirm: false,
    cancelLabel: "Close"
  });
}

export async function showCharactersInterface(startWithForm = false) {
  const project = getCurrentProject();
  if (!project) return;

  const container = document.createElement("div");
  container.className = "character-interface";

  function getScriptCharacters() {
    const map = new Map();
    (project.lines || []).forEach((line) => {
      if ((line.type === "character" || line.type === "dual") && line.text?.trim()) {
        const name = line.text.trim().toUpperCase();
        const entry = map.get(name) || { name, count: 0 };
        entry.count++;
        map.set(name, entry);
      }
    });
    return [...map.values()];
  }

  function renderList() {
    const memChars = project.storyMemory?.characters || [];
    const memNames = new Set(memChars.map((c) => String(c.name || "").trim().toUpperCase()));
    const unregistered = getScriptCharacters().filter((c) => !memNames.has(c.name));

    container.innerHTML = `
      <div class="char-interface-head">
        <button class="ghost-button btn-sm" type="button" data-char-action="new">+ New Character</button>
      </div>
      ${memChars.length ? `
        <div class="char-section">
          <h4 class="char-section-label">Registered Characters</h4>
          <div class="char-list">
            ${memChars.map((char, i) => `
              <div class="char-card">
                <div class="char-card-info">
                  <strong>${escapeHtml(char.name)}</strong>
                  <span>${escapeHtml(char.description || "No details yet")}</span>
                </div>
                <div class="char-card-actions">
                  <button class="ghost-button btn-sm" type="button" data-char-refine="${i}">Refine</button>
                  <button class="ghost-button btn-sm" type="button" data-char-delete="${i}">Delete</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : `<p class="collab-empty">No characters registered yet. Add one so Smart Proofread can write precise introductions.</p>`}
      ${unregistered.length ? `
        <div class="char-section">
          <h4 class="char-section-label">In Script — Not Yet Registered</h4>
          <div class="char-list">
            ${unregistered.map((char) => `
              <div class="char-card char-card-script">
                <div class="char-card-info">
                  <strong>${escapeHtml(char.name)}</strong>
                  <span>${char.count} line${char.count !== 1 ? "s" : ""} in script</span>
                </div>
                <div class="char-card-actions">
                  <button class="ghost-button btn-sm" type="button" data-char-register="${escapeHtml(char.name)}">+ Add Details</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    `;
    attachListHandlers();
  }

  function renderForm(existing = null, prefillName = "") {
    const isEdit = Boolean(existing);
    container.innerHTML = `
      <div class="char-form">
        <button class="ghost-button btn-sm" type="button" data-char-action="back">← Back</button>
        <h4 class="char-form-title">${isEdit ? "Refine Character" : "New Character"}</h4>
        <div class="field-grid">
          <label class="field field-wide">
            <span>Name</span>
            <input class="modal-input" id="charName" type="text" value="${escapeHtml(existing?.name || prefillName)}" placeholder="e.g. JOHN" ${isEdit ? "readonly" : ""}>
          </label>
          <label class="field field-wide">
            <span>Age</span>
            <input class="modal-input" id="charAge" type="text" value="${escapeHtml(existing?.age || "")}" placeholder="e.g. 35">
          </label>
          <label class="field field-wide">
            <span>Outfit / Appearance</span>
            <input class="modal-input" id="charOutfit" type="text" value="${escapeHtml(existing?.outfit || "")}" placeholder="e.g. grey tailored suit, tired eyes">
          </label>
          <label class="field field-wide">
            <span>Behaviour / Personality</span>
            <input class="modal-input" id="charBehaviour" type="text" value="${escapeHtml(existing?.behaviour || "")}" placeholder="e.g. calculated, speaks rarely">
          </label>
          <label class="field field-wide">
            <span>Other Notes</span>
            <textarea class="modal-input" id="charOther" placeholder="Backstory, role, or anything else...">${escapeHtml(existing?.other || "")}</textarea>
          </label>
        </div>
        <div class="char-form-actions">
          <button class="ghost-button" type="button" data-char-action="save">${isEdit ? "Save Changes" : "Add Character"}</button>
        </div>
      </div>
    `;
    attachFormHandlers(existing);
  }

  function attachListHandlers() {
    container.querySelector('[data-char-action="new"]')?.addEventListener("click", () => renderForm());
    container.querySelectorAll("[data-char-refine]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const char = (project.storyMemory?.characters || [])[Number(btn.dataset.charRefine)];
        if (char) renderForm(char);
      });
    });
    container.querySelectorAll("[data-char-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const chars = project.storyMemory?.characters || [];
        chars.splice(Number(btn.dataset.charDelete), 1);
        persistProjects(false);
        renderCharacterList();
        renderList();
      });
    });
    container.querySelectorAll("[data-char-register]").forEach((btn) => {
      btn.addEventListener("click", () => renderForm(null, btn.dataset.charRegister));
    });
  }

  function attachFormHandlers(existing) {
    container.querySelector('[data-char-action="back"]')?.addEventListener("click", renderList);
    container.querySelector('[data-char-action="save"]')?.addEventListener("click", () => {
      const name = (container.querySelector("#charName")?.value || "").trim().toUpperCase();
      if (!name) return;
      const age = (container.querySelector("#charAge")?.value || "").trim();
      const outfit = (container.querySelector("#charOutfit")?.value || "").trim();
      const behaviour = (container.querySelector("#charBehaviour")?.value || "").trim();
      const other = (container.querySelector("#charOther")?.value || "").trim();

      const parts = [];
      if (age) parts.push(`Age: ${age}`);
      if (outfit) parts.push(`Outfit: ${outfit}`);
      if (behaviour) parts.push(`Behaviour: ${behaviour}`);
      if (other) parts.push(other);
      const description = parts.join(". ");

      if (!project.storyMemory) project.storyMemory = { characters: [], locations: [], scenes: [], themes: [], plotPoints: [] };
      if (!Array.isArray(project.storyMemory.characters)) project.storyMemory.characters = [];

      if (existing) {
        const idx = project.storyMemory.characters.findIndex((c) => c.id === existing.id);
        if (idx !== -1) {
          project.storyMemory.characters[idx] = { ...existing, name, age, outfit, behaviour, other, description };
        }
      } else {
        project.storyMemory.characters.push({
          id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name, age, outfit, behaviour, other, description
        });
      }

      persistProjects(false);
      renderCharacterList();
      renderStoryMemory();
      renderList();
    });
  }

  if (startWithForm) {
    renderForm();
  } else {
    renderList();
  }

  await showModal({ title: "Characters", message: container, showConfirm: false, cancelLabel: "Close" });
}

export async function showWorkspacePopup() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }

  const ownerLabel = project.ownerName || project.ownerEmail || project.author || "Workspace owner";
  const collaborators = Object.entries(project.collaborators || {});
  const activeUsers = [ownerLabel, ...collaborators.map(([, person]) => person.name || person.email)].filter(Boolean);
  const inviteLink = `${window.location.origin}${window.location.pathname}?project=${encodeURIComponent(project.id)}&script=${encodeURIComponent(project.scriptId || "")}`;
  const lastEditedBy = project.lastEditorName || ownerLabel;
  const workspace = project.workspace || { name: project.title || "Team Workspace", reminders: [] };
  const reminders = workspace.reminders || [];
  const activity = [...(project.activityLog || [])].slice(-5).reverse();
  const ownerCanManage = !project.ownerId || project.ownerId === auth.currentUser?.uid;
  const lastActivity = project.lastActivityAt || project.updatedAt;

  const container = document.createElement("div");
  container.className = "workspace-popup";
  container.innerHTML = `
    <section class="workspace-popup-section">
      <h4>Team Workspace</h4>
      <p>Create shared writing spaces where projects belong to the workspace, not just one user.</p>
      <div class="workspace-title-row">
        <input id="workspaceNameInput" class="modal-input" type="text" value="${escapeHtml(workspace.name || project.title || 'Team Workspace')}" ${ownerCanManage ? '' : 'readonly'}>
        ${ownerCanManage ? '<button class="ghost-button" type="button" data-workspace-action="rename">Save Name</button>' : ''}
      </div>
      <div class="metric-grid workspace-metric-grid">
        <div><span>Owner</span><strong>${escapeHtml(ownerLabel)}</strong></div>
        <div><span>Members</span><strong>${collaborators.length}</strong></div>
        <div><span>Active Viewers</span><strong>${activeUsers.length}</strong></div>
        <div><span>Last Edited By</span><strong>${escapeHtml(lastEditedBy)}</strong></div>
        <div><span>Last Activity</span><strong>${escapeHtml(formatDateTime(lastActivity))}</strong></div>
        <div><span>Workspace Code</span><strong>${escapeHtml(workspace.inviteCode || project.scriptId || "")}</strong></div>
      </div>
    </section>
    <section class="workspace-popup-section">
      <h4>Sharing</h4>
      <p>Invite collaborators by email or share a workspace link, then assign Editor or Viewer access.</p>
      <div class="workspace-share-row">
        <input class="modal-input" type="text" value="${escapeHtml(inviteLink)}" readonly>
        <button class="ghost-button" type="button" data-workspace-action="copy-link">Copy Link</button>
      </div>
      <div class="workspace-share-row">
        <input id="workspaceInviteEmail" class="modal-input" type="email" placeholder="collaborator@email.com">
        <select id="workspaceInviteRole" class="comment-filter-select">
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button class="ghost-button" type="button" data-workspace-action="invite">Invite by Email</button>
      </div>
      <p class="collab-status-msg" data-workspace-status></p>
    </section>
    <section class="workspace-popup-section">
      <h4>Roles</h4>
      <div class="list-stack">
        <div class="list-item"><span class="list-item-title">Owner</span><span class="list-item-meta">${escapeHtml(ownerLabel)}</span></div>
        ${collaborators.map(([uid, person]) => `
          <div class="list-item workspace-member-row">
            <div>
              <span class="list-item-title">${escapeHtml(person.name || person.email || "Collaborator")}</span>
              <span class="list-item-meta">${escapeHtml(person.email || "")}</span>
            </div>
            ${ownerCanManage ? `
              <select class="comment-filter-select workspace-role-select" data-member-role="${escapeHtml(uid)}">
                <option value="editor" ${(person.role || "editor") === "editor" ? "selected" : ""}>Editor</option>
                <option value="viewer" ${(person.role || "editor") === "viewer" ? "selected" : ""}>Viewer</option>
              </select>
            ` : `<span class="role-badge">${escapeHtml((person.role || "editor").replace(/^./, (char) => char.toUpperCase()))}</span>`}
          </div>
        `).join("") || '<p class="collab-empty">No editors added yet.</p>'}
      </div>
    </section>
    <section class="workspace-popup-section">
      <h4>Reminders</h4>
      <div class="workspace-share-row">
        <input id="workspaceReminderText" class="modal-input" type="text" placeholder="Prepare scene board, review act two, share draft…">
        <input id="workspaceReminderDue" class="modal-input" type="datetime-local">
        <button class="ghost-button" type="button" data-workspace-action="add-reminder">Add Reminder</button>
      </div>
      <div class="list-stack">
        ${reminders.map((reminder) => `
          <div class="list-item workspace-reminder-item${reminder.completed ? ' is-complete' : ''}">
            <label class="workspace-reminder-main">
              <input type="checkbox" data-workspace-reminder-toggle="${escapeHtml(reminder.id)}" ${reminder.completed ? 'checked' : ''}>
              <span>
                <span class="list-item-title">${escapeHtml(reminder.text)}</span>
                <span class="list-item-meta">${escapeHtml(reminder.dueAt ? `Due ${formatDateTime(reminder.dueAt)}` : `Added by ${reminder.createdByName || 'team member'}`)}</span>
              </span>
            </label>
            <button class="ghost-button btn-sm danger-text" type="button" data-workspace-reminder-delete="${escapeHtml(reminder.id)}">Delete</button>
          </div>
        `).join("") || '<p class="collab-empty">No reminders yet.</p>'}
      </div>
    </section>
    <section class="workspace-popup-section">
      <h4>Recent Activity</h4>
      <div class="list-stack">
        ${activity.map((entry) => `
          <div class="list-item workspace-activity-item">
            <span class="list-item-title">${escapeHtml(entry.user)}</span>
            <span class="list-item-meta">${escapeHtml(entry.message)} • ${escapeHtml(formatDateTime(entry.timestamp))}</span>
          </div>
        `).join("") || '<p class="collab-empty">No activity recorded yet.</p>'}
      </div>
      <div class="workspace-action-row">
        <button class="ghost-button" type="button" data-workspace-action="comments">Open Comments</button>
      </div>
    </section>
  `;

  container.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-workspace-action]")?.dataset.workspaceAction;
    const status = container.querySelector("[data-workspace-status]");
    if (!action) {
      return;
    }

    if (action === "copy-link") {
      await navigator.clipboard?.writeText(inviteLink);
      if (status) status.textContent = "Workspace link copied.";
      return;
    }

    if (action === "rename") {
      const name = container.querySelector("#workspaceNameInput")?.value?.trim();
      if (!name) {
        if (status) status.textContent = "Enter a workspace name first.";
        return;
      }
      if (status) status.textContent = "Saving workspace name...";
      window.dispatchEvent(new CustomEvent("workspaceRenameRequested", {
        detail: { projectId: project.id, name }
      }));
      return;
    }

    if (action === "comments") {
      modalRefs.dialog.close();
      document.getElementById("viewCommentsBtn")?.click();
      return;
    }

    if (action === "invite") {
      const email = container.querySelector("#workspaceInviteEmail")?.value?.trim();
      const role = container.querySelector("#workspaceInviteRole")?.value || "editor";
      if (!email) {
        if (status) status.textContent = "Enter an email address first.";
        return;
      }
      if (status) status.textContent = "Sending invite...";
      window.dispatchEvent(new CustomEvent("workspaceInviteRequested", { detail: { email, role } }));
      return;
    }

    if (action === "add-reminder") {
      const text = container.querySelector("#workspaceReminderText")?.value?.trim();
      const dueAt = container.querySelector("#workspaceReminderDue")?.value || "";
      if (!text) {
        if (status) status.textContent = "Enter a reminder first.";
        return;
      }
      if (status) status.textContent = "Adding reminder...";
      window.dispatchEvent(new CustomEvent("workspaceReminderRequested", {
        detail: { projectId: project.id, text, dueAt }
      }));
    }
  });

  container.addEventListener("change", (event) => {
    const roleTarget = event.target.closest("[data-member-role]");
    if (roleTarget) {
      window.dispatchEvent(new CustomEvent("workspaceRoleChangeRequested", {
        detail: { projectId: project.id, collaboratorUid: roleTarget.dataset.memberRole, role: roleTarget.value }
      }));
      return;
    }

    const reminderToggle = event.target.closest("[data-workspace-reminder-toggle]");
    if (reminderToggle) {
      window.dispatchEvent(new CustomEvent("workspaceReminderToggleRequested", {
        detail: { projectId: project.id, reminderId: reminderToggle.dataset.workspaceReminderToggle }
      }));
    }
  });

  container.querySelectorAll("[data-workspace-reminder-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("workspaceReminderDeleteRequested", {
        detail: { projectId: project.id, reminderId: button.dataset.workspaceReminderDelete }
      }));
    });
  });

  const handleInviteResult = (event) => {
    const status = container.querySelector("[data-workspace-status]");
    if (!status) {
      return;
    }
    status.textContent = event.detail?.ok ? "Invitation sent." : (event.detail?.reason || "Unable to send invite.");
  };
  const handleMutationResult = (event) => {
    const status = container.querySelector("[data-workspace-status]");
    if (!status) {
      return;
    }
    status.textContent = event.detail?.ok ? (event.detail?.message || "Workspace updated.") : (event.detail?.reason || "Unable to update workspace.");
  };
  window.addEventListener("workspaceInviteResult", handleInviteResult);
  window.addEventListener("workspaceMutationResult", handleMutationResult);

  await showModal({
    title: "Workspace",
    message: container,
    contentClass: "modal-content-wide modal-content-workspace",
    showConfirm: false,
    cancelLabel: "Close"
  });

  window.removeEventListener("workspaceInviteResult", handleInviteResult);
  window.removeEventListener("workspaceMutationResult", handleMutationResult);
}

export function renderMetrics() {
  const project = getCurrentProject();
  if (!project) return;
  const words = serializeScript(project).match(/\b[\w'-]+\b/g) || [];
  const characters = new Set(project.lines.filter((line) => line.type === "character" && line.text.trim()).map((line) => line.text.trim().toUpperCase()));
  const scenes = project.lines.filter((line) => line.type === "scene" && line.text.trim()).length;

  refs.wordCount.textContent = words.length.toLocaleString();
  refs.pageCount.textContent = Math.max(1, Math.round((words.length / 180) * 10) / 10).toFixed(1);
  refs.characterCount.textContent = characters.size.toString();
  refs.sceneMetricCount.textContent = scenes.toString();
  if (refs.metricsGraph) {
    refs.metricsGraph.innerHTML = "";
    refs.metricsGraph.hidden = true;
  }
  renderAnalyticsIfVisible();
}

export function renderCurrentScriptId() {
  const stack = document.querySelector(".save-status-stack");
  if (!stack) return;

  const project = getCurrentProject();

  let flag = document.getElementById("currentScriptIdFlag");
  if (flag) {
    flag.textContent = project?.scriptId || "";
    flag.hidden = !project?.scriptId;
  }

  let editorFlag = document.getElementById("lastEditorFlag");
  if (!editorFlag) {
    editorFlag = document.createElement("span");
    editorFlag.id = "lastEditorFlag";
    editorFlag.className = "script-id-flag";
    editorFlag.style.marginTop = "2px";
    stack.appendChild(editorFlag);
  }

  if (project?.lastEditorName) {
    editorFlag.textContent = `Edited by ${project.lastEditorName}`;
    editorFlag.hidden = false;
  } else {
    editorFlag.hidden = true;
  }
}

export function renderStoryMemory() {
  const project = getCurrentProject();
  const list = document.getElementById("storyMemoryList");
  if (!project || !list) return;

  const memory = project.storyMemory || { characters: [], locations: [], scenes: [], themes: [] };
  const allElements = [
    ...memory.characters.map(e => ({ ...e, type: 'Character' })),
    ...memory.locations.map(e => ({ ...e, type: 'Location' })),
    ...memory.scenes.map(e => ({ ...e, type: 'Scene' })),
    ...memory.themes.map(e => ({ ...e, type: 'Theme' }))
  ];

  if (!allElements.length) {
    list.innerHTML = '<p class="collab-empty">No story elements defined yet.</p>';
    return;
  }

  list.innerHTML = allElements.map(e => `
    <div class="list-item story-memory-item" data-id="${e.id}" data-type="${e.type}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <span class="list-item-title">${escapeHtml(e.name)}</span>
          <span class="list-item-meta">${escapeHtml(e.type)}: ${escapeHtml(e.description || 'No description')}</span>
        </div>
        <div class="story-memory-actions">
           <button class="ghost-button btn-sm edit-memory-btn" data-id="${e.id}">Edit</button>
           <button class="ghost-button btn-sm delete-memory-btn" data-id="${e.id}">×</button>
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.edit-memory-btn').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      const element = allElements.find(el => el.id === id);
      if (element) showEditStoryElementModal(element);
    };
  });

  list.querySelectorAll('.delete-memory-btn').forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      const confirmed = await customConfirm("Delete this story element?");
      if (confirmed) {
        deleteStoryElement(id);
      }
    };
  });
}

export async function showEditStoryElementModal(element = null) {
  const isNew = !element;
  const title = isNew ? "Add Story Element" : "Edit Story Element";
  const project = getCurrentProject();
  if (!project) return;
  const editorSuggestions = getEditorStoryElementSuggestions(project);
  const selectedBucket = element?.type === 'Character'
    ? 'characters'
    : element?.type === 'Location'
      ? 'locations'
      : element?.type === 'Scene'
        ? 'scenes'
        : 'themes';

  const container = document.createElement("div");
  container.className = "field-grid story-memory-form";
  container.innerHTML = `
    <label class="field field-wide">
      <span>Type</span>
      <select id="memoryType">
        <option value="characters" ${selectedBucket === 'characters' ? 'selected' : ''}>Character</option>
        <option value="locations" ${selectedBucket === 'locations' ? 'selected' : ''}>Location</option>
        <option value="scenes" ${selectedBucket === 'scenes' ? 'selected' : ''}>Scene</option>
        <option value="themes" ${selectedBucket === 'themes' ? 'selected' : ''}>Theme</option>
      </select>
    </label>
    <label class="field field-wide">
      <span>Name</span>
      <input id="memoryName" type="text" list="memoryNameSuggestions" value="${escapeHtml(element?.name || '')}">
      <datalist id="memoryNameSuggestions"></datalist>
    </label>
    <label class="field field-wide">
      <span>Description / Traits</span>
      <textarea id="memoryDesc">${escapeHtml(element?.description || '')}</textarea>
    </label>
  `;

  const typeSelect = container.querySelector("#memoryType");
  const nameInput = container.querySelector("#memoryName");
  const descInput = container.querySelector("#memoryDesc");
  const nameSuggestions = container.querySelector("#memoryNameSuggestions");

  const renderSuggestionUI = () => {
    const bucket = typeSelect.value;
    const suggestions = editorSuggestions[bucket] || [];
    nameSuggestions.innerHTML = suggestions.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("");
  };

  const maybePrefillDescription = () => {
    const bucket = typeSelect.value;
    const selected = (editorSuggestions[bucket] || []).find((item) => item.name.toLowerCase() === nameInput.value.trim().toLowerCase());
    if (selected && !descInput.value.trim()) {
      descInput.value = selected.description || "";
    }
  };

  renderSuggestionUI();
  maybePrefillDescription();

  typeSelect.addEventListener("change", () => {
    renderSuggestionUI();
    maybePrefillDescription();
  });
  nameInput.addEventListener("change", maybePrefillDescription);

  const result = await showModal({
    title,
    message: container,
    confirmLabel: isNew ? "Add" : "Save"
  });

  if (result) {
    const name = container.querySelector("#memoryName").value.trim();
    const type = container.querySelector("#memoryType").value;
    const description = container.querySelector("#memoryDesc").value.trim();

    if (!name) return;

    if (isNew) {
      project.storyMemory[type].push({ id: 'mem-' + Date.now(), name, description });
    } else {
      // Find and update, possibly moving type
      let found = false;
      ['characters', 'locations', 'scenes', 'themes'].forEach(t => {
        const idx = project.storyMemory[t].findIndex(el => el.id === element.id);
        if (idx !== -1) {
          if (t === type) {
            project.storyMemory[t][idx] = { ...project.storyMemory[t][idx], name, description };
          } else {
            project.storyMemory[t].splice(idx, 1);
            project.storyMemory[type].push({ id: element.id, name, description });
          }
          found = true;
        }
      });
    }

    renderStoryMemory();
    persistProjects(false);
  }
}

function deleteStoryElement(id) {
  const project = getCurrentProject();
  if (!project) return;

  ['characters', 'locations', 'scenes', 'themes'].forEach(t => {
    project.storyMemory[t] = project.storyMemory[t].filter(el => el.id !== id);
  });

  renderStoryMemory();
  persistProjects(false);
}

export function openStoryMemory() {
  const block = getLeftPaneBlockState("story-memory");
  if (block) {
    block.visible = true;
    block.collapsed = false;
    renderLeftPaneLayout();
    renderStoryMemory();
    persistProjects(false);
  }

  if (refs.leftPane.classList.contains("is-hidden")) {
    refs.leftPane.classList.remove("is-hidden");
    refs.studioLayout.classList.remove("left-pane-hidden");
    if (refs.leftResize) refs.leftResize.classList.remove("is-hidden");
  }

  document.querySelector('[data-left-pane-block="story-memory"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export async function showStoryMemoryPicker() {
  const project = getCurrentProject();
  if (!project) return;

  const memory = project.storyMemory || { characters: [], locations: [], scenes: [], themes: [] };
  const categories = [
    { key: 'characters', label: 'Characters' },
    { key: 'locations', label: 'Locations' },
    { key: 'scenes', label: 'Scenes' },
    { key: 'themes', label: 'Themes' }
  ].filter(cat => memory[cat.key].length > 0);

  if (categories.length === 0) {
    customAlert("Your Story Memory is empty. Add elements first to pick from them.", "Story Memory Empty");
    return;
  }

  const categoryContainer = document.createElement("div");
  categoryContainer.className = "modal-list";

  categories.forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "modal-list-item";
    btn.innerHTML = `<strong>${escapeHtml(cat.label)}</strong>`;
    btn.onclick = () => {
      showElementPicker(cat.key, cat.label, memory[cat.key]);
    };
    categoryContainer.appendChild(btn);
  });

  showModal({
    title: "Pick Category",
    message: categoryContainer,
    showConfirm: false,
    showCancel: true,
    cancelLabel: "Close"
  });

  function showElementPicker(key, label, elements) {
    const elementContainer = document.createElement("div");
    elementContainer.className = "modal-list";

    elements.forEach(el => {
      const btn = document.createElement("button");
      btn.className = "modal-list-item";
      btn.innerHTML = `<strong>${escapeHtml(el.name)}</strong><small>${escapeHtml(el.description)}</small>`;
      btn.onclick = () => {
        insertElementIntoEditor(el.name);
        modalRefs.dialog.close();
      };
      elementContainer.appendChild(btn);
    });

    showModal({
      title: `Pick ${label}`,
      message: elementContainer,
      showConfirm: false,
      showCancel: true,
      cancelLabel: "Back"
    });
  }
}

function renderAnalyticsIfVisible() {
  const block = document.querySelector('[data-left-pane-block="analytics"]');
  const container = document.getElementById("analyticsDashboardContent");
  if (!block || block.hidden || !container) {
    return;
  }
  const currentFilter = container.querySelector("#analyticsFilter")?.value || "all";
  renderAnalytics(currentFilter);
}

function insertElementIntoEditor(text) {
  let activeEl = document.querySelector(".script-block.is-active") || document.querySelector(".script-block:focus");
  if (!activeEl) {
    activeEl = document.querySelector(".script-block");
    if (activeEl) activeEl.focus();
  }
  if (!activeEl) return;

  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));

  // Trigger input to sync state
  activeEl.dispatchEvent(new Event('input', { bubbles: true }));

  // Move caret to end of inserted text
  selection.collapseToEnd();
}

export function closeMenus() {
  document.querySelectorAll(".nav-menu").forEach((menu) => {
    menu.hidden = true;
    // Auto-collapse details groups within the menu when closing
    menu.querySelectorAll("details.menu-group[open]").forEach((group) => {
      // Keep only those that should be 'open' by default if needed,
      // but the user wants 'every menu submenu auto collapse when the user leaves'.
      group.removeAttribute("open");
    });
  });
  document.querySelectorAll("[data-menu-trigger]").forEach((button) => {
    button.classList.remove("is-open");
  });
}

export function toggleMenu(menuId, forceState = null) {
  const menu = document.getElementById(menuId);
  if (!menu) {
    return;
  }
  const trigger = document.querySelector(`[data-menu-trigger="${menuId}"]`);
  const willOpen = forceState !== null ? forceState : menu.hidden;

  if (willOpen && !menu.hidden) return; // Already open
  if (!willOpen && menu.hidden) return; // Already closed

  if (willOpen) {
    closeMenus();
    menu.hidden = false;
    trigger?.classList.add("is-open");
    positionMenuUnderTrigger(menu, trigger);
  } else {
    menu.hidden = true;
    trigger?.classList.remove("is-open");
  }
}

export async function showProofreadReport() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const emptyLineCount = project.lines.filter((line) => line && line.type !== "image" && !String(line.text || "").trim()).length;

  const emptyScenes = project.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.type === "scene" && !normalizeLineText(line.text, "scene"));
  const weakSceneLines = project.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.type === "scene" && line.text && !/^(INT\.|EXT\.|INT\.\/EXT\.|EST\.)/i.test(normalizeLineText(line.text, "scene")));
  const loneCharacters = project.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => line.type === "character" && !project.lines[index + 1]?.text?.trim());
  const uncapitalizedCharacters = project.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isUncapitalizedCharacterCue(line));
  const narrativeCharacterCapsIssues = findNarrativeCharacterCapsIssues(project);
  const fixableCorrections = [
    ...uncapitalizedCharacters.map(({ line }) => ({
      mode: "character-cue-caps",
      lineId: line.id
    })),
    ...narrativeCharacterCapsIssues.map(({ line, matchedText, name }) => ({
      mode: "narrative-character-caps",
      lineId: line.id,
      from: matchedText,
      to: name
    }))
  ];
  const correctionKeyMap = new Map(fixableCorrections.map((correction, index) => [buildProofreadCorrectionKey(correction), index]));

  if (!emptyScenes.length && !weakSceneLines.length && !loneCharacters.length && !uncapitalizedCharacters.length && !narrativeCharacterCapsIssues.length && !emptyLineCount) {
    await customAlert(t("proofread.none"), t("proofread.title"));
    return;
  }

  const container = document.createElement("div");
  container.className = "proofread-report";
  container.innerHTML = `
    <div class="proofread-report-toolbar">
      <button class="ghost-button btn-sm" type="button" data-proofread-clean-empty-lines="true">Clean Empty Lines${emptyLineCount ? ` (${emptyLineCount})` : ""}</button>
      <button class="ghost-button btn-sm" type="button" data-proofread-apply-selected="true" ${fixableCorrections.length ? "" : "disabled"}>Apply Selected Corrections</button>
      <button class="ghost-button btn-sm" type="button" data-proofread-accept-all-corrections="true" ${fixableCorrections.length ? "" : "disabled"}>Accept All Corrections${fixableCorrections.length ? ` (${fixableCorrections.length})` : ""}</button>
    </div>
    ${!emptyScenes.length && !weakSceneLines.length && !loneCharacters.length && !uncapitalizedCharacters.length && !narrativeCharacterCapsIssues.length ? '<p class="collab-empty">No screenplay issues found. You can still clean out empty lines.</p>' : ""}
    ${buildProofreadSection("Scene Heading Issues", weakSceneLines, ({ line }) => ({
      title: normalizeLineText(line.text, "scene") || "Scene heading needs attention",
      note: "Scene heading should start with INT., EXT., INT./EXT., or EST.",
      ref: buildProofreadReference(project, line.id),
      tags: ["Scene heading", "Format"]
    }))}
    ${buildProofreadSection("Empty Scene Headings", emptyScenes, ({ index }) => ({
      title: `Scene heading at line ${index + 1}`,
      note: "This scene heading is empty.",
      ref: buildProofreadReference(project, project.lines[index].id),
      tags: ["Scene heading", "Empty"]
    }))}
    ${buildProofreadSection("Character Cue Issues", loneCharacters, ({ line, index }) => ({
      title: normalizeLineText(line.text, "character") || `Character cue ${index + 1}`,
      note: "This character cue is not followed by dialogue or an action beat.",
      ref: buildProofreadReference(project, line.id),
      tags: ["Character cue", "Dialogue"]
    }))}
    ${buildProofreadSection("Uncapitalized Character Names", uncapitalizedCharacters, ({ line, index }) => ({
      title: normalizeLineText(line.text, "character") || `Character cue ${index + 1}`,
      note: "Character cues should be fully capitalized for standard screenplay formatting.",
      ref: buildProofreadReference(project, line.id),
      tags: ["Character cue", "Capitalization"],
      correctionIndex: correctionKeyMap.get(buildProofreadCorrectionKey({
        mode: "character-cue-caps",
        lineId: line.id
      }))
    }))}
    ${buildProofreadSection("Character Names In Action", narrativeCharacterCapsIssues, ({ line, name, matchedText }) => ({
      title: normalizeLineText(line.text, line.type) || "Character name should be capitalized",
      note: `Use ${name} in caps here instead of "${matchedText}".`,
      ref: buildProofreadReference(project, line.id),
      tags: ["Action", "Character name", "Capitalization"],
      correctionIndex: correctionKeyMap.get(buildProofreadCorrectionKey({
        mode: "narrative-character-caps",
        lineId: line.id,
        from: matchedText,
        to: name
      }))
    }))}
  `;

  container.querySelector('[data-proofread-clean-empty-lines="true"]')?.addEventListener("click", async () => {
    const removedCount = cleanEmptyLinesFromProject(project);
    if (!removedCount) {
      await customAlert("There were no empty lines to clean.", "Proofreading");
      return;
    }
    modalRefs.dialog.close();
    persistProjects(false);
    window.dispatchEvent(new CustomEvent("proofreadCleanupApplied", { detail: { removedCount } }));
    await customAlert(`Removed ${removedCount} empty ${removedCount === 1 ? "line" : "lines"}.`, "Proofreading");
  });

  container.querySelector('[data-proofread-accept-all-corrections="true"]')?.addEventListener("click", async () => {
    const applied = applyProofreadCorrections(project, fixableCorrections);
    if (!applied) {
      await customAlert("There were no automatic corrections left to apply.", "Style Proofread");
      return;
    }
    markProofreadCorrectionsApplied(container, fixableCorrections, correctionKeyMap);
    modalRefs.dialog.close();
    persistProjects(false);
    window.dispatchEvent(new CustomEvent("proofreadCleanupApplied", { detail: { removedCount: 0 } }));
    await customAlert(`Applied ${applied} correction${applied === 1 ? "" : "s"}.`, "Style Proofread");
  });

  container.querySelector('[data-proofread-apply-selected="true"]')?.addEventListener("click", async () => {
    const selectedCorrections = [...container.querySelectorAll("[data-proofread-select]:checked")]
      .map((input) => fixableCorrections[Number(input.dataset.proofreadSelect)])
      .filter(Boolean);
    const applied = applyProofreadCorrections(project, selectedCorrections);
    if (!applied) {
      await customAlert("Select at least one automatic correction to apply.", "Style Proofread");
      return;
    }
    markProofreadCorrectionsApplied(container, selectedCorrections, correctionKeyMap);
    persistProjects(false);
    window.dispatchEvent(new CustomEvent("proofreadCleanupApplied", { detail: { removedCount: 0 } }));
    await customAlert(`Applied ${applied} selected correction${applied === 1 ? "" : "s"}.`, "Style Proofread");
  });

  container.querySelectorAll("[data-proofread-correction-index]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const correction = fixableCorrections[Number(button.dataset.proofreadCorrectionIndex)];
      if (!correction) {
        return;
      }
      const applied = applyProofreadCorrections(project, [correction]);
      if (!applied) {
        await customAlert("That correction could not be applied.", "Style Proofread");
        return;
      }
      markProofreadCorrectionsApplied(container, [correction], correctionKeyMap);
      persistProjects(false);
      window.dispatchEvent(new CustomEvent("proofreadCleanupApplied", { detail: { removedCount: 0 } }));
    });
  });

  container.querySelectorAll("[data-proofread-line-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (event.target.closest("[data-proofread-correction-action='true']") || event.target.closest("[data-proofread-select]")) {
        return;
      }
      modalRefs.dialog.close();
      window.dispatchEvent(new CustomEvent("focusScriptLine", { detail: { lineId: button.dataset.proofreadLineId } }));
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      if (event.target.closest("[data-proofread-correction-action='true']") || event.target.closest("[data-proofread-select]")) {
        return;
      }
      event.preventDefault();
      modalRefs.dialog.close();
      window.dispatchEvent(new CustomEvent("focusScriptLine", { detail: { lineId: button.dataset.proofreadLineId } }));
    });
  });

  await showModal({
    title: t("proofread.title"),
    message: container,
    contentClass: "modal-content-proofread",
    showConfirm: false,
    cancelLabel: "Close"
  });
}

export async function showWorkTracking() {
  const project = getCurrentProject();
  if (!project) {
    return;
  }
  const scenes = project.lines.filter((line) => line.type === "scene" && line.text.trim()).length;
  const lines = project.lines.filter((line) => line.text.trim()).length;
  const words = (serializeScript(project).match(/\b[\w'-]+\b/g) || []).length;
  const pages = Math.max(1, Math.round((words / 180) * 10) / 10);
  const targets = project.workspace?.targets || { scenes: 0, pages: 0, lines: 0 };
  const completion = buildCompletionMetrics({ scenes, pages, lines }, targets);
  const contributions = buildCollaboratorContributionSummary(project);

  const container = document.createElement("div");
  container.className = "work-tracking-report work-tracking-report-compact";
  container.innerHTML = `
    <div class="metric-grid analytics-metric-grid">
      <div><span>Project</span><strong>${escapeHtml(project.title)}</strong></div>
      <div><span>Created</span><strong>${escapeHtml(formatDateTime(project.createdAt))}</strong></div>
      <div><span>Updated</span><strong>${escapeHtml(formatDateTime(project.updatedAt))}</strong></div>
      <div><span>Words</span><strong>${words.toLocaleString()}</strong></div>
      <div><span>Scenes</span><strong>${scenes}</strong></div>
      <div><span>Lines</span><strong>${lines}</strong></div>
      <div><span>Pages</span><strong>${pages.toFixed(1)}</strong></div>
      <div><span>Completion</span><strong>${completion.overall}%</strong></div>
    </div>
    <section class="analytics-section">
      <span class="nav-menu-label">Word Count vs Time</span>
      <div class="work-tracking-graph-wrap">
        ${buildCollaboratorProgressGraph(project, 640, 180, true)}
      </div>
      <div class="work-contribution-list">
        ${contributions.length ? contributions.map((item) => `
          <div class="work-contribution-row">
            <span class="work-contribution-user">
              <span class="collab-progress-key-swatch" style="background:${item.color};"></span>
              <span>${escapeHtml(item.label)}</span>
            </span>
            <strong>${item.words.toLocaleString()} words • ${item.share}%</strong>
          </div>
        `).join("") : '<div class="analytics-word-row"><span>Aggregate contribution</span><strong>Waiting for more data</strong></div>'}
      </div>
    </section>
    <section class="analytics-section">
      <span class="nav-menu-label">Completion Targets</span>
      <div class="work-target-grid">
        <label class="field field-wide">
          <span>Target Scenes</span>
          <input id="workTargetScenes" type="number" min="0" value="${targets.scenes || 0}">
        </label>
        <label class="field field-wide">
          <span>Target Pages</span>
          <input id="workTargetPages" type="number" min="0" step="0.1" value="${targets.pages || 0}">
        </label>
        <label class="field field-wide">
          <span>Target Lines</span>
          <input id="workTargetLines" type="number" min="0" value="${targets.lines || 0}">
        </label>
      </div>
      <div class="list-stack">
        ${completion.items.map((item) => `
          <div class="analytics-word-row">
            <span>${item.label}</span>
            <strong>${item.value}</strong>
          </div>
        `).join("")}
      </div>
    </section>
  `;

  const saved = await showModal({
    title: t("work.title"),
    message: container,
    contentClass: "modal-content-wide modal-content-work-tracking",
    confirmLabel: "Save Targets",
    cancelLabel: "Close"
  });

  if (saved) {
    project.workspace = {
      ...(project.workspace || {}),
      targets: {
        scenes: Number(container.querySelector("#workTargetScenes")?.value || 0),
        pages: Number(container.querySelector("#workTargetPages")?.value || 0),
        lines: Number(container.querySelector("#workTargetLines")?.value || 0)
      }
    };
    persistProjects(false);
  }
}

function buildCollaboratorProgressGraph(project, width, height, showLegend) {
  const history = Array.isArray(project.wordCountHistory) ? project.wordCountHistory : [];
  if (history.length < 2) {
    return '<p class="collab-empty" style="padding:10px;text-align:center">Waiting for more data...</p>';
  }

  const padding = 20;
  const palette = ["#e11d48", "#0ea5e9", "#16a34a", "#f59e0b", "#7c3aed", "#f97316"];
  const times = history.map((entry) => new Date(entry.timestamp).getTime());
  const counts = history.map((entry) => Number(entry.count || 0));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  const timeRange = maxTime - minTime || 1;
  const countRange = maxCount - minCount || 1;
  const memberMeta = getCollaboratorGraphMeta(project);
  const grouped = history.reduce((acc, entry) => {
    const key = entry.uid || "owner";
    (acc[key] = acc[key] || []).push(entry);
    return acc;
  }, {});
  const legend = [];

  const getX = (timestamp) => (((new Date(timestamp).getTime() - minTime) / timeRange) * (width - 2 * padding)) + padding;
  const getY = (count) => height - ((((count - minCount) / countRange) * (height - 2 * padding)) + padding);

  const linesMarkup = Object.entries(grouped).map(([uid, entries], index) => {
    const color = palette[index % palette.length];
    const meta = memberMeta[uid] || { label: entryUserLabel(entries[0]), color };
    legend.push({ label: meta.label, color });
    const pathData = buildSmoothGraphPath(entries.map((entry) => ({
      x: getX(entry.timestamp),
      y: getY(Number(entry.count || 0))
    })));

    const pointsMarkup = entries.map((entry) => `
      <circle cx="${getX(entry.timestamp)}" cy="${getY(Number(entry.count || 0))}" r="3.5" fill="${color}">
        <title>${escapeHtml(meta.label)} • ${Number(entry.count || 0).toLocaleString()} words • ${new Date(entry.timestamp).toLocaleString()}</title>
      </circle>
    `).join("");

    return `
      <path d="${pathData}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
      ${pointsMarkup}
    `;
  }).join("");

  return `
    <div class="collab-progress-graph">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="graph-axis"></line>
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="graph-axis"></line>
        ${linesMarkup}
      </svg>
      ${showLegend ? `
        <div class="collab-progress-legend">
          ${legend.map((item) => `
            <span class="collab-progress-key">
              <span class="collab-progress-key-swatch" style="background:${item.color};"></span>
              <span>${escapeHtml(item.label)}</span>
            </span>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function getCollaboratorGraphMeta(project) {
  const meta = {};
  if (project.ownerId) {
    meta[project.ownerId] = {
      label: project.ownerName || project.ownerEmail || "Owner"
    };
  }
  Object.entries(project.collaborators || {}).forEach(([uid, collaborator]) => {
    meta[uid] = {
      label: collaborator.name || collaborator.email || "Collaborator"
    };
  });
  return meta;
}

function entryUserLabel(entry) {
  return entry?.userName || "Collaborator";
}

function buildCollaboratorContributionSummary(project) {
  const palette = ["#e11d48", "#0ea5e9", "#16a34a", "#f59e0b", "#7c3aed", "#f97316"];
  const history = Array.isArray(project.wordCountHistory) ? [...project.wordCountHistory] : [];
  const memberMeta = getCollaboratorGraphMeta(project);
  const totals = new Map();
  const orderedUids = [...new Set(history.map((entry) => entry.uid || "owner"))];

  for (let index = 1; index < history.length; index += 1) {
    const current = history[index];
    const previous = history[index - 1];
    const delta = Math.max(0, Number(current.count || 0) - Number(previous.count || 0));
    const uid = current.uid || "owner";
    totals.set(uid, (totals.get(uid) || 0) + delta);
  }

  const overall = [...totals.values()].reduce((sum, value) => sum + value, 0) || 0;

  return [...totals.entries()]
    .map(([uid, words]) => ({
      uid,
      words,
      color: palette[Math.max(0, orderedUids.indexOf(uid)) % palette.length],
      label: memberMeta[uid]?.label || "Collaborator",
      share: overall ? Math.round((words / overall) * 100) : 0
    }))
    .sort((a, b) => b.words - a.words);
}

function buildCompletionMetrics(current, targets) {
  const items = [
    { key: "scenes", label: "Scenes", current: current.scenes, target: Number(targets.scenes || 0) },
    { key: "pages", label: "Pages", current: current.pages, target: Number(targets.pages || 0) },
    { key: "lines", label: "Lines", current: current.lines, target: Number(targets.lines || 0) }
  ].map((item) => {
    const percent = item.target > 0 ? Math.min(100, Math.round((item.current / item.target) * 100)) : null;
    return {
      ...item,
      percent,
      value: item.target > 0
        ? `${item.current}${item.key === "pages" ? "" : ""} / ${item.target} • ${percent}%`
        : `${item.current} current • no target`
    };
  });

  const withTargets = items.filter((item) => item.percent !== null);
  const overall = withTargets.length
    ? Math.round(withTargets.reduce((sum, item) => sum + item.percent, 0) / withTargets.length)
    : 0;

  return { items, overall };
}

function buildProofreadSection(title, items, formatter) {
  if (!items.length) {
    return "";
  }

  return `
    <section class="proofread-report-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="list-stack">
        ${items.map((item) => {
          const formatted = formatter(item);
          return `
            <div class="list-item proofread-report-item" role="button" tabindex="0" data-proofread-line-id="${escapeHtml(item.line.id)}">
              <span class="proofread-report-head">
                <span class="list-item-title">${escapeHtml(formatted.title)}</span>
                <span class="proofread-report-ref">${escapeHtml(formatted.ref || "")}</span>
              </span>
              ${formatted.tags?.length ? `
                <span class="proofread-report-tags">
                  ${formatted.tags.map((tag) => `<span class="proofread-report-tag">${escapeHtml(tag)}</span>`).join("")}
                </span>
              ` : ""}
              <span class="list-item-meta">${escapeHtml(formatted.note)}</span>
              ${Number.isInteger(formatted.correctionIndex) ? `<span class="proofread-report-actions"><label class="proofread-report-select"><input type="checkbox" data-proofread-select="${formatted.correctionIndex}" checked><span>Select</span></label><button class="ghost-button btn-sm" type="button" data-proofread-correction-action="true" data-proofread-correction-index="${formatted.correctionIndex}">Accept Correction</button></span>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function buildProofreadReference(project, lineId) {
  const lineIndex = project.lines.findIndex((line) => line.id === lineId);
  if (lineIndex === -1) {
    return "Script reference";
  }

  const sceneIndex = findSceneIndexForLine(project, lineIndex);
  const sceneNumber = sceneIndex >= 0 ? countScenesThroughIndex(project, sceneIndex) : 1;
  const sceneHeading = sceneIndex >= 0
    ? normalizeLineText(project.lines[sceneIndex].text, "scene") || `Scene ${sceneNumber}`
    : "No scene heading";

  return `Scene ${sceneNumber} • Line ${lineIndex + 1} • ${sceneHeading}`;
}

function cleanEmptyLinesFromProject(project) {
  const originalLength = project.lines.length;
  project.lines = project.lines.filter((line) => {
    if (!line) {
      return false;
    }
    if (line.type === "image") {
      return true;
    }
    return Boolean(String(line.text || "").trim());
  });

  if (!project.lines.length) {
    project.lines = [{ id: `line-${Date.now()}`, type: "action", text: "" }];
  }

  return Math.max(0, originalLength - project.lines.length);
}

function isUncapitalizedCharacterCue(line) {
  if (!line || line.type !== "character" || !String(line.text || "").trim()) {
    return false;
  }

  const normalized = normalizeLineText(line.text, "character");
  if (!/[A-Za-z]/.test(normalized)) {
    return false;
  }

  return normalized !== normalized.toUpperCase();
}

function findNarrativeCharacterCapsIssues(project) {
  const characterNames = getCharacterNamesForCaps(project);
  if (!characterNames.length) {
    return [];
  }

  const issues = [];
  project.lines.forEach((line, index) => {
    if (!line || ["character", "dual", "dialogue", "parenthetical", "image"].includes(line.type)) {
      return;
    }

    const text = String(line.text || "");
    characterNames.forEach((name) => {
      const issue = findCharacterNameCaseIssue(text, name);
      if (issue) {
        issues.push({
          line,
          index,
          name,
          matchedText: issue
        });
      }
    });
  });

  return issues;
}

function getCharacterNamesForCaps(project) {
  return [...new Set(project.lines
    .filter((line) => ["character", "dual"].includes(line.type) && String(line.text || "").trim())
    .map((line) => normalizeLineText(line.text, "character"))
    .filter((name) => /[A-Z]/.test(name))
    .map((name) => name.toUpperCase())
  )];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findCharacterNameCaseIssue(text, characterName) {
  const parts = String(characterName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "";
  }

  const pattern = new RegExp(`\\b${parts.map((part) => escapeRegExp(part)).join("\\s+")}\\b`, "gi");
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    if (match[0] !== match[0].toUpperCase()) {
      return match[0];
    }
  }

  return "";
}

function applyProofreadCorrections(project, corrections) {
  let applied = 0;
  corrections.forEach((correction) => {
    const line = project.lines.find((entry) => entry.id === correction?.lineId);
    if (!line) {
      return;
    }

    if (correction.mode === "character-cue-caps") {
      const normalized = normalizeLineText(line.text, "character");
      const nextText = normalized.toUpperCase();
      if (nextText && nextText !== line.text) {
        line.text = nextText;
        applied += 1;
      }
      return;
    }

    if (correction.mode === "narrative-character-caps" && correction.from && correction.to) {
      const pattern = new RegExp(`\\b${escapeRegExp(correction.from)}\\b`);
      const nextText = String(line.text || "").replace(pattern, correction.to);
      if (nextText !== line.text) {
        line.text = nextText;
        applied += 1;
      }
    }
  });

  return applied;
}

function buildProofreadCorrectionKey(correction) {
  return JSON.stringify({
    mode: correction?.mode || "",
    lineId: correction?.lineId || "",
    from: correction?.from || "",
    to: correction?.to || ""
  });
}

function markProofreadCorrectionsApplied(container, corrections, correctionKeyMap) {
  corrections.forEach((correction) => {
    const index = correctionKeyMap.get(buildProofreadCorrectionKey(correction));
    if (!Number.isInteger(index)) {
      return;
    }
    const actionButton = container.querySelector(`[data-proofread-correction-index="${index}"]`);
    if (actionButton) {
      actionButton.textContent = "Corrected";
      actionButton.disabled = true;
    }
    const checkbox = container.querySelector(`[data-proofread-select="${index}"]`);
    if (checkbox) {
      checkbox.checked = false;
      checkbox.disabled = true;
    }
    const card = actionButton?.closest(".proofread-report-item") || checkbox?.closest(".proofread-report-item");
    card?.classList.add("is-accepted");
  });
}

function findSceneIndexForLine(project, lineIndex) {
  for (let index = lineIndex; index >= 0; index -= 1) {
    if (project.lines[index]?.type === "scene") {
      return index;
    }
  }
  return -1;
}

function countScenesThroughIndex(project, lineIndex) {
  let count = 0;
  for (let index = 0; index <= lineIndex; index += 1) {
    if (project.lines[index]?.type === "scene") {
      count += 1;
    }
  }
  return count || 1;
}

function buildSmoothGraphPath(points) {
  if (!points.length) {
    return "";
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const controlX = (current.x + next.x) / 2;
    path += ` C ${controlX} ${current.y}, ${controlX} ${next.y}, ${next.x} ${next.y}`;
  }
  return path;
}

function getEditorStoryElementSuggestions(project) {
  const characterMap = new Map();
  const sceneMap = new Map();

  project.lines.forEach((line, index) => {
    if (line.type === "character" && line.text.trim()) {
      const name = formatLineText(line.text, "character");
      const key = name.trim().toUpperCase();
      if (!characterMap.has(key)) {
        const nearbyDialogue = project.lines.slice(index + 1, index + 4).find((entry) => entry.type === "dialogue" && entry.text.trim());
        characterMap.set(key, {
          name,
          description: nearbyDialogue ? `Voice sample: ${nearbyDialogue.text.trim()}` : "Add traits, motivation, and relationship notes."
        });
      }
    }

    if (line.type === "scene" && line.text.trim()) {
      const sceneName = formatLineText(line.text, "scene");
      const key = sceneName.trim().toUpperCase();
      if (!sceneMap.has(key)) {
        const firstBeat = getSceneFirstLine(project, index);
        sceneMap.set(key, {
          name: sceneName,
          description: firstBeat || "Add the dramatic purpose and key beats for this scene."
        });
      }
    }
  });

  return {
    characters: [...characterMap.values()],
    scenes: [...sceneMap.values()],
    locations: [...sceneMap.values()].map((scene) => ({
      name: scene.name.split(" - ")[0],
      description: `Location inspired by scene: ${scene.name}`
    })),
    themes: []
  };
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

let _modalEpoch = 0;

export function showModal({
    title,
    message,
    showInput = false,
    defaultValue = "",
    confirmLabel = t("modal.ok"),
    cancelLabel = t("modal.cancel"),
    showCancel = true,
    showConfirm = true,
    contentClass = ""
}) {
    return new Promise((resolve) => {
        const myEpoch = ++_modalEpoch;

        modalRefs.title.textContent = title;
        const content = modalRefs.dialog?.querySelector(".modal-content");
        if (content) {
            content.className = ["modal-content", contentClass].filter(Boolean).join(" ");
        }
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

        let closeListenerTimer;
        const cleanup = () => {
            clearTimeout(closeListenerTimer);
            if (content) {
                content.className = "modal-content";
            }
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
            // The dialog's close event fires as an async task. If a new modal was
            // opened between the close() call and this handler firing, this is a
            // stale event — clean up stale listeners but don't close the new modal.
            if (myEpoch !== _modalEpoch) {
                cleanup();
                resolve(showInput ? null : false);
                return;
            }
            cleanup();
            if (modalRefs.dialog.open) {
                modalRefs.dialog.close();
            }
            resolve(showInput ? null : false);
        };

        modalRefs.confirmBtn.addEventListener("click", onConfirm);
        modalRefs.cancelBtn.addEventListener("click", onCancel);

        // Register the close listener in the next task so stale close events
        // queued by a previous dialog.close() call are already dispatched and
        // handled before our listener is attached.
        closeListenerTimer = setTimeout(() => {
            if (myEpoch === _modalEpoch) {
                modalRefs.dialog.addEventListener("close", onCancel, { once: true });
            }
        }, 0);

        modalRefs.dialog.showModal();
        if (showInput) {
            modalRefs.input.focus();
            modalRefs.input.select();
        }
    });
}

export async function customAlert(message, title = t("modal.alert")) {
    return showModal({ title, message, showCancel: false });
}

export async function customConfirm(message, title = t("modal.confirm")) {
    return showModal({ title, message });
}

export async function customPrompt(message, defaultValue = "", title = t("modal.prompt")) {
    return showModal({ title, message, showInput: true, defaultValue });
}

// Global script identity update listener
window.addEventListener('scriptIdUpdated', () => {
    renderCurrentScriptId();
    renderHome();
});
