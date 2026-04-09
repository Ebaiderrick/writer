import { state } from './config.js';
import { getCurrentProject, getLine, getLineIndex, queueSave } from './project.js';
import { renderStudio } from './events.js';
import { uid } from './utils.js';

// ===============================
// AI ASSISTANT MODULE
// ===============================

export const AI = (() => {

  let activeBlock = null;
  let menuEl = null;
  let inputEl = null;

  // -------------------------------
  // ACTIONS PER BLOCK TYPE
  // -------------------------------
  function getActions(type) {
    switch (type) {
      case "scene":
        return ["Predict", "Expand", "Fix", "Add Conflict", "Cinematic"];
      case "dialogue":
        return ["Suggest Reply", "Rephrase", "Add Emotion", "Shorten", "Subtext"];
      case "action":
        return ["Continue", "Visualize", "Add Tension", "Describe"];
      case "shot":
        return ["Camera Angle", "Improve Shot", "Add Movement"];
      default:
        return ["Expand"];
    }
  }

  // -------------------------------
  // INIT
  // -------------------------------
  function init() {
    const editor = document.getElementById("screenplayEditor");
    if (!editor) return;

    editor.addEventListener("mouseover", handleHover);
    editor.addEventListener("focusin", handleFocus);

    document.addEventListener("click", handleOutsideClick);
  }

  // -------------------------------
  // ADD AI BUTTON
  // -------------------------------
  function addAIButton(blockRow) {
    if (!state.aiAssist) return;
    if (blockRow.querySelector(".ai-btn")) return;

    const btn = document.createElement("button");
    btn.className = "ai-btn";
    btn.innerHTML = "⚡";

    btn.style.position = "absolute";
    btn.style.right = "8px";
    btn.style.top = "6px";
    btn.style.opacity = "0.4";
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.cursor = "pointer";
    btn.style.zIndex = "10";

    btn.onmouseenter = () => btn.style.opacity = "1";
    btn.onmouseleave = () => btn.style.opacity = "0.4";

    btn.onclick = (e) => {
      e.stopPropagation();
      activeBlock = blockRow.querySelector(".script-block");
      openMenu(blockRow);
    };

    blockRow.style.position = "relative";
    blockRow.appendChild(btn);
  }

  function handleHover(e) {
    const row = e.target.closest(".script-block-row");
    if (!row) return;
    addAIButton(row);
  }

  function handleFocus(e) {
    const row = e.target.closest(".script-block-row");
    if (!row) return;
    addAIButton(row);
  }

  // -------------------------------
  // MENU
  // -------------------------------
  function openMenu(blockRow) {
    closeMenu();

    const type = activeBlock.dataset.type;
    const actions = getActions(type);

    menuEl = document.createElement("div");
    menuEl.className = "ai-menu";

    menuEl.style.position = "absolute";
    menuEl.style.right = "0";
    menuEl.style.top = "30px";
    menuEl.style.background = "#fff";
    menuEl.style.color = "#333";
    menuEl.style.borderRadius = "8px";
    menuEl.style.boxShadow = "0 8px 20px rgba(0,0,0,0.1)";
    menuEl.style.padding = "8px";
    menuEl.style.zIndex = "999";

    actions.forEach(action => {
      const item = document.createElement("div");
      item.className = "ai-menu-item";
      item.innerText = action;
      item.style.padding = "6px 10px";
      item.style.cursor = "pointer";

      item.onmouseenter = () => item.style.background = "#f2f2f2";
      item.onmouseleave = () => item.style.background = "transparent";

      item.onclick = () => showInput(action);

      menuEl.appendChild(item);
    });

    blockRow.appendChild(menuEl);
  }

  function closeMenu() {
    if (menuEl) menuEl.remove();
    if (inputEl) inputEl.remove();
    menuEl = null;
    inputEl = null;
  }

  function handleOutsideClick(e) {
    if (!menuEl) return;
    if (!menuEl.contains(e.target) && !e.target.classList.contains("ai-btn")) {
      closeMenu();
    }
  }

  // -------------------------------
  // INPUT FIELD
  // -------------------------------
  function showInput(action) {
    if (!activeBlock) return;

    // Remove existing input if any
    if (inputEl) inputEl.remove();

    inputEl = document.createElement("input");
    inputEl.className = "ai-input";
    inputEl.placeholder = `Optional instruction for "${action}"`;

    inputEl.style.width = "100%";
    inputEl.style.marginTop = "6px";
    inputEl.style.padding = "6px";
    inputEl.style.borderRadius = "6px";
    inputEl.style.border = "1px solid #ddd";

    inputEl.onkeydown = async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await runAI(action, inputEl.value);
      }
    };

    menuEl.appendChild(inputEl);
    inputEl.focus();
  }

  // -------------------------------
  // API CALL
  // -------------------------------
  async function runAI(action, instruction) {
    const content = activeBlock.innerText;

    const payload = {
      type: activeBlock.dataset.type,
      action,
      content,
      instruction,
      context: getContext()
    };

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      showResultOptions(data.output);

    } catch (err) {
      console.error("AI Error:", err);
      // For demo/pre-integration purposes, if API fails we might want to show a mock result or error
    }
  }

  // -------------------------------
  // GET CONTEXT (last few lines)
  // -------------------------------
  function getContext() {
    const blocks = [...document.querySelectorAll(".script-block")];
    const index = blocks.indexOf(activeBlock);

    return blocks
      .slice(Math.max(0, index - 10), index)
      .map(b => b.innerText)
      .join("\n");
  }

  // -------------------------------
  // RESULT OPTIONS
  // -------------------------------
  function showResultOptions(text) {
    // Remove previous results or inputs if they exist
    const oldResult = menuEl.querySelector(".ai-result");
    if (oldResult) oldResult.remove();

    const box = document.createElement("div");
    box.className = "ai-result";

    box.style.marginTop = "8px";
    box.style.padding = "8px";
    box.style.border = "1px solid #ddd";
    box.style.borderRadius = "6px";
    box.style.background = "#fafafa";

    const content = document.createElement("div");
    content.innerText = text;
    content.style.marginBottom = "8px";
    content.style.fontSize = "0.9em";

    const actions = document.createElement("div");
    actions.style.marginTop = "6px";
    actions.style.display = "flex";
    actions.style.gap = "4px";

    const replaceBtn = createActionBtn("Replace", () => {
      const line = getLine(activeBlock.dataset.id);
      if (line) {
          line.text = text;
          renderStudio();
          queueSave();
      }
      closeMenu();
    });

    const insertBtn = createActionBtn("Insert Below", () => {
      insertBelow(text);
      closeMenu();
    });

    const retryBtn = createActionBtn("Retry", () => {
      runAI("retry", "");
    });

    actions.append(replaceBtn, insertBtn, retryBtn);

    box.append(content, actions);
    menuEl.appendChild(box);
  }

  function createActionBtn(label, fn) {
    const btn = document.createElement("button");
    btn.innerText = label;
    btn.style.padding = "4px 8px";
    btn.style.fontSize = "11px";
    btn.style.cursor = "pointer";
    btn.onclick = fn;
    return btn;
  }

  // -------------------------------
  // INSERT BELOW
  // -------------------------------
  function insertBelow(text) {
    const project = getCurrentProject();
    if (!project) return;
    const index = getLineIndex(activeBlock.dataset.id);
    if (index === -1) return;

    const activeLine = project.lines[index];
    const newLine = {
        id: uid(),
        type: activeLine.type,
        text: text
    };
    project.lines.splice(index + 1, 0, newLine);
    renderStudio();
    queueSave();
  }

  return { init };

})();
