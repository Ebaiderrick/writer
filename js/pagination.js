import { PAGE_UNIT_CAPACITY } from './config.js';
import { stripWrapperChars } from './utils.js';

/**
 * Paginates screenplay lines into pages based on line capacity and industry-standard rules.
 * Handles orphan protection for character names and injects continuity markers like (MORE) and (CONT'D).
 */
export function paginateScriptLines(lines) {
  const pages = [];
  let currentPage = [];
  let usedUnits = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineUnits = estimateLineUnits(line.type, line.displayText);

    // 1. Orphan Protection for Character Names
    // A character name should not be at the bottom of a page without at least 2 lines of dialogue following.
    if (line.type === 'character') {
      let lookaheadUnits = lineUnits;
      let j = 1;
      let dialogueLinesFound = 0;

      // Look ahead to see the "speech block" (Character + Parenthetical + Dialogue)
      while (i + j < lines.length && dialogueLinesFound < 2) {
        const next = lines[i + j];
        if (next.type === 'dialogue') {
          dialogueLinesFound++;
        } else if (next.type !== 'parenthetical') {
          // If we hit a scene, action, etc. before finding 2 dialogue lines, the block ends early.
          break;
        }
        lookaheadUnits += estimateLineUnits(next.type, next.displayText);
        j++;
      }

      // If the character + at least some dialogue doesn't fit, move the whole start of the block to the next page.
      if (usedUnits + lookaheadUnits > PAGE_UNIT_CAPACITY && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        usedUnits = 0;
      }
    }

    // 2. Standard Page Break Handling
    if (currentPage.length > 0 && usedUnits + lineUnits > PAGE_UNIT_CAPACITY) {
      const lastLine = currentPage[currentPage.length - 1];

      // Split Dialogue Handling: (MORE) and (CONT'D)
      if (lastLine.type === 'dialogue' || lastLine.type === 'parenthetical' || lastLine.type === 'character') {
        // Find the active character for this speech block
        let activeCharacter = "";
        for (let k = currentPage.length - 1; k >= 0; k--) {
          if (currentPage[k].type === 'character') {
            activeCharacter = stripContd(currentPage[k].displayText);
            break;
          }
        }

        // Add (MORE) to the bottom of the current page
        const moreLine = { type: 'dialogue', displayText: '(MORE)' };
        currentPage.push(moreLine);

        pages.push(currentPage);

        // Start new page with (CONT'D)
        currentPage = [];
        usedUnits = 0;

        if (activeCharacter) {
          const contdLine = { type: 'character', displayText: `${activeCharacter} (CONT'D)` };
          currentPage.push(contdLine);
          usedUnits += estimateLineUnits(contdLine.type, contdLine.displayText);
        }
      } else {
        // Standard break for action/scene/etc.
        pages.push(currentPage);
        currentPage = [];
        usedUnits = 0;
      }
    }

    // Add the current line to the current (possibly new) page
    currentPage.push({ ...line });
    usedUnits += lineUnits;
    i++;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  // Final Pass: Add "CONTINUED:" markers for split scenes if desired.
  // (Optional: can be added here if needed, but (MORE)/(CONT'D) are primary)

  return pages;
}

/**
 * Estimates the vertical "units" (lines) a script element occupies.
 */
export function estimateLineUnits(type, text) {
  const compact = stripWrapperChars(text);

  // Character widths based on standard screenplay indentation/margins
  let width = 60; // Default (Action/Scene)
  if (type === "dialogue") width = 36;
  if (type === "parenthetical") width = 24;
  if (type === "character") width = 24;
  if (type === "transition") width = 24;
  if (type === "dual") width = 24;

  const wrappedLines = Math.max(1, Math.ceil(compact.length / width));

  // Industry standard often adds extra spacing before scenes and transitions
  const breathingRoom = (type === "scene" || type === "transition") ? 1.0 : 0.0;

  return wrappedLines + breathingRoom;
}

/**
 * Removes existing (CONT'D) markers for clean re-injection.
 */
function stripContd(text) {
  return text.replace(/\s*\(CONT'D\)\s*$/i, "").trim();
}
