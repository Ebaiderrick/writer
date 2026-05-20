import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { buildSystemPrompt, buildUserPrompt } from "./promptBuilder.js";

dotenv.config();

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3001;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "openai/gpt-4o-mini";
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1";

const ALLOWED_ORIGINS = [
  "https://eyawriter.com",
  "https://www.eyawriter.com",
  "http://localhost:8000",
  "http://localhost:3000",
  "http://localhost:3001",
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error("Not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "50kb" }));

const ALLOWED_TYPES = new Set(["scene", "dialogue", "action", "character", "parenthetical", "transition", "shot", "general"]);
const ALLOWED_ACTIONS = new Set(["Predict", "Expand", "Fix", "Add Conflict", "Cinematic", "Suggest Reply", "Rephrase", "Add Emotion", "Shorten", "Subtext", "Continue", "Visualize", "Add Tension", "Describe", "Grammar", "Camera Angle", "Improve Shot", "Add Movement"]);
const MAX_CURRENT = 2000;
const MAX_CONTEXT = 5000;
const MAX_INSTRUCTION = 500;

// Simple in-memory rate limiter: 20 requests per minute per IP
const _rateBuckets = new Map();
function _checkRate(ip) {
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
  }
  bucket.count++;
  _rateBuckets.set(ip, bucket);
  return bucket.count <= 20;
}
// Prune stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of _rateBuckets) { if (now > b.resetAt) _rateBuckets.delete(ip); }
}, 300_000);

app.get("/", (req, res) => {
  res.send("EyaWriter AI Server Running");
});

app.post("/api/ai-assist", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  if (!_checkRate(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait and try again." });
  }

  const { type, action, current, context, instruction } = req.body;

  if (current === undefined || current === null) {
    return res.status(400).json({ error: "Missing current block" });
  }
  if (type && !ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: "Invalid block type" });
  }
  if (action && !ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }
  if (typeof current === "string" && current.length > MAX_CURRENT) {
    return res.status(400).json({ error: "Content too long" });
  }
  if (typeof context === "string" && context.length > MAX_CONTEXT) {
    return res.status(400).json({ error: "Context too long" });
  }
  if (typeof instruction === "string" && instruction.length > MAX_INSTRUCTION) {
    return res.status(400).json({ error: "Instruction too long" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.json({
      output: `AI is working (test mode) - You wanted to ${action || "assist with"} this ${type || "block"}.`
    });
  }

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt({ type, action, current, context, instruction });

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
      console.error("OpenRouter Error:", data);
      return res.status(response.status).json({
        error: extractApiError(data) || `AI request failed with status ${response.status}`
      });
    }

    let output = extractOutputText(data);
    output = cleanAiResponse(output, current);

    if (!output) {
      return res.status(502).json({ error: "AI assistant returned no text." });
    }

    return res.json({ output });
  } catch (error) {
    console.error("AI ERROR:", error);
    return res.status(500).json({
      error: "AI request failed. Check your server connection and API configuration."
    });
  }
});

app.listen(DEFAULT_PORT, () => {
  console.log(`Server running on http://localhost:${DEFAULT_PORT}`);
});

function extractOutputText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
    if (text) return text;
  }

  if (typeof data?.output === "string" && data.output.trim()) {
    return data.output.trim();
  }

  if (Array.isArray(data?.output)) {
    const segments = [];
    for (const item of data.output) {
      const blocks = Array.isArray(item?.content) ? item.content : [];
      for (const block of blocks) {
        if (typeof block?.text === "string" && block.text.trim()) {
          segments.push(block.text.trim());
        }
      }
    }
    if (segments.length) return segments.join("\n\n");
  }

  return "";
}

function cleanAiResponse(text, current) {
  let cleaned = text;
  cleaned = cleaned.replace(/^```[a-z]*\n/i, "").replace(/\n```$/g, "").trim();
  if (cleaned.startsWith(current) && cleaned.length > current.length + 5) {
    cleaned = cleaned.substring(current.length).trim().replace(/^[:\-\s.]+/, "");
  }
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && (cleaned.match(/"/g) || []).length === 2) {
    cleaned = cleaned.slice(1, -1).trim();
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
