import { state, updateBlock } from "./state.js";

export function render() {
  const container = document.getElementById("editor");
  container.innerHTML = "";

  state.blocks.forEach(block => {
    const el = document.createElement("div");
    el.className = `block ${block.type}`;

    el.contentEditable = true;
    el.innerText = block.text;

    el.addEventListener("input", (e) => {
      updateBlock(block.id, e.target.innerText);
    });

    container.appendChild(el);
  });
}
