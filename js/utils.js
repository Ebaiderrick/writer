import { DEFAULT_VIEW_OPTIONS } from './constants.js';

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

export function sanitizeViewOptions(options) {
  return {
    ruler: Boolean(options?.ruler),
    pageNumbers: options?.pageNumbers === undefined ? true : Boolean(options.pageNumbers),
    pageCount: options?.pageCount === undefined ? true : Boolean(options.pageCount),
    showOutline: options?.showOutline === undefined ? true : Boolean(options.showOutline),
    textSize: clamp(options?.textSize ?? DEFAULT_VIEW_OPTIONS.textSize, 11, 14)
  };
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

export function createTextNode(message) {
  const node = document.createElement("p");
  node.textContent = message;
  node.style.margin = "0";
  node.style.color = "#7a7a74";
  return node;
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
