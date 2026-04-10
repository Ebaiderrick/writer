import { state } from './config.js';
import { refs } from './dom.js';
import { getCurrentProject, getLine, getLineIndex, queueSave } from './project.js';
import { renderStudio, addBlock } from './events.js';

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
    const editor = refs.screenplayEditor;

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
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.cursor = "pointer";
    btn.style.zIndex = "10";
    btn.style.transition = "opacity 0.2s ease";

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
    menuEl.style.background = "var(--panel)";
    menuEl.style.color = "var(--ink)";
    menuEl.style.borderRadius = "8px";
    menuEl.style.boxShadow = "var(--shadow)";
    menuEl.style.padding = "8px";
    menuEl.style.zIndex = "999";

    actions.forEach(action => {
      const item = document.createElement("div");
      item.className = "ai-menu-item";
      item.innerText = action;
      item.style.padding = "6px 10px";
      item.style.cursor = "pointer";

      item.onmouseenter = () => item.style.background = "var(--soft)";
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

    if (inputEl) inputEl.remove();

    const container = document.createElement("div");
    container.className = "ai-input-wrapper";
    container.style.display = "flex";
    container.style.gap = "4px";
    container.style.marginTop = "8px";

    inputEl = document.createElement("input");
    inputEl.className = "ai-input";
    inputEl.placeholder = `Optional instruction for "${action}"`;

    inputEl.style.flex = "1";
    inputEl.style.padding = "6px 10px";
    inputEl.style.borderRadius = "6px";
    inputEl.style.border = "1px solid var(--line)";
    inputEl.style.background = "var(--control-bg)";
    inputEl.style.color = "var(--ink)";
    inputEl.style.fontSize = "12px";

    const submitBtn = document.createElement("button");
    submitBtn.className = "ai-submit-btn";
    submitBtn.innerHTML = "→";
    submitBtn.style.padding = "0 8px";
    submitBtn.style.borderRadius = "6px";
    submitBtn.style.border = "none";
    submitBtn.style.background = "var(--accent)";
    submitBtn.style.color = "#fff";
    submitBtn.style.cursor = "pointer";

    const trigger = async () => {
      const val = inputEl.value;
      await runAI(action, val);
    };

    inputEl.onkeydown = async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await trigger();
      }
    };

    submitBtn.onclick = trigger;

    container.append(inputEl, submitBtn);
    menuEl.appendChild(container);
    inputEl.focus();
  }

  // -------------------------------
  // API CALL
  // -------------------------------
  async function runAI(action, instruction) {
    const current = activeBlock.innerText;
    const activeLineId = activeBlock.dataset.id;
    const scenes = getLastScenes(activeLineId);

    const payload = {
      type: activeBlock.dataset.type,
      action,
      current,
      instruction,
      context: formatScenesForAI(scenes)
    };

    try {
      const res = await fetch("http://localhost:3000/ai/assist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      showResultOptions(data.result);

    } catch (err) {
      console.error("AI Error:", err);
    }
  }

  // -------------------------------
  // GET CONTEXT (last 3 scenes)
  // -------------------------------
  function getLastScenes(activeLineId) {
    const project = getCurrentProject();
    if (!project) return [];
    const lines = project.lines;
    const currentIndex = lines.findIndex(l => l.id === activeLineId);
    if (currentIndex === -1) return [];

    let scenes = [];
    let currentScene = { header: "", blocks: [] };

    // Traverse backwards to collect up to 3 scenes
    for (let i = currentIndex; i >= 0; i--) {
      const line = lines[i];
      currentScene.blocks.unshift(line);

      if (line.type === "scene") {
        currentScene.header = line.text;
        scenes.unshift(currentScene);
        currentScene = { header: "", blocks: [] };

        if (scenes.length === 3) break;
      }
    }

    // If we didn't hit a scene heading at the very beginning,
    // we still might have blocks that belong to an implicit scene.
    if (currentScene.blocks.length > 0 && scenes.length < 3) {
      scenes.unshift(currentScene);
    }

    return scenes;
  }

  function formatScenesForAI(scenes) {
    return scenes.map((scene, i) => {
      const header = scene.header || "SCENE " + (i + 1);
      const blocks = scene.blocks.map(b => `[${b.type.toUpperCase()}] ${b.text}`).join("\n");
      return `--- ${header} ---\n${blocks}`;
    }).join("\n\n");
  }

  // -------------------------------
  // RESULT OPTIONS
  // -------------------------------
  function showResultOptions(text) {
    const oldResult = menuEl.querySelector(".ai-result");
    if (oldResult) oldResult.remove();

    const box = document.createElement("div");
    box.className = "ai-result";

    box.style.marginTop = "8px";
    box.style.padding = "8px";
    box.style.border = "1px solid var(--line)";
    box.style.borderRadius = "6px";
    box.style.background = "var(--soft)";

    const content = document.createElement("div");
    content.innerText = text;
    content.style.fontSize = "0.9rem";
    content.style.lineHeight = "1.4";
    content.style.marginBottom = "8px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";

    const replaceBtn = createActionBtn("Replace", () => {
      const id = activeBlock.dataset.id;
      const line = getLine(id);
      if (line) {
        line.text = text;
        renderStudio();
        queueSave();
      }
      closeMenu();
    });

    const insertBtn = createActionBtn("Insert Below", () => {
      const id = activeBlock.dataset.id;
      const index = getLineIndex(id);
      if (index !== -1) {
        addBlock(activeBlock.dataset.type, text, index + 1);
        renderStudio();
        queueSave();
      }
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
    btn.className = "ghost-button btn-sm";
    btn.style.flex = "1";
    btn.onclick = fn;
    return btn;
  }

  return { init };

})();
