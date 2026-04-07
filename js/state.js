export const state = {
  blocks: []
};

export function addBlock(type, text) {
  state.blocks.push({
    id: Date.now() + Math.random(),
    type,
    text
  });
}

export function updateBlock(id, newText) {
  const block = state.blocks.find(b => b.id === id);
  if (block) block.text = newText;
}
