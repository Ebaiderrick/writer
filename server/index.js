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

    // 🔥 safer parsing
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

// 🚀 Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
