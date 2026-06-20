import { PAGE_UNIT_CAPACITY } from './config.js';
import { stripWrapperChars } from './utils.js';

/**
 * Paginates screenplay lines into pages based on line capacity and screenplay-aware blocks.
 * Groups dialogue runs together so pages are filled more naturally and only splits speech
 * when a block genuinely cannot fit on the current page.
 */
export function paginateScriptLines(lines) {
  const blocks = buildPaginationBlocks(lines);
  const pages = [];
  let currentPage = [];
  let usedUnits = 0;

  const flushPage = () => {
    if (!currentPage.length) return;
    pages.push(currentPage);
    currentPage = [];
    usedUnits = 0;
  };

  for (const block of blocks) {
    if (!block.lines.length) continue;

    if (block.kind === 'speech') {
      const handled = placeSpeechBlock(block, {
        currentPage,
        usedUnits,
        pages,
        flushPage
      });
      currentPage = handled.currentPage;
      usedUnits = handled.usedUnits;
      continue;
    }

    if (currentPage.length > 0 && usedUnits + block.units > PAGE_UNIT_CAPACITY) {
      flushPage();
    }

    for (const line of block.lines) {
      currentPage.push({ ...line });
    }
    usedUnits += block.units;
  }

  flushPage();
  return pages;
}

function buildPaginationBlocks(lines) {
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i += 1;
      continue;
    }

    if (line.type === 'character') {
      const speechLines = [{ ...line }];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (!next) {
          j += 1;
          continue;
        }
        if (next.type === 'parenthetical' || next.type === 'dialogue') {
          speechLines.push({ ...next });
          j += 1;
          continue;
        }
        break;
      }
      blocks.push({
        kind: 'speech',
        lines: speechLines,
        units: sumBlockUnits(speechLines)
      });
      i = j;
      continue;
    }

    blocks.push({
      kind: 'line',
      lines: [{ ...line }],
      units: estimateLineUnits(line.type, line.displayText)
    });
    i += 1;
  }

  return blocks;
}

function placeSpeechBlock(block, state) {
  let currentPage = state.currentPage;
  let usedUnits = state.usedUnits;
  const { pages, flushPage } = state;

  const speechLines = block.lines.map((line) => ({ ...line }));
  const startUnits = estimateSpeechStartUnits(speechLines);

  if (currentPage.length > 0 && usedUnits + startUnits > PAGE_UNIT_CAPACITY) {
    flushPage();
    currentPage = [];
    usedUnits = 0;
  }

  let queue = speechLines;
  while (queue.length) {
    const remainingUnits = PAGE_UNIT_CAPACITY - usedUnits;
    const queueUnits = sumBlockUnits(queue);

    if (queueUnits <= remainingUnits) {
      for (const line of queue) {
        currentPage.push({ ...line });
      }
      usedUnits += queueUnits;
      queue = [];
      break;
    }

    const split = splitSpeechLines(queue, remainingUnits);
    if (split.fitLines.length) {
      for (const line of split.fitLines) {
        currentPage.push({ ...line });
      }
      usedUnits += split.fitUnits;
      if (split.remainingLines.length) {
        currentPage.push({ type: 'dialogue', displayText: '(MORE)' });
        usedUnits += estimateLineUnits('dialogue', '(MORE)');
      }
      flushPage();
      currentPage = [];
      usedUnits = 0;
      if (split.remainingLines.length) {
        const speaker = stripContd(split.speaker);
        queue = [
          { type: 'character', displayText: `${speaker} (CONT'D)` },
          ...split.remainingLines
        ];
      } else {
        queue = [];
      }
      continue;
    }

    if (currentPage.length === 0) {
      for (const line of queue) {
        currentPage.push({ ...line });
      }
      usedUnits += queueUnits;
      queue = [];
      break;
    }

    flushPage();
    currentPage = [];
    usedUnits = 0;
  }

  return { currentPage, usedUnits, pages };
}

function splitSpeechLines(lines, availableUnits) {
  const speaker = lines[0]?.displayText || '';
  const fitLines = [];
  let fitUnits = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const units = estimateLineUnits(line.type, line.displayText);
    const reserveForMore = index < lines.length - 1 ? estimateLineUnits('dialogue', '(MORE)') : 0;
    if (fitLines.length > 0 && fitUnits + units + reserveForMore > availableUnits) {
      break;
    }
    if (fitLines.length === 0 && units > availableUnits) {
      break;
    }
    fitLines.push({ ...line });
    fitUnits += units;
    index += 1;
  }

  return {
    speaker,
    fitLines,
    fitUnits,
    remainingLines: lines.slice(index).map((line) => ({ ...line }))
  };
}

function estimateSpeechStartUnits(lines) {
  if (!lines.length) return 0;
  let units = estimateLineUnits(lines[0].type, lines[0].displayText);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.type === 'parenthetical') {
      units += Math.min(0.8, estimateLineUnits(line.type, line.displayText));
      continue;
    }
    if (line.type === 'dialogue') {
      units += Math.min(1.3, estimateLineUnits(line.type, line.displayText));
    }
    break;
  }
  return units;
}

function sumBlockUnits(lines) {
  return lines.reduce((total, line) => total + estimateLineUnits(line.type, line.displayText), 0);
}

/**
 * Estimates the vertical "units" (lines) a script element occupies.
 */
export function estimateLineUnits(type, text) {
  const compact = stripWrapperChars(text);

  let width = 68;
  if (type === 'dialogue') width = 46;
  if (type === 'parenthetical') width = 30;
  if (type === 'character') width = 32;
  if (type === 'transition') width = 32;
  if (type === 'dual') width = 32;

  const wrappedLines = Math.max(1, Math.ceil(compact.length / width));
  const breathingRoom = (type === 'scene' || type === 'transition') ? 0.05 : 0.0;
  return wrappedLines + breathingRoom;
}

function stripContd(text) {
  return text.replace(/\s*\(CONT'D\)\s*$/i, '').trim();
}
