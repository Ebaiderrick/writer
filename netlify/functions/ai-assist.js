import fetch from "node-fetch";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "openai/gpt-3.5-turbo";
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1";

export async function handler(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { type, action, current, context: screenplayContext, instruction } = JSON.parse(event.body);

  if (!current) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing current block" }),
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        output: `AI is working (test mode) - You wanted to ${action || "assist with"} this ${type || "block"}.`
      }),
    };
  }

  try {
    const prompt = buildPrompt({ type, action, current, context: screenplayContext, instruction });
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
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("OpenRouter Error:", data);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: extractApiError(data) || `AI request failed with status ${response.status}`
        }),
      };
    }

    const output = extractOutputText(data);
    if (!output) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "AI assistant returned no text." }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ output }),
    };
  } catch (error) {
    console.error("AI ERROR:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "AI request failed. Check your server connection and OpenAI configuration."
      }),
    };
  }
}

function buildPrompt({ type, action, current, context, instruction }) {
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

function extractOutputText(data) {
  if (typeof data?.output === "string" && data.output.trim()) {
    return data.output.trim();
  }

  if (typeof data?.result === "string" && data.result.trim()) {
    return data.result.trim();
  }

  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    const segments = [];

    for (const item of data.output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const block of content) {
        if (typeof block?.text === "string" && block.text.trim()) {
          segments.push(block.text.trim());
        }
      }
    }

    if (segments.length) {
      return segments.join("\n\n");
    }
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
      .filter(Boolean)
      .join("\n\n");

    if (text) {
      return text;
    }
  }

  return "";
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
