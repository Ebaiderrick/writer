import { state, DEFAULT_SUGGESTIONS } from './config.js';
import { refs } from './dom.js';
import {
  getCurrentProject, getLine, getLineIndex, queueSave,
  getSuggestedNextSpeaker
} from './project.js';
import {
  normalizeLineText, selectTextSuffix, placeCaretAtEnd,
  selectElementText, buildContinuedSceneSuggestions, formatLineText
} from './utils.js';
import { createTextNode as createUINode } from './utils.js';
import { getTypeLabel, t } from './i18n.js';
import {
  buildProjectLexicon, buildSpellingIssues, buildGrammarIssues, clearSpellingHighlights,
  hasLanguageDictionary, renderSpellingIssues
} from './spelling.js';

export function renderEditor() {
  const project = getCurrentProject();
  if (!project) return;
  refs.screenplayEditor.innerHTML = "";
  const template = document.querySelector("#blockTemplate");
  const filterSet = buildVisibleFilterSet(project);
  const spellingLexicon = state.grammarCheck && hasLanguageDictionary(state.writingLanguage)
    ? buildProjectLexicon(project, state.writingLanguage)
    : null;
  let currentSceneId = "";
  let collapsedSceneId = "";
  let visibleRows = 0;
  let sceneNumber = 0;

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
      sceneNumber++;
      currentSceneId = line.id;
      const isCollapsed = project.collapsedSceneIds.includes(line.id);
      collapsedSceneId = isCollapsed ? line.id : "";
      toggle.hidden = false;
      toggle.innerHTML = isCollapsed ? "&#9654;" : "&#9660;";
      toggle.title = isCollapsed ? "Expand scene" : "Collapse scene";
      toggle.setAttribute("aria-label", isCollapsed ? "Expand scene" : "Collapse scene");
    } else {
      toggle.hidden = true;
    }

    row.dataset.sceneOwner = currentSceneId;
    row.dataset.type = line.type;
    const label = getTypeLabel(line.type);
    tag.textContent = (state.autoNumberScenes && line.type === "scene") ? `${sceneNumber}. ${label}` : label;
    block.dataset.id = line.id;
    block.dataset.type = line.type;
    block.spellcheck = state.grammarCheck;
    block.setAttribute("spellcheck", state.grammarCheck ? "true" : "false");
    block.setAttribute("autocorrect", state.grammarCheck ? "on" : "off");
    block.setAttribute("autocapitalize", state.grammarCheck ? "sentences" : "off");
    renderBlockContent(block, line, project, spellingLexicon);

    if (line.secondary !== undefined) {
      row.classList.add("is-dual");
      block.classList.add("dual-primary");

      const secBlock = document.createElement("div");
      secBlock.className = "script-block dual-secondary";
      secBlock.contentEditable = "true";
      secBlock.spellcheck = state.grammarCheck;
      secBlock.setAttribute("spellcheck", state.grammarCheck ? "true" : "false");
      secBlock.setAttribute("autocorrect", state.grammarCheck ? "on" : "off");
      secBlock.setAttribute("autocapitalize", state.grammarCheck ? "sentences" : "off");
      secBlock.dataset.id = line.id;
      secBlock.dataset.type = line.type;
      secBlock.dataset.secondary = "true";
      renderBlockContent(secBlock, { ...line, text: line.secondary }, project, spellingLexicon);

      const columns = document.createElement("div");
      columns.className = "dual-columns";
      block.replaceWith(columns);
      columns.appendChild(block);
      columns.appendChild(secBlock);
    }

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
    refs.screenplayEditor.appendChild(createUINode(t("editor.noMatches", { query: state.filterQuery })));
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
  return `${getTypeLabel(line.type)} ${normalizeLineText(line.text, line.type)}`.toLowerCase();
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
  clearSuggestionContext();
  clearSpellingHighlights(refs.screenplayEditor);
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
  refs.activeModeLabel.textContent = "";
  refs.activeModeLabel.title = t("editor.activeBlockTitle", { type: getTypeLabel(state.activeType || "action") || getTypeLabel("action") });
}

