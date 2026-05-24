const DEFAULT_MODEL = process.env.OPENAI_MODEL || "openai/gpt-3.5-turbo";
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON" })
    };
  }

  const { type, action, current, context: screenplayContext, instruction } = body;

  if (current === undefined || current === null) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing current block" }),
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        output: `AI is working (test mode) - You wanted to ${action || "assist with"} this ${type || "block"}.`
      }),
    };
  }

  try {
    const systemPrompt = `You are an elite Hollywood Screenwriter and Script Doctor.

STRICT ARCHITECTURE RULES:
1. OUTPUT ONLY THE CONTENT TEXT ITSELF.
2. NO INTRODUCTION, NO COMMENTARY, NO CHATTY EXPLANATIONS.
3. NO MARKDOWN BACKTICKS (e.g., \`\`\`).
4. NO LABELS OR PREFIXES (e.g., do NOT output "ACTION:", "DIALOGUE:", or character names followed by a colon).
5. IF THE TASK IS TO REWRITE A LINE (Shorten, Rephrase, Subtext, Add Emotion), ONLY OUTPUT THE NEW VERSION OF THAT LINE.
6. IF THE TASK IS TO EXPAND OR PREDICT, OUTPUT RAW SCREENPLAY CONTENT.
7. CHARACTER NAMES WITHIN DIALOGUE BLOCKS SHOULD BE ALL CAPS, BUT DO NOT PREFIX THE BLOCK WITH THE NAME.
8. STAY IN PRESENT TENSE.
9. DO NOT INCLUDE SCENE HEADINGS UNLESS THE TASK IS 'PREDICT' OR 'EXPAND'.`;

    const userPrompt = `STORY CONTEXT (PREVIOUS BEATS):
${screenplayContext}

CURRENT BLOCK (${type.toUpperCase()}):
"${current}"

TASK:
${getActionInstruction(type, action)}
${instruction ? `\nSPECIFIC USER INSTRUCTION: ${instruction}` : ""}

YOUR OUTPUT:`;

    const response = await fetch(`${DEFAULT_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://eyawriter.com",
        "X-Title": "EyaWriter"
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: extractApiError(data) || `AI request failed with status ${response.status}`
        }),
      };
    }

    let output = extractOutputText(data);
    output = cleanAiResponse(output, current);

    if (!output) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "AI assistant returned no text." }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: `AI request failed: ${error.message}`
      }),
    };
  }
};

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

    // Shots
    "Camera Angle": "Suggest a dynamic camera angle for this shot.",
    "Improve Shot": "Make this camera direction more professional (e.g. CLOSE ON, POV).",
    "Add Movement": "Add a sense of motion to the shot (e.g. PAN, TRACKING)."
  };

  return map[action] || `Improve this ${type} by making it more professional.`;
}

function extractOutputText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  return "";
}

function cleanAiResponse(text, current) {
  let cleaned = text;

  // Remove markdown backticks
  cleaned = cleaned.replace(/^```[a-z]*\n/i, "").replace(/\n```$/g, "").trim();

  // Remove repetition of the prompt if the AI got confused
  if (cleaned.startsWith(current) && cleaned.length > current.length + 5) {
      cleaned = cleaned.substring(current.length).trim();
      cleaned = cleaned.replace(/^[:\-\s\.]+/g, "");
  }

  // Remove quotes around the entire response if the AI added them
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && (cleaned.match(/"/g) || []).length === 2) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }

  return cleaned;
}

function extractApiError(data) {
  if (typeof data?.error === "string" && data.error.trim()) {
    return data.error.trim();
  }
  if (typeof data?.error?.message === "string" && data.error.message.trim()) {
    return data.error.message.trim();
  }
  return "";
}
