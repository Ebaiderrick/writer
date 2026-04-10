export default function buildPrompt(type, userInput, context = []) {
  const lastScenes = context.join("\n");

  return `
You are assisting in writing a screenplay.

Context (last scenes):
${lastScenes}

Current task: ${type}

User instruction:
${userInput}

Write ONLY in proper screenplay format.
`;
}
