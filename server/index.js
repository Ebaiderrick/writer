import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { buildPrompt } from "./promptBuilder.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "").trim();
const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/$/, "");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mode: OPENAI_API_KEY ? "live" : "mock",
    modelConfigured: Boolean(OPENAI_MODEL)
  });
});

app.post("/api/ai-assist", async (req, res) => {
  const { type, action, current, context, instruction } = req.body;

  if (!current) {
    return res.status(400).json({ error: "Missing current block" });
  }

  if (!OPENAI_API_KEY) {
    return res.json({
      output: `AI is working (test mode) - You wanted to ${action || "assist with"} this ${type || "block"}.`
    });
  }

  if (!OPENAI_MODEL) {
    return res.status(500).json({
      error: "OPENAI_MODEL is not configured. Set it in server/.env before using live AI assistance."
    });
  }

  try {
    const prompt = buildPrompt({ type, action, current, context, instruction });
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: prompt,
        max_output_tokens: 800
      })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: extractApiError(data) || "AI request failed"
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

app.listen(PORT, () => {
  console.log(
    `Server running on http://localhost:${PORT} (${OPENAI_API_KEY ? `live mode: ${OPENAI_MODEL || "model missing"}` : "mock mode: set OPENAI_API_KEY to enable live AI"})`
  );
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
