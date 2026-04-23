import { state } from "./config.js";
import { AI } from "./ai.js";
import { findInScript, intelligentSplit } from "./events.js";
import { getActiveEditableBlock } from "./editor.js";

export const ContextMenu = (() => {
  let menuEl = null;

  function init() {
    menuEl = document.getElementById("contextMenu");
    document.addEventListener("click", hide);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);

    menuEl.addEventListener("click", (e) => {
      const item = e.target.closest(".menu-item");
      if (!item || item.classList.contains("has-submenu")) return;

      const action = item.dataset.action;
      handleAction(action);
      hide();
    });
  }

  function show(x, y) {
    if (!menuEl) return;

    menuEl.hidden = false;
    menuEl.style.display = "block";

    // Position menu
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const menuW = menuEl.offsetWidth;
    const menuH = menuEl.offsetHeight;

    let left = x;
    let top = y;

    if (x + menuW > winW) {
      left = winW - menuW - 10;
      menuEl.classList.add("overflow-right");
    } else {
      menuEl.classList.remove("overflow-right");
    }

    if (y + menuH > winH) {
      top = winH - menuH - 10;
    }

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  function hide() {
    if (menuEl) {
      menuEl.hidden = true;
      menuEl.style.display = "none";
    }
  }

  function handleAction(action) {
    switch (action) {
      case "cut":
        document.execCommand("cut");
        break;
      case "copy":
        document.execCommand("copy");
        break;
      case "paste":
        navigator.clipboard.readText().then(text => {
          document.execCommand("insertText", false, text);
        }).catch(err => {
          console.error("Failed to read clipboard:", err);
          // Fallback to native paste if possible, though execCommand('paste') is usually blocked
        });
        break;
      case "search":
        findInScript();
        break;
      case "bold":
        document.execCommand("bold");
        break;
      case "italic":
        document.execCommand("italic");
        break;
      case "underline":
        document.execCommand("underline");
        break;
      case "caps-all":
        applyCapitalization("all");
        break;
      case "caps-each":
        applyCapitalization("each");
        break;
      case "caps-low":
        applyCapitalization("low");
        break;
      case "caps-random":
        applyCapitalization("random");
        break;
      case "ai-grammar":
        triggerAiGrammar();
        break;
      case "intelligent-split":
        triggerIntelligentSplit();
        break;
    }
  }

  function applyCapitalization(type) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (!text) return;

    let transformed = "";
    switch (type) {
      case "all":
        transformed = text.toUpperCase();
        break;
      case "each":
        transformed = text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        break;
      case "low":
        transformed = text.toLowerCase();
        break;
      case "random":
        transformed = text.split("").map(c => Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()).join("");
        break;
    }

    document.execCommand("insertText", false, transformed);
  }

  function triggerAiGrammar() {
    const selection = window.getSelection();
    let row = null;
    if (selection.rangeCount && selection.anchorNode) {
        row = selection.anchorNode.parentElement.closest(".script-block-row");
    }
    if (!row && state.activeBlockId) {
        row = document.querySelector(`.script-block-row[data-id="${state.activeBlockId}"]`);
    }
    if (row) {
        AI.triggerAction(row, "Grammar");
    }
  }

  function triggerIntelligentSplit() {
    const activeBlock = getActiveEditableBlock();
    if (activeBlock) {
        intelligentSplit(activeBlock);
    }
  }

  return { init, show, hide };
})();
