import { state, TYPE_LABELS, DEFAULT_SUGGESTIONS } from './config.js';
import { refs } from './dom.js';
import {
  getCurrentProject, getLine, getLineIndex, queueSave,
  getSuggestedNextSpeaker
} from './project.js';
import {
  normalizeLineText, uid, selectTextSuffix, placeCaretAtEnd,
  selectElementText, buildContinuedSceneSuggestions
} from './utils.js';
import { renderPreview } from './preview.js';
import { renderMetrics } from './ui.js';
import { createTextNode as createUINode } from './utils.js';

export function renderEditor() {
  const project = getCurrentProject();
  if (!project) return;
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

    refs.screenplayEditor.appendChild(row);
  });

  if (!visibleRows && state.filterQuery.trim()) {
    refs.screenplayEditor.appendChild(createUINode(`No lines match "${state.filterQuery}".`));
  }
}

export function buildVisibleFilterSet(project) {
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

export function getSceneIdForIndex(index, project = getCurrentProject()) {
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

export function getOwningSceneId(lineId) {
  return getSceneIdForIndex(getLineIndex(lineId));
}

export function setActiveBlock(id) {
  state.activeBlockId = id;
  state.activeType = getLine(id)?.type || "action";
  refs.screenplayEditor.querySelectorAll(".script-block-row").forEach((row) => {
    row.classList.toggle("is-active", row.dataset.id === id);
  });
  updateActiveTool();
  updateSuggestions();
}

export function updateActiveTool() {
  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.insert === state.activeType);
  });
  refs.activeModeLabel.textContent = ">";
  refs.activeModeLabel.title = `Active block: ${TYPE_LABELS[state.activeType] || "Action"}`;
}

export function updateSuggestions() {
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
    button.dataset.suggestionValue = suggestion.value;
    refs.suggestionList.appendChild(button);
  });
}

export function buildSuggestions(type, currentText) {
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

export function getCharacterAutocomplete(text, activeId) {
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

export function focusBlock(id, selectAll = false) {
  if (state.filterQuery) {
    const visibleSet = buildVisibleFilterSet(getCurrentProject());
    if (visibleSet && !visibleSet.has(id)) {
      state.filterQuery = "";
      renderEditor();
    }
  }

  const ownerSceneId = getOwningSceneId(id);
  const project = getCurrentProject();
  if (ownerSceneId && ownerSceneId !== id && project?.collapsedSceneIds.includes(ownerSceneId)) {
    project.collapsedSceneIds = project.collapsedSceneIds.filter((sceneId) => sceneId !== ownerSceneId);
    renderEditor();
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

export function getActiveEditableBlock() {
  return refs.screenplayEditor.querySelector(`.script-block[data-id="${state.activeBlockId}"]`);
}
