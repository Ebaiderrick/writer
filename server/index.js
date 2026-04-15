import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { buildPrompt } from "./promptBuilder.js";

dotenv.config();

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3001;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "openai/gpt-3.5-turbo";
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("AI Server Running");
});

app.post("/api/ai-assist", async (req, res) => {
  console.log(`[${new Date().toISOString()}] AI Request: ${req.body.action} (${req.body.type})`);
  const { type, action, current, context, instruction } = req.body;

  if (current === undefined || current === null) {
    return res.status(400).json({ error: "Missing current block" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.json({
      output: `AI is working (test mode) - You wanted to ${action || "assist with"} this ${type || "block"}.`
    });
  }

  try {
    const prompt = buildPrompt({ type, action, current, context, instruction });
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
      return res.status(response.status).json({
        error: extractApiError(data) || `AI request failed with status ${response.status}`
      });
    }

    const output = extractOutputText(data);
    if (!output) {
      return res.status(502).json({ error: "AI assistant returned no text." });
    }

    return res.json({ output });
  } catch (error) {
    console.error("AI ERROR:", error);
    return res.status(500).json({
      error: "AI request failed. Check your server connection and OpenAI configuration."
    });
  }
});

app.listen(DEFAULT_PORT, () => {
  console.log(`Server running on http://localhost:${DEFAULT_PORT}`);
});

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
