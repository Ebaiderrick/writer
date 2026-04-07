import { state } from './state.js';
import { TYPE_SEQUENCE, TYPE_LABELS, DEFAULT_SUGGESTIONS, SCENE_TIMES, AUTO_UPPERCASE_TYPES } from './constants.js';
import { stripWrapperChars } from './pagination.js'; // Assuming it's there
import { placeCaretAtEnd, selectTextSuffix, clamp } from './utils.js';

export function handleToolSelection(type, getLine, addBlock, renderStudio, focusBlock, queueSave, changeBlockType) {
  const active = getLine(state.activeBlockId);
  if (!active) {
    const newId = addBlock(type, "", -1);
    renderStudio();
    focusBlock(newId, true);
    queueSave();
    return;
  }
  changeBlockType(active.id, type);
}

export function cycleBlockType(id, getLine, changeBlockType) {
  const line = getLine(id);
  if (!line) {
    return;
  }
  const index = TYPE_SEQUENCE.indexOf(line.type);
  changeBlockType(id, TYPE_SEQUENCE[(index + 1) % TYPE_SEQUENCE.length]);
}

export function changeBlockType(id, nextType, getLine, getCurrentProject, normalizeConvertedText, renderStudio, focusBlock, queueSave) {
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

export function handleBlockInput(id, element, getLine, getCurrentProject, getCharacterAutocomplete, normalizeLineText, selectTextSuffix, placeCaretAtEnd, setActiveBlock, renderPreview, renderSceneList, renderCharacterList, renderMetrics, renderHome, updateSuggestions, queueSave) {
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

export function handleBlockKeydown(event, id, getCurrentProject, getLineIndex, inferNextType, addBlock, renderStudio, focusBlock, queueSave, cycleBlockType) {
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

export function updateSuggestions(refs, getLine, buildSuggestions, applySuggestion) {
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

export function applySuggestion(value, getLine, getCurrentProject, normalizeLineText, renderStudio, focusBlock, queueSave) {
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
