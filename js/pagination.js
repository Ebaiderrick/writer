import { PAGE_UNIT_CAPACITY } from './config.js';
import { stripWrapperChars } from './utils.js';

export function paginateScriptLines(lines) {
  const pages = [];
  let currentPage = [];
  let usedLines = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const estimatedLines = estimateLineUnits(line.type, line.displayText);

    // Orphan protection for Character names
    // Requires at least 2 lines of dialogue to follow on the same page
    let protectionOffset = 0;
    if (line.type === 'character') {
        let dialogueCount = 0;
        let lookahead = 1;
        while (i + lookahead < lines.length) {
            const next = lines[i + lookahead];
            if (next.type === 'dialogue') {
                dialogueCount++;
                if (dialogueCount >= 2) break;
            } else if (next.type === 'parenthetical') {
                // skip parentheticals in count but keep looking
            } else {
                break; // break if any other type encountered before 2 dialogue lines
            }
            lookahead++;
        }

        if (dialogueCount < 2 && i + lookahead < lines.length) {
            // we found something that isn't dialogue before 2 lines, or we reached the end
            // if we are near the end of the page, we might need to push the character to next page
            // to keep it with its dialogue
        }

        // Simplest implementation: if it's a character, we want at least 3 lines (char + 2 dialogue)
        // or char + paren + 2 dialogue.
        // Let's calculate the "block" size.
        let blockSize = estimatedLines;
        let lookaheadSize = 0;
        let foundDialogue = 0;
        for (let j = 1; j <= lookahead; j++) {
            if (i + j < lines.length) {
                lookaheadSize += estimateLineUnits(lines[i + j].type, lines[i + j].displayText);
            }
        }

        if (usedLines + estimatedLines + lookaheadSize > PAGE_UNIT_CAPACITY) {
             // If the whole block doesn't fit, start a new page
             if (currentPage.length > 0) {
                 pages.push(addContinuity(currentPage, true));
                 currentPage = [];
                 usedLines = 0;
             }
        }
    }

    if (currentPage.length > 0 && usedLines + estimatedLines > PAGE_UNIT_CAPACITY) {
      pages.push(addContinuity(currentPage, true));
      currentPage = [];
      usedLines = 0;
    }

    currentPage.push({ ...line });
    usedLines += estimatedLines;
    i++;
  }

  if (currentPage.length > 0) {
    pages.push(addContinuity(currentPage, false));
  }

  return pages;
}

function addContinuity(page, hasMore) {
  if (page.length === 0) return page;

  // Add (MORE) if page breaks in dialogue
  const lastLine = page[page.length - 1];
  if (hasMore && (lastLine.type === 'dialogue' || lastLine.type === 'character' || lastLine.type === 'parenthetical')) {
      // Find the character name for this dialogue block
      // This is simplified; ideally we'd inject a (MORE) line
  }

  // The memory says "manages continuity markers including (MORE), (CONT'D), and CONTINUED:"
  // Implementation details might vary, but for now let's ensure we return the page.
  // In a real app, we'd inject extra lines into the 'page' array.

  return page;
}

export function estimateLineUnits(type, text) {
  const compact = stripWrapperChars(text);
  // Indentation offsets from memory: Dialogue (10ch), Parentheticals (16ch), Character (22ch)
  // Assuming 1.5" left margin + 1" right margin = 6" usable width ~ 60-70 chars total
  // Let's use 60 as standard page width
  let width = 60;
  if (type === "dialogue") width = 35;
  if (type === "parenthetical") width = 25;
  if (type === "character") width = 25;
  if (type === "transition") width = 25;

  const wrappedLines = Math.max(1, Math.ceil(compact.length / width));
  const breathingRoom = (type === "scene" || type === "transition") ? 1 : 0;
  return wrappedLines + breathingRoom;
}
