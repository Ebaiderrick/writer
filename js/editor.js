// ===============================
// SCREENPLAY EDITOR ENGINE
// ===============================

const editor = document.getElementById("screenplayEditor");
const template = document.getElementById("blockTemplate");

let activeBlock = null;


// ===============================
// INIT
// ===============================

export function initEditor() {
  editor.innerHTML = "";

  const first = createBlock("action", "");
  editor.appendChild(first);

  focusBlock(first.querySelector(".script-block"));
}


// ===============================
// CREATE BLOCK
// ===============================

function createBlock(type = "action", text = "") {
  const clone = template.content.cloneNode(true);
  const row = clone.querySelector(".script-block-row");
  const block = clone.querySelector(".script-block");

  block.dataset.type = type;
  block.textContent = text;

  attachEvents(block);

  return row;
}


// ===============================
// FOCUS HANDLING
// ===============================

function focusBlock(block, toEnd = true) {
  block.focus();

  const range = document.createRange();
  const sel = window.getSelection();

  range.selectNodeContents(block);
  range.collapse(toEnd);

  sel.removeAllRanges();
  sel.addRange(range);

  activeBlock = block;
}


// ===============================
// EVENTS
// ===============================

function attachEvents(block) {

  // SET ACTIVE
  block.addEventListener("focus", () => {
    activeBlock = block;
  });


  // KEYBOARD CONTROL
  block.addEventListener("keydown", (e) => {

    const row = block.closest(".script-block-row");

    // =========================
    // ENTER → CREATE NEXT LINE
    // =========================
    if (e.key === "Enter") {
      e.preventDefault();

      // 🚫 Prevent empty lines
      if (block.textContent.trim() === "") return;

      const newRow = createBlock("action");
      row.after(newRow);

      focusBlock(newRow.querySelector(".script-block"));
    }


    // =========================
    // BACKSPACE → DELETE EMPTY
    // =========================
    if (e.key === "Backspace") {

      if (block.textContent.trim() === "") {
        const prev = row.previousElementSibling;

        if (prev) {
          e.preventDefault();
          row.remove();
          focusBlock(prev.querySelector(".script-block"));
        }
      }
    }


    // =========================
    // ARROW UP
    // =========================
    if (e.key === "ArrowUp") {
      const prev = row.previousElementSibling;
      if (prev) {
        e.preventDefault();
        focusBlock(prev.querySelector(".script-block"));
      }
    }


    // =========================
    // ARROW DOWN
    // =========================
    if (e.key === "ArrowDown") {
      const next = row.nextElementSibling;
      if (next) {
        e.preventDefault();
        focusBlock(next.querySelector(".script-block"));
      }
    }

  });


  // =========================
  // INPUT (AUTO CLEAN)
  // =========================
  block.addEventListener("input", () => {
    cleanBlock(block);
  });


  // =========================
  // PASTE (SMART HANDLING)
  // =========================
  block.addEventListener("paste", (e) => {
    e.preventDefault();

    const text = (e.clipboardData || window.clipboardData).getData("text");

    handlePaste(block, text);
  });

}


// ===============================
// CLEAN BLOCK CONTENT
// ===============================

function cleanBlock(block) {
  // Remove line breaks inside block
  block.textContent = block.textContent.replace(/\n/g, "");
}


// ===============================
// PASTE HANDLER
// ===============================

function handlePaste(block, text) {
  const lines = text.split("\n").filter(l => l.trim() !== "");

  if (lines.length === 0) return;

  const currentRow = block.closest(".script-block-row");

  // Replace current line
  block.textContent = lines[0];

  let lastRow = currentRow;

  // Add new lines below
  for (let i = 1; i < lines.length; i++) {
    const newRow = createBlock("action", lines[i]);
    lastRow.after(newRow);
    lastRow = newRow;
  }

  focusBlock(lastRow.querySelector(".script-block"));
}


// ===============================
// CLICK HANDLING (GLOBAL)
// ===============================

editor.addEventListener("click", (e) => {
  const block = e.target.closest(".script-block");

  if (block) {
    focusBlock(block, false);
  }
});


// ===============================
// EXTERNAL API (FOR TOOLBAR)
// ===============================

export function insertBlock(type) {
  if (!activeBlock) return;

  const row = activeBlock.closest(".script-block-row");

  // 🚫 prevent empty insert
  if (activeBlock.textContent.trim() === "") {
    activeBlock.dataset.type = type;
    return;
  }

  const newRow = createBlock(type);
  row.after(newRow);

  focusBlock(newRow.querySelector(".script-block"));
}


// ===============================
// GET DATA (FOR EXPORT)
// ===============================

export function getEditorData() {
  const rows = editor.querySelectorAll(".script-block");

  return Array.from(rows).map(block => ({
    type: block.dataset.type,
    text: block.textContent
  }));
}
