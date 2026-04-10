import fetch from 'node-fetch';

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

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { type, action, current, context: storyContext, instruction } = JSON.parse(event.body);

    if (!current) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing current block' }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          output: `AI is working (test mode) - You wanted to ${action} this ${type}.`
        })
      };
    }

    const prompt = buildPrompt({ type, action, current, context: storyContext, instruction });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();

    let output = "";
    if (data.choices && data.choices[0]) {
      output = data.choices[0].message.content;
    } else {
       return { statusCode: 500, body: JSON.stringify({ error: "Invalid AI response", details: data }) };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ output })
    };

  } catch (error) {
    console.error("AI ERROR:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "AI request failed" }) };
  }
};
