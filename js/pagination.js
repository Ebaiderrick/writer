import { PAGE_UNIT_CAPACITY } from './constants.js';

export function paginateScriptLines(lines, estimateLineUnits, stripWrapperChars, findLastSpeaker) {
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
        const speaker = findLastSpeaker(lines, i, stripWrapperChars);
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

export function findLastSpeaker(lines, currentIndex, stripWrapperChars) {
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (lines[i].type === "character") return stripWrapperChars(lines[i].displayText).replace(" (CONT'D)", "");
  }
  return "CHARACTER";
}

export function estimateLineUnits(type, text, stripWrapperChars) {
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

export function stripWrapperChars(value) {
  return value.replace(/^\[(.*)\]$/s, "$1").replace(/^\((.*)\)$/s, "$1").trim();
}
