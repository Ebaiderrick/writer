import { state } from "./config.js";
import { refs } from "./dom.js";
import { getCurrentProject, getLine, getLineIndex, queueSave } from "./project.js";
import { renderStudio, addBlock } from "./events.js";

export const AI = (() => {
  let activeBlock = null;
  let menuEl = null;
  let inputWrapperEl = null;
  let lastRequest = null;

  function init() {
    const editor = refs.screenplayEditor;

    editor.addEventListener("mouseover", handleHover);
    editor.addEventListener("focusin", handleFocus);
    document.addEventListener("click", handleOutsideClick);
  }

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

  function handleHover(event) {
    const line = event.target.closest(".line");
    if (!line) {
      return;
    }
    addAIButton(line);
  }

  function handleFocus(event) {
    const line = event.target.closest(".line");
    if (!line) {
      return;
    }
    addAIButton(line);
  }

  function addAIButton(line) {
    if (!state.aiAssist || line.querySelector(".ai-btn")) {
      return;
    }

    const button = document.createElement("button");
    button.className = "ai-btn";
    button.type = "button";
    button.textContent = "⚡";
    button.title = "AI Assist";
    button.setAttribute("aria-label", "AI Assist");

    button.style.position = "absolute";
    button.style.right = "8px";
    button.style.top = "2px";
    button.style.border = "none";
    button.style.background = "transparent";
    button.style.cursor = "pointer";
    button.style.zIndex = "10";
    button.style.transition = "opacity 0.2s ease";

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      activeBlock = line;
      openMenu(line);
    });

    line.style.position = "relative";
    line.appendChild(button);
  }

  function openMenu(line) {
    closeMenu();

    if (!activeBlock) {
      activeBlock = line;
    }

    const type = activeBlock?.dataset.type || "action";
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
    menuEl.style.minWidth = "220px";

    actions.forEach((action) => {
      const item = document.createElement("div");
      item.className = "ai-menu-item";
      item.innerText = action;
      item.style.padding = "6px 10px";
      item.style.cursor = "pointer";

      item.onmouseenter = () => {
        item.style.background = "var(--soft)";
      };
      item.onmouseleave = () => {
        item.style.background = "transparent";
      };
      item.onclick = () => showInput(action);

      menuEl.appendChild(item);
    });

    line.appendChild(menuEl);
  }

  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
    }
    menuEl = null;
    inputWrapperEl = null;
  }

  function handleOutsideClick(event) {
    if (!menuEl) {
      return;
    }

    if (!menuEl.contains(event.target) && !event.target.classList.contains("ai-btn")) {
      closeMenu();
    }
  }

  function showInput(action) {
    if (!activeBlock || !menuEl) {
      return;
    }

    const existingResult = menuEl.querySelector(".ai-result");
    if (existingResult) {
      existingResult.remove();
    }

    if (inputWrapperEl) {
      inputWrapperEl.remove();
    }

    inputWrapperEl = document.createElement("div");
    inputWrapperEl.className = "ai-input-wrapper";
    inputWrapperEl.style.display = "flex";
    inputWrapperEl.style.gap = "4px";
    inputWrapperEl.style.marginTop = "8px";

    const input = document.createElement("input");
    input.className = "ai-input";
    input.placeholder = `Optional instruction for "${action}"`;
    input.style.flex = "1";
    input.style.padding = "6px 10px";
    input.style.borderRadius = "6px";
    input.style.border = "1px solid var(--line)";
    input.style.background = "var(--control-bg)";
    input.style.color = "var(--ink)";
    input.style.fontSize = "12px";

    const submitButton = document.createElement("button");
    submitButton.className = "ai-submit-btn";
    submitButton.type = "button";
    submitButton.innerText = "Go";
    submitButton.style.padding = "0 10px";
    submitButton.style.borderRadius = "6px";
    submitButton.style.border = "none";
    submitButton.style.background = "var(--accent)";
    submitButton.style.color = "#fff";
    submitButton.style.cursor = "pointer";

    const trigger = async () => {
      const value = input.value.trim();
      await runAI(action, value, submitButton, input);
    };

    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await trigger();
      }
    });

    submitButton.onclick = trigger;

    inputWrapperEl.append(input, submitButton);
    menuEl.appendChild(inputWrapperEl);
    input.focus();
  }

  async function runAI(action, instruction, submitButton, input) {
    if (!activeBlock || !menuEl) {
      return;
    }

    const current = activeBlock.innerText.trim();
    const activeLineId = activeBlock.dataset.id;
    const scenes = getLastScenes(activeLineId);
    const request = {
      type: activeBlock.dataset.type,
      action,
      current,
      instruction,
      context: formatScenesForAI(scenes)
    };

    lastRequest = request;
    setLoadingState(submitButton, input, true);
    showMessage("AI assistant is thinking...", "info");

    try {
      const response = await fetch(getAiEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "The AI assistant request failed.");
      }

      const output = normalizeAiOutput(data);
      if (!output) {
        throw new Error("The AI assistant returned no text.");
      }

      showResultOptions(output, request);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Could not reach the AI server. Run `cd server && npm install && npm start`.";
      showError(message);
      console.error("AI Error:", error);
    } finally {
      setLoadingState(submitButton, input, false);
    }
  }

  function showResultOptions(text, request) {
    if (!menuEl) {
      return;
    }

    removeResultBox();

    const box = document.createElement("div");
    box.className = "ai-result";
    styleResultBox(box, "success");

    const content = document.createElement("div");
    content.innerText = text;
    content.style.fontSize = "0.9rem";
    content.style.lineHeight = "1.4";
    content.style.marginBottom = "8px";
    content.style.whiteSpace = "pre-wrap";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";

    const replaceBtn = createActionBtn("Replace", () => {
      const id = activeBlock?.dataset.id;
      const line = id ? getLine(id) : null;
      if (line) {
        line.text = text;
        renderStudio();
        queueSave();
      }
      closeMenu();
    });

    const insertBtn = createActionBtn("Insert Below", () => {
      const id = activeBlock?.dataset.id;
      const index = id ? getLineIndex(id) : -1;
      if (index !== -1) {
        addBlock(activeBlock.dataset.type, text, index + 1);
        renderStudio();
        queueSave();
      }
      closeMenu();
    });

    const retryBtn = createActionBtn("Retry", () => {
      runAI(request.action, request.instruction || "", null, null);
    });

    actions.append(replaceBtn, insertBtn, retryBtn);
    box.append(content, actions);
    menuEl.appendChild(box);
  }

  function showError(message) {
    if (!menuEl) {
      return;
    }

    removeResultBox();

    const box = document.createElement("div");
    box.className = "ai-result";
    styleResultBox(box, "error");

    const content = document.createElement("div");
    content.innerText = message;
    content.style.fontSize = "0.88rem";
    content.style.lineHeight = "1.45";
    content.style.whiteSpace = "pre-wrap";

    box.appendChild(content);

    if (lastRequest) {
      const retryActions = document.createElement("div");
      retryActions.style.display = "flex";
      retryActions.style.gap = "6px";
      retryActions.style.marginTop = "8px";

      const retryBtn = createActionBtn("Retry", () => {
        runAI(lastRequest.action, lastRequest.instruction || "", null, null);
      });
      retryActions.appendChild(retryBtn);
      box.appendChild(retryActions);
    }

    menuEl.appendChild(box);
  }

  function showMessage(message, variant) {
    if (!menuEl) {
      return;
    }

    removeResultBox();

    const box = document.createElement("div");
    box.className = "ai-result";
    styleResultBox(box, variant);

    const content = document.createElement("div");
    content.innerText = message;
    content.style.fontSize = "0.88rem";
    content.style.lineHeight = "1.45";

    box.appendChild(content);
    menuEl.appendChild(box);
  }

  function styleResultBox(box, variant) {
    box.style.marginTop = "8px";
    box.style.padding = "8px";
    box.style.border = "1px solid var(--line)";
    box.style.borderRadius = "6px";
    box.style.background = "var(--soft)";

    if (variant === "error") {
      box.style.borderColor = "rgba(183, 67, 61, 0.45)";
      box.style.background = "rgba(183, 67, 61, 0.08)";
    }
  }

  function removeResultBox() {
    const existingResult = menuEl?.querySelector(".ai-result");
    if (existingResult) {
      existingResult.remove();
    }
  }

  function setLoadingState(submitButton, input, isLoading) {
    if (submitButton) {
      submitButton.disabled = isLoading;
      submitButton.innerText = isLoading ? "..." : "Go";
    }

    if (input) {
      input.disabled = isLoading;
    }

    const triggerButton = activeBlock?.querySelector(".ai-btn");
    if (triggerButton) {
      triggerButton.classList.toggle("is-busy", Boolean(isLoading));
      triggerButton.setAttribute("aria-busy", isLoading ? "true" : "false");
    }
  }

  function getAiEndpoint() {
    const configured = window.EYAWRITER_AI_API_URL || localStorage.getItem("eyawriter.aiApiUrl");
    if (configured) {
      return configured;
    }

    if (window.location.protocol === "file:") {
      return "http://localhost:3001/api/ai-assist";
    }

    if (/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) && window.location.port !== "3001") {
      return `${window.location.protocol}//${window.location.hostname}:3001/api/ai-assist`;
    }

    return new URL("/api/ai-assist", window.location.origin).toString();
  }

  function normalizeAiOutput(data) {
    if (typeof data?.output === "string" && data.output.trim()) {
      return data.output.trim();
    }

    if (typeof data?.result === "string" && data.result.trim()) {
      return data.result.trim();
    }

    if (typeof data?.output_text === "string" && data.output_text.trim()) {
      return data.output_text.trim();
    }

    return "";
  }

  function getLastScenes(activeLineId) {
    const project = getCurrentProject();
    if (!project) {
      return [];
    }

    const lines = project.lines;
    const currentIndex = lines.findIndex((line) => line.id === activeLineId);
    if (currentIndex === -1) {
      return [];
    }

    const scenes = [];
    let currentScene = { header: "", blocks: [] };

    for (let index = currentIndex; index >= 0; index -= 1) {
      const line = lines[index];
      currentScene.blocks.unshift(line);

      if (line.type === "scene") {
        currentScene.header = line.text;
        scenes.unshift(currentScene);
        currentScene = { header: "", blocks: [] };

        if (scenes.length === 3) {
          break;
        }
      }
    }

    if (currentScene.blocks.length > 0 && scenes.length < 3) {
      scenes.unshift(currentScene);
    }

    return scenes;
  }

  function formatScenesForAI(scenes) {
    return scenes.map((scene, index) => {
      const header = scene.header || `SCENE ${index + 1}`;
      const blocks = scene.blocks
        .map((block) => `[${block.type.toUpperCase()}] ${block.text}`)
        .join("\n");
      return `--- ${header} ---\n${blocks}`;
    }).join("\n\n");
  }

  function createActionBtn(label, fn) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerText = label;
    button.className = "ghost-button btn-sm";
    button.style.flex = "1";
    button.onclick = fn;
    return button;
  }

  return { init };
})();
