import { state, WORKSPACE_TASK_TEMPLATES } from "./config.js";
import { refs } from "./dom.js";
import { getCurrentProject, getLine, getLineIndex, queueSave } from "./project.js";
import { renderStudio, addBlock } from "./events.js";
import { escapeHtml } from "./utils.js";
import { customAlert, showModal } from "./ui.js";

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
    const actions = [];
    switch (type) {
      case "scene":
        actions.push("Predict", "Expand", "Fix", "Add Conflict", "Cinematic");
        break;
      case "dialogue":
        actions.push("Suggest Reply", "Rephrase", "Add Emotion", "Shorten", "Subtext");
        break;
      case "action":
        actions.push("Continue", "Visualize", "Add Tension", "Describe");
        break;
      case "shot":
        actions.push("Camera Angle", "Improve Shot", "Add Movement");
        break;
      default:
        actions.push("Expand");
    }

    if (state.grammarCheck) {
      actions.unshift("Grammar");
    }

    return actions;
  }

  function handleHover(event) {
    const row = event.target.closest(".script-block-row");
    if (!row) {
      return;
    }
    addAIButton(row);
  }

  function handleFocus(event) {
    const row = event.target.closest(".script-block-row");
    if (!row) {
      return;
    }
    addAIButton(row);
  }

  function addAIButton(blockRow) {
    if (!state.aiAssist || blockRow.querySelector(".ai-btn")) {
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
    button.style.top = "6px";
    button.style.border = "none";
    button.style.background = "transparent";
    button.style.cursor = "pointer";
    button.style.zIndex = "10";
    button.style.transition = "opacity 0.2s ease";

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      activeBlock = blockRow.querySelector(".script-block");
      openMenu(blockRow);
    });

    blockRow.style.position = "relative";
    blockRow.appendChild(button);
  }

  function openMenu(blockRow) {
    closeMenu();

    if (!activeBlock) {
      activeBlock = blockRow.querySelector(".script-block");
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
      if (action === "Grammar") item.classList.add("is-grammar");
      item.style.padding = "6px 10px";
      item.style.cursor = "pointer";

      item.onmouseenter = () => {
        item.style.background = "var(--soft)";
      };
      item.onmouseleave = () => {
        if (!item.classList.contains("is-selected")) {
          item.style.background = "transparent";
        }
      };
      item.onclick = () => showInput(action);

      menuEl.appendChild(item);
    });

    blockRow.appendChild(menuEl);
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

  function getWritingLanguageName() {
    const names = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", pt: "Portuguese" };
    return names[state.writingLanguage] || "English";
  }

  function buildProofreadInstruction(bulk = false) {
    const lang = getWritingLanguageName();
    const languageNote = `The primary script language is ${lang}. Fix all typos, spelling errors, and grammatical mistakes according to ${lang} conventions.`;
    const foreignNote = `If a line is intentionally written in a different language (e.g. a character speaks French in an otherwise English script), preserve it exactly — do not flag it as an error.`;
    if (bulk) {
      return `You are proofreading screenplay lines in bulk. ${languageNote} ${foreignNote} Return valid JSON as an array. Each item must include lineId or lineNumber, improved, and reason. Preserve screenplay formatting, character cue capitalisation, and scene heading style. Only include lines that should change. If strict JSON fails, still clearly label each fix with lineId or lineNumber, improved, and reason.`;
    }
    return `Proofread this script text. ${languageNote} ${foreignNote} Improve clarity and sentence structure, preserve screenplay intent and formatting, and return only the improved text with no explanation.`;
  }

  function buildStoryMemoryContext(project) {
    if (!project?.storyMemory) {
      return "";
    }

    const mem = project.storyMemory;
    const elements = [
      ...mem.characters.map((entry) => `Character: ${entry.name} (${entry.description})`),
      ...mem.locations.map((entry) => `Location: ${entry.name} (${entry.description})`),
      ...mem.scenes.map((entry) => `Story Scene: ${entry.name} (${entry.description})`),
      ...mem.themes.map((entry) => `Theme: ${entry.name} (${entry.description})`)
    ];

    if (!elements.length) {
      return "";
    }

    return "IMPORTANT: THE FOLLOWING STORY ELEMENTS MUST BE RESPECTED FOR CONSISTENCY:\n"
      + elements.join("\n")
      + "\n\n";
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

    // Highlight selected action
    menuEl.querySelectorAll(".ai-menu-item").forEach(item => {
      const isSelected = item.innerText === action;
      item.classList.toggle("is-selected", isSelected);
      item.style.background = isSelected ? "var(--accent-soft)" : "transparent";
      item.style.color = isSelected ? "var(--accent-strong)" : "var(--ink)";
    });

    inputWrapperEl = document.createElement("div");
    inputWrapperEl.className = "ai-input-wrapper";
    inputWrapperEl.style.display = "flex";
    inputWrapperEl.style.flexDirection = "column";
    inputWrapperEl.style.gap = "8px";
    inputWrapperEl.style.marginTop = "12px";
    inputWrapperEl.style.paddingTop = "10px";
    inputWrapperEl.style.borderTop = "1px solid var(--line)";

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "4px";

    const input = document.createElement("input");
    input.className = "ai-input";
    input.placeholder = `Extra details for "${action}" (optional)...`;
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
    submitButton.innerText = "▶";
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

    row.append(input, submitButton);
    inputWrapperEl.appendChild(row);
    menuEl.appendChild(inputWrapperEl);
    input.focus();
  }

  async function runAI(action, instruction, submitButton, input) {
    if (!activeBlock || !menuEl) {
      return;
    }

    const project = getCurrentProject();
    const current = activeBlock.innerText.trim();
    const activeLineId = activeBlock.dataset.id;
    const scenes = getLastScenes(activeLineId);

    const memoryContext = buildStoryMemoryContext(project);

    const request = {
      type: activeBlock.dataset.type,
      action,
      current: current || "",
      instruction,
      context: memoryContext + formatScenesForAI(scenes)
    };

    lastRequest = request;
    setLoadingState(submitButton, input, true);
    showMessage("AI assistant is thinking...", "info");

    try {
      const output = await requestAiText(request);
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
    content.style.fontSize = "0.9rem";
    content.style.lineHeight = "1.4";
    content.style.marginBottom = "8px";
    content.style.whiteSpace = "pre-wrap";

    if (request.action === "Improve" || request.action === "Refine") {
      const diffContainer = document.createElement("div");
      diffContainer.style.display = "flex";
      diffContainer.style.flexDirection = "column";
      diffContainer.style.gap = "8px";

      const originalBox = document.createElement("div");
      originalBox.innerHTML = `<span style="font-size:0.7rem; color:var(--muted); text-transform:uppercase;">Original</span><div style="opacity:0.6; text-decoration:line-through;">${escapeHtml(request.current)}</div>`;

      const improvedBox = document.createElement("div");
      improvedBox.innerHTML = `<span style="font-size:0.7rem; color:var(--accent-strong); text-transform:uppercase;">Improved</span><div>${escapeHtml(text)}</div>`;

      diffContainer.append(originalBox, improvedBox);
      content.appendChild(diffContainer);
    } else {
      content.innerText = text;
    }

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
      submitButton.innerText = isLoading ? "..." : "▶";
    }

    if (input) {
      input.disabled = isLoading;
    }

    const triggerButton = activeBlock?.closest(".script-block-row")?.querySelector(".ai-btn");
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

    const openAIText = extractTextFromUnknownShape(data?.response)
      || extractTextFromUnknownShape(data?.message)
      || extractTextFromUnknownShape(data?.completion)
      || extractTextFromUnknownShape(data?.choices)
      || extractTextFromUnknownShape(data?.content)
      || extractTextFromUnknownShape(data);
    if (openAIText) {
      return openAIText;
    }

    return "";
  }

  function extractTextFromUnknownShape(value) {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return value.trim();
    }
    if (Array.isArray(value)) {
      return value.map((item) => extractTextFromUnknownShape(item)).filter(Boolean).join("\n").trim();
    }
    if (typeof value === "object") {
      const direct = [
        value.text,
        value.output_text,
        value.content,
        value.result
      ].find((entry) => typeof entry === "string" && entry.trim());
      if (direct) {
        return direct.trim();
      }
      if (value.message) {
        const nestedMessage = extractTextFromUnknownShape(value.message);
        if (nestedMessage) {
          return nestedMessage;
        }
      }
      if (value.delta) {
        const nestedDelta = extractTextFromUnknownShape(value.delta);
        if (nestedDelta) {
          return nestedDelta;
        }
      }
      if (Array.isArray(value.content)) {
        const contentText = value.content
          .map((part) => {
            if (typeof part === "string") {
              return part;
            }
            if (typeof part?.text === "string") {
              return part.text;
            }
            if (typeof part?.content === "string") {
              return part.content;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n")
          .trim();
        if (contentText) {
          return contentText;
        }
      }
    }
    return "";
  }

  async function requestAiText(request) {
    const response = await fetch(getAiEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      let msg = data.error || `AI assistant failed (Status ${response.status})`;
      if (response.status === 401) msg = "Invalid API Key. Please check your OpenRouter configuration.";
      if (response.status === 402) msg = "Insufficient credits in your OpenRouter account.";
      if (response.status === 403) msg = "Access forbidden. Your OpenRouter key may be restricted.";
      if (response.status === 429) msg = "Rate limit exceeded. Please wait a moment.";
      if (response.status === 502) msg = "The AI model is temporarily unavailable. Please try again later.";
      throw new Error(msg);
    }

    return normalizeAiOutput(data);
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

  function triggerAction(blockRow, action) {
    activeBlock = blockRow.querySelector(".script-block");
    if (!activeBlock) return;

    if (action === "Grammar") {
      const text = activeBlock.innerText.trim();
      if (text) {
        openMenu(blockRow);
        runAI(action, "", null, null);
      } else {
        openMenu(blockRow);
      }
    } else {
      openMenu(blockRow);
    }
  }

  function triggerSmartProofread() {
    const project = getCurrentProject();
    const activeEl = getActiveScriptBlock();
    const activeLine = activeEl ? getLine(activeEl.dataset.id) : null;
    if (!project || !activeEl || !activeLine) {
      customAlert("Select a line first, then run Smart Proofreading.", "Smart Proofreading");
      return;
    }

    const scenes = getProofreadScenes(project);
    const launcher = document.createElement("div");
    launcher.className = "smart-proofread-launcher";
    launcher.innerHTML = `
      <div class="smart-proofread-mode-grid">
        <button class="smart-proofread-mode-card is-active" type="button" data-proofread-mode="line">
          <strong>Manual</strong>
          <span>Proofread the current line or selected text.</span>
        </button>
        <button class="smart-proofread-mode-card" type="button" data-proofread-mode="auto">
          <strong>Automatic</strong>
          <span>Proofread a scene range or the whole script.</span>
        </button>
      </div>
      <div class="smart-proofread-panel is-active" data-proofread-panel="line">
        <div class="smart-proofread-inline-meta">
          <span class="role-badge">${escapeHtml((activeLine.type || "line").toUpperCase())}</span>
          <span>${escapeHtml((activeLine.text || "").trim().slice(0, 120) || "Current line")}</span>
        </div>
        <p class="modal-copy">Stand on any line and run a focused proofread. If you select text, only that selection is improved.</p>
        <button class="ghost-button" type="button" data-proofread-run="line">Run On Current Line</button>
      </div>
      <div class="smart-proofread-panel" data-proofread-panel="auto">
        <label class="smart-proofread-check">
          <input type="checkbox" id="proofreadAllScenes" ${scenes.length <= 1 ? "checked" : ""}>
          <span>Proofread all scenes</span>
        </label>
        <div class="smart-proofread-range-grid">
          <label class="field field-wide">
            <span>From scene</span>
            <select id="proofreadSceneStart" ${scenes.length <= 1 ? "disabled" : ""}>
              ${scenes.map((scene) => `<option value="${escapeHtml(scene.id)}">${escapeHtml(scene.label)}</option>`).join("")}
            </select>
          </label>
          <label class="field field-wide">
            <span>To scene</span>
            <select id="proofreadSceneEnd" ${scenes.length <= 1 ? "disabled" : ""}>
              ${scenes.map((scene, index) => `<option value="${escapeHtml(scene.id)}" ${index === scenes.length - 1 ? "selected" : ""}>${escapeHtml(scene.label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <p class="modal-copy">Automatic mode collects compact fix cards for each changed line so you can accept or reject edits individually.</p>
        <button class="ghost-button" type="button" data-proofread-run="auto">Run Scene Proofread</button>
      </div>
      <p class="collab-status-msg" data-proofread-status></p>
    `;

    const setMode = (mode) => {
      launcher.querySelectorAll("[data-proofread-mode]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.proofreadMode === mode);
      });
      launcher.querySelectorAll("[data-proofread-panel]").forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.proofreadPanel === mode);
      });
    };

    launcher.querySelectorAll("[data-proofread-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.proofreadMode));
    });

    const allScenesToggle = launcher.querySelector("#proofreadAllScenes");
    const startSelect = launcher.querySelector("#proofreadSceneStart");
    const endSelect = launcher.querySelector("#proofreadSceneEnd");
    const statusEl = launcher.querySelector("[data-proofread-status]");
    const syncRangeInputs = () => {
      const disabled = allScenesToggle?.checked;
      if (startSelect) startSelect.disabled = disabled;
      if (endSelect) endSelect.disabled = disabled;
    };
    allScenesToggle?.addEventListener("change", syncRangeInputs);
    syncRangeInputs();

    launcher.querySelector('[data-proofread-run="line"]')?.addEventListener("click", async () => {
      closeProofreadModal();
      await runSmartProofreadLine(getActiveScriptBlock() || activeEl);
    });

    launcher.querySelector('[data-proofread-run="auto"]')?.addEventListener("click", async () => {
      const latestProject = getCurrentProject();
      const latestScenes = getProofreadScenes(latestProject);
      const allScenes = Boolean(allScenesToggle?.checked);
      const startSceneId = startSelect?.value || latestScenes[0]?.id || "";
      const endSceneId = endSelect?.value || latestScenes[latestScenes.length - 1]?.id || "";
      if (!latestProject) {
        return;
      }

      launcher.querySelectorAll("[data-proofread-run]").forEach((button) => {
        button.disabled = true;
      });
      if (statusEl) {
        statusEl.textContent = "Reviewing selected scenes...";
      }

      try {
        const suggestions = await buildAutomaticProofreadSuggestions(latestProject, {
          allScenes,
          startSceneId,
          endSceneId
        }, (message) => {
          if (statusEl) {
            statusEl.textContent = message;
          }
        });

        closeProofreadModal();
        await showAutomaticProofreadResults(suggestions);
      } catch (error) {
        console.error("Automatic smart proofreading error:", error);
        if (statusEl) {
          statusEl.textContent = error instanceof Error ? error.message : "Smart proofreading failed.";
        }
      } finally {
        launcher.querySelectorAll("[data-proofread-run]").forEach((button) => {
          button.disabled = false;
        });
      }
    });

    showModal({
      title: "Smart Proofreading",
      message: launcher,
      showConfirm: false,
      cancelLabel: "Close"
    });
  }

  function getActiveScriptBlock() {
    const activeByState = state.activeBlockId
      ? refs.screenplayEditor?.querySelector(`.script-block[data-id="${state.activeBlockId}"]:not([data-secondary])`)
      : null;
    const focused = document.activeElement?.closest?.(".script-block:not([data-secondary])") || null;
    const activeRowBlock = document.querySelector(".script-block-row.is-active .script-block:not([data-secondary])");
    const fallback = refs.screenplayEditor?.querySelector(".script-block:not([data-secondary])") || null;
    return activeByState || focused || activeRowBlock || fallback;
  }

  function closeProofreadModal() {
    document.getElementById("customModal")?.close();
  }

  function getProofreadScenes(project) {
    if (!project) {
      return [];
    }

    const scenes = project.lines
      .map((line, index) => ({ ...line, index }))
      .filter((line) => line.type === "scene" && line.text.trim());

    if (!scenes.length) {
      return [{ id: "__all__", index: 0, label: "Entire Script" }];
    }

    return scenes.map((scene, index) => ({
      id: scene.id,
      index: scene.index,
      label: `${index + 1}. ${scene.text.trim()}`
    }));
  }

  function isProofreadableLine(line) {
    return Boolean(line?.text?.trim()) && line.type !== "image";
  }

  async function runSmartProofreadLine(activeEl) {
    const lineId = activeEl?.dataset?.id;
    const line = lineId ? getLine(lineId) : null;
    if (!activeEl || !line) {
      await customAlert("Select some text or focus a block first.", "Smart Proofreading");
      return;
    }

    const selection = getSelectedTextInBlock(activeEl);
    const sourceText = selection?.text || activeEl.innerText.trim() || line.text;
    if (!sourceText.trim()) {
      await customAlert("Select some text or focus a block with content first.", "Smart Proofreading");
      return;
    }

    try {
      const output = await requestSmartProofreadSuggestion({
        line,
        sourceText,
        contextLineId: lineId
      });
      await showLineProofreadComparison({
        lineId,
        lineType: line.type,
        original: sourceText,
        improved: output,
        selection
      });
    } catch (error) {
      console.error("Smart proofreading error:", error);
      await customAlert(error instanceof Error ? error.message : "Smart proofreading failed.", "Smart Proofreading");
    }
  }

  async function requestSmartProofreadSuggestion({ line, sourceText, contextLineId }) {
    const project = getCurrentProject();
    const scenes = getLastScenes(contextLineId || line.id);
    const memoryContext = buildStoryMemoryContext(project);
    const output = await requestAiText({
      type: line.type,
      action: "Improve",
      current: sourceText,
      instruction: buildProofreadInstruction(false),
      context: memoryContext + formatScenesForAI(scenes)
    });

    const cleaned = String(output || "").trim();
    if (!cleaned) {
      throw new Error("The AI assistant returned no text.");
    }
    return cleaned;
  }

  async function showLineProofreadComparison({ lineId, lineType, original, improved, selection }) {
    const compare = document.createElement("div");
    compare.className = "smart-proofread-compare";
    compare.innerHTML = `
      <div class="proofread-compare-card">
        <span class="nav-menu-label">Original</span>
        <div class="bio-text">${escapeHtml(original)}</div>
      </div>
      <div class="proofread-compare-card">
        <span class="nav-menu-label">Improved</span>
        <div class="bio-text">${escapeHtml(improved)}</div>
      </div>
    `;

    const accepted = await showModal({
      title: `Smart Proofreading • ${lineType.toUpperCase()}`,
      message: compare,
      confirmLabel: "Accept Changes",
      cancelLabel: "Keep Original"
    });

    if (!accepted) {
      return;
    }

    const line = getLine(lineId);
    if (!line) {
      return;
    }

    if (selection) {
      line.text = `${line.text.slice(0, selection.start)}${improved}${line.text.slice(selection.end)}`;
    } else {
      line.text = improved;
    }

    renderStudio();
    queueSave();
  }

  async function buildAutomaticProofreadSuggestions(project, range, onProgress) {
    const targets = getAutomaticProofreadTargets(project, range);
    if (!targets.length) {
      throw new Error("There are no proofreadable lines in the selected scene range.");
    }

    onProgress?.(`Reviewing ${targets.length} lines across the selected scenes...`);
    let suggestions = await requestAutomaticProofreadBatch(project, targets);
    if (!suggestions.length) {
      suggestions = await buildAutomaticProofreadSuggestionsFallback(targets, onProgress);
    }
    suggestions.push(...await buildUndescribedCharacterSuggestions(project, targets, onProgress));

    if (!suggestions.length) {
      await customAlert("No changes were suggested for the selected scene range.", "Smart Proofreading");
    }

    return dedupeAutomaticProofreadSuggestions(suggestions);
  }

  function getAutomaticProofreadTargets(project, { allScenes, startSceneId, endSceneId }) {
    const sceneMarkers = getProofreadScenes(project);
    if (!sceneMarkers.length || sceneMarkers[0].id === "__all__") {
      return project.lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => isProofreadableLine(line))
        .map(({ line, index }) => ({
          lineNumber: index + 1,
          lineId: line.id,
          type: line.type,
          original: line.text,
          sceneLabel: "Entire Script"
        }));
    }

    const startMarker = allScenes
      ? sceneMarkers[0]
      : sceneMarkers.find((scene) => scene.id === startSceneId) || sceneMarkers[0];
    const endMarker = allScenes
      ? sceneMarkers[sceneMarkers.length - 1]
      : sceneMarkers.find((scene) => scene.id === endSceneId) || sceneMarkers[sceneMarkers.length - 1];

    const startIndex = Math.min(startMarker.index, endMarker.index);
    const endIndex = Math.max(startMarker.index, endMarker.index);

    let currentSceneLabel = sceneMarkers[0].label;
    return project.lines.reduce((list, line, index) => {
      const matchedScene = sceneMarkers.find((scene) => scene.id === line.id);
      if (matchedScene) {
        currentSceneLabel = matchedScene.label;
      }
      if (index < startIndex || index > endIndex || !isProofreadableLine(line)) {
        return list;
      }
      list.push({
        lineNumber: index + 1,
        lineId: line.id,
        type: line.type,
        original: line.text,
        sceneLabel: currentSceneLabel
      });
      return list;
    }, []);
  }

  async function requestAutomaticProofreadBatch(project, targets) {
    const batches = splitAutomaticProofreadTargets(targets);
    const suggestions = [];

    for (const batch of batches) {
      const memoryContext = buildStoryMemoryContext(project);
      const contextSceneIds = [...new Set(batch.map((target) => target.lineId))];
      const scenes = contextSceneIds.flatMap((lineId) => getLastScenes(lineId)).slice(-3);
      const payload = batch.map((target) => {
        const line = getLine(target.lineId);
        return {
          lineNumber: target.lineNumber,
          lineId: target.lineId,
          type: line?.type || target.type,
          scene: target.sceneLabel,
          text: line?.text || target.original
        };
      });

      const output = await requestAiText({
        type: "script",
        action: "Improve",
        current: JSON.stringify(payload),
        instruction: buildProofreadInstruction(true),
        context: `${memoryContext}${formatScenesForAI(scenes)}\n\nLINES TO REVIEW:\n${payload.map((item) => `[${item.lineNumber}] [${item.lineId}] [${item.type.toUpperCase()}] ${item.text}`).join("\n")}`
      });

      const parsed = parseAutomaticProofreadPayload(output, payload);
      if (!parsed.length && output) {
        console.warn("Automatic proofread batch returned no parseable fixes.", {
          batchSize: payload.length,
          preview: String(output).slice(0, 500)
        });
      }

      suggestions.push(...parsed.map((item) => {
        const target = resolveAutomaticProofreadTarget(batch, item);
        if (!target) {
          return null;
        }
        const line = getLine(target.lineId);
        const improved = String(item.improved || "").trim();
        if (!line || !improved || normalizeProofreadComparable(improved) === normalizeProofreadComparable(line.text)) {
          return null;
        }
        return {
          lineId: target.lineId,
          type: line.type,
          original: line.text,
          improved,
          sceneLabel: target.sceneLabel,
          reason: String(item.reason || "").trim()
        };
      }).filter(Boolean));
    }

    return suggestions;
  }

  function splitAutomaticProofreadTargets(targets) {
    const batches = [];
    let current = [];
    let currentChars = 0;
    const maxItems = 12;
    const maxChars = 2600;

    targets.forEach((target) => {
      const textLength = String(target.original || "").length;
      const wouldOverflow = current.length >= maxItems || (current.length && currentChars + textLength > maxChars);
      if (wouldOverflow) {
        batches.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(target);
      currentChars += textLength;
    });

    if (current.length) {
      batches.push(current);
    }

    return batches;
  }

  function parseAutomaticProofreadPayload(output, payload = []) {
    const raw = String(output || "").trim();
    if (!raw) {
      return [];
    }

    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (Array.isArray(parsed?.fixes)) {
        return parsed.fixes;
      }
      if (Array.isArray(parsed?.suggestions)) {
        return parsed.suggestions;
      }
      return parseAutomaticProofreadLooseObjects(cleaned, payload);
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (!match) {
        return parseAutomaticProofreadLooseObjects(cleaned, payload);
      }
      try {
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return parseAutomaticProofreadLooseObjects(cleaned, payload);
      }
    }
  }

  function parseAutomaticProofreadLooseObjects(raw, payload) {
    const fixes = [];
    const chunks = String(raw || "")
      .split(/\n(?=(?:[-*]\s*)?(?:lineId|Line ID|LINE ID)\s*[:=])/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);

    chunks.forEach((chunk) => {
      const lineId = chunk.match(/lineId\s*[:=]\s*["']?([A-Za-z0-9_-]+)["']?/i)?.[1]
        || chunk.match(/^\[([A-Za-z0-9_-]+)\]/)?.[1];
      const lineNumber = Number(
        chunk.match(/lineNumber\s*[:=]\s*["']?(\d+)["']?/i)?.[1]
        || chunk.match(/^(\d+)[.)-]/)?.[1]
        || chunk.match(/^\[(\d+)\]/)?.[1]
        || 0
      ) || undefined;
      const improved = chunk.match(/improved\s*[:=]\s*([\s\S]*?)(?:\n(?:reason|lineId)\s*[:=]|$)/i)?.[1]?.trim()
        || chunk.match(/suggested\s*[:=]\s*([\s\S]*?)(?:\n(?:reason|lineId|lineNumber)\s*[:=]|$)/i)?.[1]?.trim();
      const reason = chunk.match(/reason\s*[:=]\s*([\s\S]*?)$/i)?.[1]?.trim() || "";
      if ((lineId || lineNumber) && improved) {
        fixes.push({
          lineId,
          lineNumber,
          improved: improved.replace(/^["']|["']$/g, "").trim(),
          reason: reason.replace(/^["']|["']$/g, "").trim()
        });
      }
    });

    if (fixes.length) {
      return fixes;
    }

    return parseAutomaticProofreadLineMatches(raw, payload);
  }

  function parseAutomaticProofreadLineMatches(raw, payload) {
    return payload.reduce((matches, item) => {
      const escapedId = item.lineId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\[(?:${item.lineNumber}|${escapedId})\\][^\\n]*\\n([\\s\\S]*?)(?=\\n\\[(?:\\d+|[A-Za-z0-9_-]+)\\]|$)`, "i");
      const match = raw.match(pattern);
      if (!match) {
        return matches;
      }
      const improved = match[1]
        .replace(/^improved\s*[:=]\s*/i, "")
        .replace(/^suggested\s*[:=]\s*/i, "")
        .trim();
      if (!improved) {
        return matches;
      }
      matches.push({
        lineId: item.lineId,
        lineNumber: item.lineNumber,
        improved,
        reason: ""
      });
      return matches;
    }, []);
  }

  async function buildAutomaticProofreadSuggestionsFallback(targets, onProgress) {
    const suggestions = [];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      onProgress?.(`Proofreading ${index + 1} of ${targets.length}...`);
      const line = getLine(target.lineId);
      if (!line || !isProofreadableLine(line)) {
        continue;
      }

      const improved = await requestSmartProofreadSuggestion({
        line,
        sourceText: line.text,
        contextLineId: line.id
      });

      if (normalizeProofreadComparable(improved) !== normalizeProofreadComparable(line.text)) {
        suggestions.push({
          lineId: line.id,
          type: line.type,
          original: line.text,
          improved,
          sceneLabel: target.sceneLabel
        });
      }
    }
    return suggestions;
  }

  async function showAutomaticProofreadResults(suggestions) {
    if (!suggestions.length) {
      return;
    }

    const container = document.createElement("div");
    container.className = "smart-proofread-results";
    container.innerHTML = `
      <div class="smart-proofread-results-head">
        <div>
          <strong>${suggestions.length} suggested ${suggestions.length === 1 ? "edit" : "edits"}</strong>
          <p class="modal-copy">Review each change in a compact list. Accept only what improves the draft.</p>
        </div>
        <button class="ghost-button btn-sm" type="button" data-proofread-accept-all="true">Accept All</button>
      </div>
      <div class="smart-proofread-results-list">
        ${suggestions.map((item, index) => `
          <article class="proofread-suggestion-card" data-proofread-card="${index}">
            <div class="proofread-suggestion-meta">
              <span class="role-badge">${escapeHtml(item.type.toUpperCase())}</span>
              <span>${escapeHtml(item.sceneLabel)}</span>
              ${item.reason ? `<span>${escapeHtml(item.reason)}</span>` : ""}
            </div>
            <div class="proofread-suggestion-body">
              <div class="proofread-suggestion-column">
                <span class="nav-menu-label">Original</span>
                <div class="proofread-suggestion-text">${escapeHtml(item.original)}</div>
              </div>
              <div class="proofread-suggestion-column">
                <span class="nav-menu-label">Suggested</span>
                <div class="proofread-suggestion-text">${escapeHtml(item.improved)}</div>
              </div>
            </div>
            <div class="proofread-suggestion-actions">
              <button class="ghost-button btn-sm" type="button" data-proofread-accept="${index}">Accept</button>
              <button class="ghost-button btn-sm" type="button" data-proofread-reject="${index}">Reject</button>
            </div>
          </article>
        `).join("")}
      </div>
    `;

    const applySuggestion = (item, card, { rerender = true } = {}) => {
      if (!applyAutomaticProofreadSuggestion(item)) {
        return;
      }
      card?.classList.add("is-accepted");
      card?.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      if (rerender) {
        renderStudio();
        queueSave();
      }
    };

    const rejectSuggestion = (card) => {
      card?.classList.add("is-rejected");
      card?.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
    };

    container.querySelector('[data-proofread-accept-all]')?.addEventListener("click", () => {
      suggestions.forEach((item, index) => {
        const card = container.querySelector(`[data-proofread-card="${index}"]`);
        if (!card?.classList.contains("is-accepted") && !card?.classList.contains("is-rejected")) {
          applySuggestion(item, card, { rerender: false });
        }
      });
      renderStudio();
      queueSave();
    });

    suggestions.forEach((item, index) => {
      container.querySelector(`[data-proofread-accept="${index}"]`)?.addEventListener("click", () => {
        applySuggestion(item, container.querySelector(`[data-proofread-card="${index}"]`));
      });
      container.querySelector(`[data-proofread-reject="${index}"]`)?.addEventListener("click", () => {
        rejectSuggestion(container.querySelector(`[data-proofread-card="${index}"]`));
      });
    });

    await showModal({
      title: "Smart Proofreading • Automatic",
      message: container,
      showConfirm: false,
      cancelLabel: "Close"
    });
  }

  function dedupeAutomaticProofreadSuggestions(suggestions) {
    const seen = new Set();
    return suggestions.filter((item) => {
      const key = `${item.applyMode || "replace"}:${item.lineId}:${item.improved}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function resolveAutomaticProofreadTarget(batch, item) {
    if (item?.lineId) {
      const byId = batch.find((entry) => entry.lineId === item.lineId);
      if (byId) {
        return byId;
      }
    }
    if (item?.lineNumber) {
      const byNumber = batch.find((entry) => entry.lineNumber === Number(item.lineNumber));
      if (byNumber) {
        return byNumber;
      }
    }
    if (item?.original) {
      const byOriginal = batch.find((entry) => normalizeProofreadComparable(entry.original) === normalizeProofreadComparable(item.original));
      if (byOriginal) {
        return byOriginal;
      }
    }
    return null;
  }

  function normalizeProofreadComparable(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function getSceneStartIndex(project, lineIndex) {
    for (let index = lineIndex; index >= 0; index -= 1) {
      if (project.lines[index]?.type === "scene") {
        return index;
      }
    }
    return 0;
  }

  function hasCharacterIntroduction(project, lineIndex, characterName) {
    const sceneStart = getSceneStartIndex(project, lineIndex);
    const compactName = String(characterName || "").trim().toUpperCase();
    for (let index = sceneStart; index < lineIndex; index += 1) {
      const line = project.lines[index];
      if (!line || !["action", "shot", "scene"].includes(line.type)) {
        continue;
      }
      if (String(line.text || "").toUpperCase().includes(compactName)) {
        return true;
      }
    }
    return false;
  }

  async function buildUndescribedCharacterSuggestions(project, targets, onProgress) {
    const sceneMarkers = getProofreadScenes(project);
    const targetIds = new Set(targets.map((target) => target.lineId));
    const seenCharacters = new Set();
    const pending = [];

    project.lines.forEach((line, index) => {
      if (line?.type !== "character" || !String(line.text || "").trim()) {
        return;
      }
      const name = String(line.text || "").trim().toUpperCase();
      if (seenCharacters.has(name)) {
        return;
      }
      seenCharacters.add(name);
      if (!targetIds.has(line.id) || hasCharacterIntroduction(project, index, name)) {
        return;
      }
      pending.push({ line, index, name });
    });

    const suggestions = [];
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      onProgress?.(`Checking first appearance for ${entry.name} (${index + 1} of ${pending.length})...`);
      const sceneLabel = [...sceneMarkers]
        .reverse()
        .find((scene) => scene.index <= entry.index)?.label || "Selected Scene";
      const memChar = (project.storyMemory?.characters || []).find(
        (c) => String(c.name || "").trim().toUpperCase() === entry.name
      );
      const charDetail = memChar
        ? [
            memChar.age ? `Age: ${memChar.age}` : "",
            memChar.sex ? `Sex: ${memChar.sex}` : "",
            memChar.outfit ? `Outfit: ${memChar.outfit}` : "",
            memChar.behaviour ? `Behaviour: ${memChar.behaviour}` : "",
            memChar.other || ""
          ].filter(Boolean).join(". ")
        : "";
      let improved = "";
      try {
        improved = await requestAiText({
          type: "action",
          action: "Improve",
          current: "",
          instruction: `Write one concise screenplay action line that visually introduces the character ${entry.name} before their first line of dialogue. Return only the action line.${charDetail ? ` Use these character details: ${charDetail}.` : ""}`,
          context: `${buildStoryMemoryContext(project)}${formatScenesForAI(getLastScenes(entry.line.id))}`
        });
      } catch (error) {
        console.warn("Unable to auto-suggest a character introduction.", error);
      }
      const suggestionText = String(improved || "").trim() || `${entry.name} is introduced visually before speaking.`;
      suggestions.push({
        lineId: entry.line.id,
        type: "action",
        original: entry.line.text,
        improved: suggestionText,
        sceneLabel,
        reason: `${entry.name} speaks before the script visually introduces them.`,
        applyMode: "insert-before"
      });
    }

    return suggestions;
  }

  function applyAutomaticProofreadSuggestion(item) {
    const line = getLine(item.lineId);
    if (!line) {
      return false;
    }
    if (item.applyMode === "insert-before") {
      const project = getCurrentProject();
      const index = getLineIndex(item.lineId);
      if (!project || index === -1) {
        return false;
      }
      project.lines.splice(index, 0, {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "action",
        text: item.improved
      });
      return true;
    }
    line.text = item.improved;
    return true;
  }

  function triggerAssistant() {
    let activeEl = getActiveScriptBlock() || document.querySelector(".script-block:focus");
    if (!activeEl) {
      activeEl = document.querySelector(".script-block");
      if (activeEl) activeEl.focus();
    }
    if (!activeEl) return;

    const row = activeEl.closest(".script-block-row");
    if (row) {
      activeBlock = activeEl;
      openMenu(row);
    }
  }

  function getWorkspaceTaskTemplate(templateKey) {
    return WORKSPACE_TASK_TEMPLATES.find((template) => template.key === templateKey) || WORKSPACE_TASK_TEMPLATES[0];
  }

  async function runWorkspaceTaskAssistant(task, project) {
    const projectContext = project?.lines?.map((line) => `[${line.type.toUpperCase()}] ${line.text}`).join("\n") || "";
    const sceneContext = task.sceneId
      ? (() => {
          const sceneIndex = project?.lines?.findIndex((line) => line.id === task.sceneId) ?? -1;
          if (sceneIndex < 0) return "";
          const chunk = [];
          for (let index = sceneIndex; index < (project?.lines?.length || 0); index += 1) {
            const line = project.lines[index];
            if (index !== sceneIndex && line.type === "scene") break;
            chunk.push(`[${line.type.toUpperCase()}] ${line.text}`);
          }
          return chunk.join("\n");
        })()
      : "";
    const storyMemory = buildStoryMemoryContext(project);
    const context = sceneContext || projectContext;
    const template = getWorkspaceTaskTemplate(task.templateKey);
    const instruction = [
      "You are @AIassist inside a screenplay workspace.",
      "Complete the assigned writing task and return screenplay-ready text only.",
      "Do not explain your answer. Do not include markdown fences.",
      "Preserve screenplay formatting with sensible line breaks.",
      task.sceneId ? "Focus on the linked scene context first." : "Use the broader script context where helpful.",
      `Template: ${template.label}.`,
      template.aiInstruction
    ].join(" ");
    return requestAiText({
      action: "Improve",
      instruction: `${storyMemory}${instruction}`,
      input: `TASK TEMPLATE: ${template.label}\nTASK TITLE: ${task.title}\nTASK DESCRIPTION: ${task.description || template.description || "No extra description provided."}\nREFERENCE: ${task.reference || "None"}\n\nSCRIPT CONTEXT:\n${context}`.trim()
    });
  }

  return { init, triggerAction, triggerSmartProofread, triggerAssistant, runWorkspaceTaskAssistant };
})();

function getSelectedTextInBlock(block) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!block.contains(range.commonAncestorContainer)) {
    return null;
  }

  const start = getRangeOffset(block, range, true);
  const end = getRangeOffset(block, range, false);
  const text = selection.toString();
  if (!text.trim() || end <= start) {
    return null;
  }

  return { text, start, end };
}

function getRangeOffset(block, range, useStart) {
  const clone = range.cloneRange();
  clone.selectNodeContents(block);
  if (useStart) {
    clone.setEnd(range.startContainer, range.startOffset);
  } else {
    clone.setEnd(range.endContainer, range.endOffset);
  }
  return clone.toString().length;
}
