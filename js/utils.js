import { AUTO_UPPERCASE_TYPES, SCENE_TIMES, TYPE_SEQUENCE } from './config.js';
import { refs } from './dom.js';

export function uid(prefix = "line") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function slugify(value) {
  return (value || "eyawriter-script").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "eyawriter-script";
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function stripWrapperChars(value) {
  if (!value) return "";
  return value.replace(/[\(\)\[\]]/g, "").trim();
}

export function normalizeLineText(text, type) {
  const compact = String(text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^\s+/, "");

  if (!compact && compact !== "") {
    return "";
  }

  // If it's just spaces, we keep them for active typing feel
  if (compact.length > 0 && compact.trim() === "") {
      return compact;
  }

  if (type === "note") {
    const stripped = stripWrapperChars(compact);
    return stripped ? `[${stripped}]` : "";
  }

  if (type === "parenthetical") {
    const stripped = stripWrapperChars(compact);
    return stripped ? `(${stripped})` : "";
  }

  if (type === "image") {
    const inner = stripWrapperChars(compact);
    return inner.toUpperCase().startsWith("IMAGE:") ? inner : `IMAGE: ${inner}`;
  }

  if (AUTO_UPPERCASE_TYPES.has(type) && refs.autoCapsToggle.checked) {
    return compact.toUpperCase();
  }

  return compact;
}

export function getCaretOffset(element) {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
}

export function setCaretOffset(element, offset) {
  const selection = window.getSelection();
  const range = document.createRange();
  let currentOffset = 0;
  let found = false;

  function traverse(node) {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (currentOffset + node.length >= offset) {
        range.setStart(node, offset - currentOffset);
        range.setEnd(node, offset - currentOffset);
        found = true;
      } else {
        currentOffset += node.length;
      }
    } else {
      for (let child of node.childNodes) {
        traverse(child);
      }
    }
  }

  traverse(element);
  if (!found) {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function placeCaretAtEnd(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function selectElementText(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function createTextNode(message) {
  const node = document.createElement("p");
  node.textContent = message;
  node.style.margin = "0";
  node.style.color = "#7a7a74";
  return node;
}

export function selectTextSuffix(element, startOffset, endOffset) {
  const selection = window.getSelection();
  const range = document.createRange();
  const textNode = element.firstChild;
  if (!textNode) {
    return;
  }
  range.setStart(textNode, clamp(startOffset, 0, textNode.length));
  range.setEnd(textNode, clamp(endOffset, 0, textNode.length));
  selection.removeAllRanges();
  selection.addRange(range);
}

export function buildContinuedSceneSuggestions(previousScene) {
  const base = sceneBase(previousScene);
  if (!base) {
    return [];
  }
  return SCENE_TIMES.map((time) => `${base} - ${time}`);
}

export function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function parseTextToLines(text) {
  const rawLines = text.replace(/\r\n/g, "\n").split(/\n{1,2}/).map((line) => line.trim()).filter(Boolean);
  return rawLines.map((line, index) => ({
    id: uid(),
    type: inferTypeFromText(line, rawLines[index - 1] || "", rawLines[index + 1] || ""),
    text: line
  }));
}

export function inferTypeFromText(line, prevLine, nextLine) {
  if (/^(INT\.|EXT\.|INT\/EXT\.|INT\.\/EXT\.|EST\.)/i.test(line)) return "scene";
  if (/^(CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|FADE OUT\.)/i.test(line)) return "transition";
  if (/^\(.*\)$/.test(line)) return "parenthetical";
  if (/^\[.*\]$/.test(line)) return "note";
  if (/^(CLOSE ON|WIDE SHOT|INSERT|POV|OVERHEAD SHOT)/i.test(line)) return "shot";
  if (/^IMAGE:/i.test(line)) return "image";
  if (looksLikeCharacter(line, prevLine, nextLine)) return "character";
  if (prevLine && looksLikeCharacter(prevLine, "", line)) return "dialogue";
  return "action";
}

function looksLikeCharacter(line, prevLine, nextLine) {
  if (!line || line.length > 32 || /:/.test(line) || /\.$/.test(line)) {
    return false;
  }
  const isUppercase = line === line.toUpperCase();
  const followedByDialogue = nextLine && !/^(INT\.|EXT\.|CUT TO:|\[|IMAGE:)/i.test(nextLine);
  const separated = !prevLine || /^(INT\.|EXT\.|\[|CUT TO:|FADE OUT\.)/i.test(prevLine);
  return isUppercase && (followedByDialogue || separated);
}

function sceneBase(heading) {
  const match = heading.match(/^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.)\s*(.*?)(?:\s*-\s*[A-Z'\/. ]+)?$/i);
  if (!match) {
    return heading;
  }
  const prefix = match[1].toUpperCase().replace("INT/EXT.", "INT./EXT.");
  const location = match[2].trim();
  return location ? `${prefix} ${location.toUpperCase()}` : prefix;
}
