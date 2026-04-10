import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import buildPrompt from "./promptBuilder.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post("/ai", async (req, res) => {
  try {
    const { type, userInput, context } = req.body;

    if (!userInput) {
      return res.status(400).json({ error: "Missing input" });
    }

    const prompt = buildPrompt(type, userInput, context);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a professional screenplay writer AI. Only respond in screenplay format.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!data.choices) {
      console.error(data);
      return res.status(500).json({ error: "AI failed" });
    }

    res.json({
      result: data.choices[0].message.content,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
