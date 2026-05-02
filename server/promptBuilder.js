export function buildPrompt({ type, action, current, context, instruction }) {
  return `
You are an elite Hollywood Screenwriter and Script Doctor.

STRICT ARCHITECTURE RULES:
1. OUTPUT ONLY THE CONTENT TEXT ITSELF.
2. NO INTRODUCTION, NO COMMENTARY, NO CHATTY EXPLANATIONS.
3. NO MARKDOWN BACKTICKS (e.g., \`\`\`).
4. NO LABELS OR PREFIXES (e.g., do NOT output "ACTION:", "DIALOGUE:", or character names followed by a colon).
5. IF THE TASK IS TO REWRITE A LINE (Shorten, Rephrase, Subtext, Add Emotion), ONLY OUTPUT THE NEW VERSION OF THAT LINE.
6. IF THE TASK IS TO EXPAND OR PREDICT, OUTPUT RAW SCREENPLAY CONTENT.
7. CHARACTER NAMES WITHIN DIALOGUE BLOCKS SHOULD BE ALL CAPS, BUT DO NOT PREFIX THE BLOCK WITH THE NAME.
8. STAY IN PRESENT TENSE.
9. DO NOT INCLUDE SCENE HEADINGS UNLESS THE TASK IS 'PREDICT' OR 'EXPAND'.

STORY CONTEXT (PREVIOUS BEATS):
${context}

CURRENT BLOCK (${type.toUpperCase()}):
"${current}"

TASK:
${getActionInstruction(type, action)}
${instruction ? `\nSPECIFIC USER INSTRUCTION: ${instruction}` : ""}

YOUR OUTPUT:`;
}

function getActionInstruction(type, action) {
  const map = {
    // Scene Actions
    "Predict": "Predict the next logical beat of the story. Write the next scene heading and the opening action.",
    "Expand": "Flesh this scene out with cinematic detail, sharp dialogue, and atmospheric action.",
    "Fix": "Tighten the pacing and sharpen the dialogue. Rewrite the current block to be more professional.",
    "Add Conflict": "Introduce a new obstacle or argument. Rewrite the current block or continue from it with conflict.",
    "Cinematic": "Rewrite the current block with a focus on visual storytelling and atmosphere.",

    // Dialogue Actions
    "Suggest Reply": "Write the next character's line of dialogue in response to the current one.",
    "Rephrase": "Rewrite the current line of dialogue to sound more unique and natural. ONLY output the new dialogue text.",
    "Add Emotion": "Rewrite the current line with more subtext and emotional weight. ONLY output the new dialogue text.",
    "Shorten": "Rewrite the current line to be punchy and brief. ONLY output the new dialogue text.",
    "Subtext": "Rewrite the current line so the character means something else. ONLY output the new dialogue text.",

    // Action/General
    "Continue": "Write the immediate next visual beat. Keep the momentum going.",
    "Visualize": "Rewrite the current action block with more texture and sensory detail.",
    "Add Tension": "Rewrite or continue the current block to ramp up the stakes.",
    "Describe": "Paint a clearer picture of this specific moment.",
    "Grammar": "Proofread and fix all spelling, grammar, and punctuation issues in this block. Maintain the existing style and format exactly.",
    "Improve": "Fix grammar and spelling, improve clarity and sentence structure, and return a polished rewrite that preserves the original meaning and tone.",

    // Shots
    "Camera Angle": "Suggest a dynamic camera angle for this shot.",
    "Improve Shot": "Make this camera direction more professional (e.g. CLOSE ON, POV).",
    "Add Movement": "Add a sense of motion to the shot (e.g. PAN, TRACKING)."
  };

  return map[action] || `Improve this ${type} by making it more professional.`;
}