export function updateSuggestions() {
  const line = getLine(state.activeBlockId);
  const type = line?.type || state.activeType;
  const suggestions = buildSuggestions(type, line?.text || "");
  renderSuggestionTray(t("editor.suggestions", { type: getTypeLabel(type) }), suggestions, getActiveBlockSuggestionAnchor());
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
      .filter((value) => !trimmed || value.toUpperCase().includes(trimmed))
      .map((value) => ({ label: formatLineText(value, "character"), value }));
  }

  if (type === "scene") {
    const sceneHeadings = project.lines
      .filter((line) => line.type === "scene" && line.text.trim())
      .map((line) => normalizeLineText(line.text, "scene").toUpperCase());
    const previousScene = getPreviousSceneHeading(getLineIndex(state.activeBlockId));
    const carryOvers = previousScene ? buildContinuedSceneSuggestions(previousScene) : [];
    return [...new Set([...DEFAULT_SUGGESTIONS.scene, ...carryOvers, ...sceneHeadings])]
      .filter((value) => !trimmed || value.toUpperCase().includes(trimmed))
      .map((value) => ({ label: formatLineText(value, "scene"), value }));
  }

  if (type === "transition") {
    return [...new Set(DEFAULT_SUGGESTIONS.transition)]
      .filter((value) => !trimmed || value.includes(trimmed))
      .map((value) => ({ label: formatLineText(value, "transition"), value }));
  }

  if (type === "shot" || type === "parenthetical" || type === "note" || type === "image") {
    return (DEFAULT_SUGGESTIONS[type] || [])
      .filter((value) => !trimmed || value.toUpperCase().includes(trimmed))
      .map((value) => ({
        label: type === "parenthetical" ? `(${value})` : (type === "note" ? `[${value}]` : formatLineText(value, type)),
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
  return refs.screenplayEditor.querySelector(`.script-block[data-id="${state.activeBlockId}"]:not([data-secondary])`);
}

export function focusSecondaryBlock(lineId) {
  const el = refs.screenplayEditor.querySelector(`.script-block[data-id="${lineId}"][data-secondary="true"]`);
  if (!el) return;
  setActiveBlock(lineId);
  el.focus();
  placeCaretAtEnd(el);
}

export function clearSuggestionContext() {
  state.suggestionContext = null;
}

export function showSpellingSuggestions(context, anchor = null) {
  state.suggestionContext = context;
  renderSuggestionTray(
    t("editor.spellingSuggestions", { word: context.word }),
    context.suggestions.map((value) => ({ label: value, value })),
    anchor
  );
}

export function refreshEditableBlockDisplay(block, line = getLine(block?.dataset?.id), project = getCurrentProject()) {
  if (!block || !line) {
    return;
  }
  const spellingLexicon = state.grammarCheck && hasLanguageDictionary(state.writingLanguage)
    ? buildProjectLexicon(project, state.writingLanguage)
    : null;
  renderBlockContent(block, line, project, spellingLexicon);
}

function renderBlockContent(block, line, project, spellingLexicon = null) {
  if (line.type === "image" && line.text.startsWith("IMAGE: data:")) {
    block.replaceChildren();
    const img = document.createElement("img");
    img.src = line.text.slice("IMAGE: ".length);
    img.className = "image-block-preview";
    block.appendChild(img);
    return;
  }

  if (!state.grammarCheck || !hasLanguageDictionary(state.writingLanguage)) {
    block.textContent = line.text;
    return;
  }

  const lexicon = spellingLexicon || buildProjectLexicon(project, state.writingLanguage);
  const spelling = buildSpellingIssues(line.text, {
    language: state.writingLanguage,
    project,
    lexicon
  });
  const grammar = buildGrammarIssues(line.text, { language: state.writingLanguage });

  // Merge and sort; grammar takes priority over spelling for the same range
  const spellFiltered = spelling.filter(
    (s) => !grammar.some((g) => g.start === s.start && g.end === s.end)
  );
  const issues = [...spellFiltered, ...grammar].sort((a, b) => a.start - b.start);

  renderSpellingIssues(block, line.text, issues);
}

export function hideSuggestionTray(clearSuggestions = false) {
  refs.suggestionTray.hidden = true;
  refs.suggestionTray.style.left = "";
  refs.suggestionTray.style.top = "";
  if (clearSuggestions) {
    state.visibleSuggestions = [];
  }
}

function renderSuggestionTray(title, suggestions, anchor = null) {
  state.visibleSuggestions = suggestions.slice(0, 9);
  refs.suggestionList.innerHTML = "";

  if (!state.visibleSuggestions.length) {
    hideSuggestionTray(true);
    return;
  }

  refs.suggestionTray.hidden = false;
  refs.suggestionTitle.textContent = title;

  state.visibleSuggestions.forEach((suggestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item suggestion-pill";
    button.textContent = `${index + 1}. ${suggestion.label}`;
    button.dataset.suggestionValue = suggestion.value;
    refs.suggestionList.appendChild(button);
  });

  positionSuggestionTray(anchor);
}

function positionSuggestionTray(anchor = null) {
  if (refs.suggestionTray.hidden) {
    return;
  }

  const tray = refs.suggestionTray;
  const resolved = anchor || getActiveBlockSuggestionAnchor();
  const margin = 12;
  tray.style.visibility = "hidden";

  const trayWidth = tray.offsetWidth || 240;
  const trayHeight = tray.offsetHeight || 120;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = margin;
  let top = margin;

  if (resolved?.rect) {
    const { rect } = resolved;
    const rightAligned = rect.right + margin;
    const leftAligned = rect.left - trayWidth - margin;
    left = rightAligned + trayWidth <= viewportWidth - margin
      ? rightAligned
      : Math.max(margin, leftAligned);
    top = rect.top;
  } else if (Number.isFinite(resolved?.x) && Number.isFinite(resolved?.y)) {
    left = resolved.x + 6;
    top = resolved.y + 6;
  }

  left = Math.max(margin, Math.min(left, viewportWidth - trayWidth - margin));
  top = Math.max(margin, Math.min(top, viewportHeight - trayHeight - margin));

  tray.style.left = `${left}px`;
  tray.style.top = `${top}px`;
  tray.style.visibility = "";
}

function getActiveBlockSuggestionAnchor() {
  const block = getActiveEditableBlock();
  if (!block) {
    return null;
  }

  return getCaretSuggestionAnchor(block) || { rect: block.getBoundingClientRect() };
}

function getCaretSuggestionAnchor(block) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (getBlockFromNode(range.startContainer) !== block || getBlockFromNode(range.endContainer) !== block) {
    return null;
  }

  const anchorRange = range.cloneRange();
  anchorRange.collapse(false);
  const rect = getRangeRect(anchorRange) || getAdjacentTextRect(anchorRange);

  if (!rect) {
    return null;
  }

  return { x: rect.left, y: rect.bottom };
}

function getAdjacentTextRect(range) {
  const container = range.startContainer;
  const offset = range.startOffset;

  if (container.nodeType === Node.TEXT_NODE) {
    const textLength = container.textContent?.length || 0;
    if (offset < textLength) {
      const forwardRange = document.createRange();
      forwardRange.setStart(container, offset);
      forwardRange.setEnd(container, Math.min(textLength, offset + 1));
      return getRangeRect(forwardRange);
    }

    if (offset > 0) {
      const backwardRange = document.createRange();
      backwardRange.setStart(container, offset - 1);
      backwardRange.setEnd(container, offset);
      return getRangeRect(backwardRange);
    }

    return null;
  }

  const nearbyNode = container.childNodes[offset] || container.childNodes[offset - 1];
  if (nearbyNode?.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const textLength = nearbyNode.textContent?.length || 0;
  if (!textLength) {
    return null;
  }

  const probeRange = document.createRange();
  if (container.childNodes[offset]) {
    probeRange.setStart(nearbyNode, 0);
    probeRange.setEnd(nearbyNode, 1);
  } else {
    probeRange.setStart(nearbyNode, textLength - 1);
    probeRange.setEnd(nearbyNode, textLength);
  }

  return getRangeRect(probeRange);
}

function getRangeRect(range) {
  if (!range) {
    return null;
  }

  const rects = Array.from(range.getClientRects()).filter(isUsableRect);
  if (rects.length) {
    return rects[rects.length - 1];
  }

  const rect = range.getBoundingClientRect();
  return isUsableRect(rect) ? rect : null;
}

function isUsableRect(rect) {
  return Boolean(rect && (rect.width || rect.height));
}

function getBlockFromNode(node) {
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return element?.closest?.(".script-block") || null;
}
