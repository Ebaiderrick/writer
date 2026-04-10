
# AI Backend Specification (User Provided)

## Directory Structure
/server
  ├── index.js
  ├── promptBuilder.js
  ├── package.json
  └── .env

## 📦 1. package.json
```json
{
  "type": "module",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "node-fetch": "^3.3.2"
  }
}
```

## 🔐 2. .env
```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
```

## 🧠 3. promptBuilder.js
```javascript
export function buildPrompt({ type, action, current, context }) {
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

  return "Improve this screenplay text.";
}
```

## 🚀 4. index.js
```javascript
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { buildPrompt } from "./promptBuilder.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Health check
app.get("/", (req, res) => {
  res.send("AI Server Running 🚀");
});

// 🎯 AI Endpoint
app.post("/ai/assist", async (req, res) => {
  const { type, action, current, context } = req.body;

  if (!current) {
    return res.status(400).json({ error: "Missing current block" });
  }

  try {
    const prompt = buildPrompt({ type, action, current, context });

    // Note: The user provided URL https://api.openai.com/v1/responses might be a typo for v1/completions or v1/chat/completions,
    // but I will follow the user's logic for now.
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: prompt,
        max_output_tokens: 800
      })
    });

    const data = await response.json();

    let output = "";
    if (data.output && data.output.length > 0) {
      output = data.output[0].content[0].text;
    } else if (data.output_text) {
      output = data.output_text;
    }

    res.json({ result: output });

  } catch (error) {
    console.error("AI ERROR:", error);
    res.status(500).json({ error: "AI request failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```
