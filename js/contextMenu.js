import { state } from "./config.js";
import { AI } from "./ai.js";
import { getActiveEditableBlock } from "./editor.js";

export const ContextMenu = (() => {
  let menuEl = null;
  const handlers = {};

  function init() {
    menuEl = document.getElementById("contextMenu");
    document.addEventListener("click", hide);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);

    if (menuEl) {
      menuEl.addEventListener("click", (e) => {
        const item = e.target.closest(".menu-item");
        if (!item || item.classList.contains("has-submenu")) return;

        const action = item.dataset.action;
        handleAction(action);
        hide();
      });
    }
  }

  function setHandler(action, fn) {
    handlers[action] = fn;
  }

  function show(x, y) {
    if (!menuEl) return;

    menuEl.hidden = false;
    menuEl.style.display = "block";

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
    // If a custom handler is registered, use it
    if (handlers[action]) {
      handlers[action]();
      return;
    }

    // Default handlers
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
        });
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
    }
  }

  function applyCapitalization(type) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

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
    const activeId = state.activeBlockId;
    if (activeId) {
        const row = document.querySelector(`.script-block-row[data-id="${activeId}"]`);
        if (row) AI.triggerAction(row, "Grammar");
    }
  }

  return { init, show, hide, setHandler };
})();
