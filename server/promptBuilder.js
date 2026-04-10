export function buildPrompt({ type, action, current, context, instruction }) {
  return `
You are a professional screenplay writer.

STRICT RULES:
- Only write in screenplay format
- No explanations
- No commentary
- No lists or notes
- Maintain consistency with previous scenes
- Continue naturally

STORY CONTEXT (LAST 3 SCENES):
${context}

CURRENT BLOCK:
${current}

TASK:
${getActionInstruction(type, action)}
${instruction ? `\nADDITIONAL INSTRUCTION: ${instruction}` : ""}
`;
}

function getActionInstruction(type, action) {
  if (type === "scene" && action === "Expand") {
    return "Expand this into a full cinematic scene with action and dialogue.";
  }

  if (type === "scene" && action === "Predict") {
    return "Continue the story naturally.";
  }

  if (type === "dialogue" && action === "Rephrase") {
    return "Rewrite the dialogue to sound more natural.";
  }

  if (type === "dialogue" && action === "Suggest Reply") {
    return "Write the next line of dialogue.";
  }

  if (type === "action") {
    return "Describe what happens next visually.";
  }

  return `Perform the action: ${action}`;
}
