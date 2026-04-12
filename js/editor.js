import { state, TYPE_LABELS, DEFAULT_SUGGESTIONS } from './config.js';
import { refs } from './dom.js';
import {
  getCurrentProject, getLine, getLineIndex, queueSave,
  getSuggestedNextSpeaker
} from './project.js';
import { toggleSceneCollapse } from './events.js';
import {
  normalizeLineText, selectTextSuffix, placeCaretAtEnd,
  selectElementText, buildContinuedSceneSuggestions
} from './utils.js';
import { createTextNode as createUINode } from './utils.js';

export function renderEditor() {
  const project = getCurrentProject();
  if (!project) return;

  // Save current selection to restore after render if possible
  const selection = window.getSelection();
  let savedOffset = 0;
  let savedId = state.activeBlockId;

  if (selection.rangeCount > 0 && selection.anchorNode) {
      const activeBlock = selection.anchorNode.closest ? selection.anchorNode.closest('.line') : selection.anchorNode.parentElement.closest('.line');
      if (activeBlock) {
          savedId = activeBlock.dataset.id;
          // We can't easily save offset across full re-renders without care
      }
  }

  refs.screenplayEditor.innerHTML = "";

  let sceneNumber = 0;
  let currentSceneId = "";
  let collapsedSceneId = "";

  project.lines.forEach((line) => {
    const div = document.createElement("div");
    div.className = `line ${line.type === 'scene' ? 'scene-heading' : line.type}`;
    div.dataset.id = line.id;
    div.dataset.type = line.type;
    div.contentEditable = "true";
    div.spellcheck = true;
    div.textContent = line.text;

    if (line.id === state.activeBlockId) {
        div.classList.add("is-active");
    }

    if (line.type === "scene") {
      sceneNumber++;
      currentSceneId = line.id;
      const isCollapsed = project.collapsedSceneIds.includes(line.id);
      collapsedSceneId = isCollapsed ? line.id : "";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "scene-toggle";
      toggle.textContent = isCollapsed ? ">" : "v";
      toggle.title = isCollapsed ? "Expand scene" : "Collapse scene";
      toggle.onclick = (e) => {
          e.stopPropagation();
          toggleSceneCollapse(line.id);
      };
      div.appendChild(toggle);

      if (state.autoNumberScenes) {
          const num = document.createElement("span");
          num.className = "scene-number-label";
          num.textContent = `${sceneNumber}. `;
          div.prepend(num);
      }
    }

    const isHidden = Boolean(collapsedSceneId && line.type !== "scene");
    if (isHidden) {
        div.style.display = "none";
    }

    refs.screenplayEditor.appendChild(div);
  });

  if (!project.lines.length && state.filterQuery.trim()) {
    refs.screenplayEditor.appendChild(createUINode(`No lines match "${state.filterQuery}".`));
  }

  updateActiveTool();
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

export function getPreviousSceneHeading(activeIndex) {
  const project = getCurrentProject();
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    if (project.lines[index]?.type === "scene" && project.lines[index].text.trim()) {
      return normalizeLineText(project.lines[index].text, "scene");
    }
  }
  return "";
}

export function setActiveBlock(id) {
  state.activeBlockId = id;
  const line = getLine(id);
  state.activeType = line?.type || "action";

  refs.screenplayEditor.querySelectorAll(".line").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.id === id);
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
    const text = (currentText || "").toUpperCase();

    // Stage 1: Initial prefix
    if (!text.trim()) {
        return [
            { label: "INT.", value: "INT. " },
            { label: "EXT.", value: "EXT. " },
            { label: "INT./EXT.", value: "INT./EXT. " }
        ];
    }

    // Stage 2: Time of day suffix
    if (text.includes(" -")) {
        const afterHyphen = text.split(" -").pop().trim();
        return ["DAY", "NIGHT", "DAWN", "DUSK", "CONT'D"]
            .filter(t => !afterHyphen || t.startsWith(afterHyphen))
            .map(t => ({ label: t, value: t }));
    }

    // Default behavior for scene headings
    const sceneHeadings = project.lines
      .filter((line) => line.type === "scene" && line.text.trim())
      .map((line) => normalizeLineText(line.text, "scene"));
    const previousScene = getPreviousSceneHeading(getLineIndex(state.activeBlockId));
    const carryOvers = previousScene ? buildContinuedSceneSuggestions(previousScene) : [];
    return [...new Set([...DEFAULT_SUGGESTIONS.scene, ...carryOvers, ...sceneHeadings])]
      .filter((value) => !trimmed || value.toUpperCase().includes(trimmed))
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
  const target = refs.screenplayEditor.querySelector(`.line[data-id="${id}"]`);
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
  return refs.screenplayEditor.querySelector(`.line[data-id="${state.activeBlockId}"]`);
}
