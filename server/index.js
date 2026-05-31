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
app.use(express.json({ limit: "4mb" }));

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

app.post("/api/convert-script", async (req, res) => {
  const { text, chunkIndex = 0, chunkCount = 1, fileName = "", stage = "structure", operatorGuidance = "" } = req.body || {};

  if (!String(text || "").trim()) {
    return res.status(400).json({ error: "Missing script text to convert." });
  }

  if (!process.env.OPENAI_API_KEY) {
    if (stage === "normalize") {
      return res.json({
        text: simpleNormalizeText(text),
        warnings: ["AI key not configured, so a plain normalization fallback was used."]
      });
    }
    return res.json({
      lines: simpleConvertTextToLines(text),
      warnings: ["AI key not configured, so a plain conversion fallback was used."]
    });
  }

  try {
    const prompt = stage === "normalize"
      ? buildScriptNormalizationPrompt({ text, chunkIndex, chunkCount, fileName, operatorGuidance })
      : buildScriptConversionPrompt({ text, chunkIndex, chunkCount, fileName, operatorGuidance });
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
        max_tokens: 2200,
        temperature: 0.1
      })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: extractApiError(data) || `Conversion failed with status ${response.status}`
      });
    }

    const output = extractOutputText(data);

    if (stage === "normalize") {
      const parsed = parseNormalizationResponse(output);
      if (!parsed.text.trim()) {
        return res.status(502).json({ error: "The normalization model returned no screenplay text." });
      }
      return res.json(parsed);
    }

    const parsed = parseConversionResponse(output);
    if (!parsed.lines.length) {
      return res.status(502).json({ error: "The conversion model returned no screenplay blocks." });
    }

    return res.json(parsed);
  } catch (error) {
    console.error("SCRIPT CONVERSION ERROR:", error);
    return res.status(500).json({
      error: "Script conversion failed. Check your AI configuration and try again."
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

function buildScriptNormalizationPrompt({ text, chunkIndex, chunkCount, fileName, operatorGuidance = "" }) {
  return `You are pass 1 of a screenplay conversion pipeline for EyaWriter.

Your job is to turn extracted source text into clean screenplay-like plain text BEFORE block classification.

STRICT RULES:
1. Preserve every word and the original order.
2. Never summarize, omit, or rewrite meaning.
3. Merge only soft-wrapped source lines that clearly belong to the same sentence or speech.
4. Keep real paragraph or block breaks. Do not create new lines unless the source likely intended a new paragraph/block.
5. Keep scene headings, character cues, parentheticals, transitions, and action paragraphs visually distinct.
6. Do not classify into JSON blocks yet.
7. Return ONLY valid JSON.
8. Do not include markdown fences or commentary.
9. Remove source markers like [source line 12 | indent=8] from the output text.

HOW TO NORMALIZE:
- The input may contain broken PDF wraps.
- If several consecutive source lines form one spoken line or one action paragraph, merge them into a single plain text line.
- If a source break line appears between blocks, keep a blank line between those blocks in the normalized text.
- Character cues should remain on their own line.
- Parentheticals should remain on their own line.
- Dialogue should remain on its own line under the related character cue.
- Action should remain as paragraph lines, not as one word per line.

Return this exact shape:
{
  "text": "INT. KITCHEN - DAY\\n\\nSARAH\\nI am here.\\n\\nThe kettle whistles.",
  "warnings": []
}

SOURCE FILE: ${fileName || "script"}
CHUNK: ${Number(chunkIndex) + 1} of ${Number(chunkCount)}
${operatorGuidance ? `\nEDITOR GUIDANCE:\n${operatorGuidance}\nUse this guidance only to clarify structure. Do not invent or remove content.` : ""}

SOURCE TEXT:
${text}`;
}

function buildScriptConversionPrompt({ text, chunkIndex, chunkCount, fileName, operatorGuidance = "" }) {
  return `You are converting screenplay source material into structured screenplay blocks for an editor.

STRICT RULES:
1. Preserve every piece of content from the source text.
2. Keep the original order exactly.
3. Never summarize or omit content.
4. If you are unsure, use type "action".
5. Return ONLY valid JSON.
6. Use only these block types: scene, action, character, dialogue, parenthetical, transition, shot, note.
7. Do not include markdown fences or commentary.
8. Scene headings and character cues must never be dropped.
9. Dialogue and action must not be mixed into the same block.

SCREENPLAY CLASSIFICATION RULES:
- A scene heading usually starts with INT., EXT., EST., INT/EXT., or INT./EXT.
- A CHARACTER line is usually short, uppercase, and is followed by parenthetical or dialogue.
- A DIALOGUE line usually follows a character cue or parenthetical, and may span multiple wrapped source lines.
- A PARENTHETICAL is a short line in parentheses between a character and dialogue.
- ACTION is prose description at the left margin between scene headings, character cues, or transitions.
- A TRANSITION is uppercase and usually ends with TO: or is something like FADE OUT.
- If the source contains wrapped dialogue, merge the wrapped physical lines into one dialogue block.
- Do not classify ordinary narrative prose as dialogue unless it clearly follows a character cue.
- Do not convert left-margin action prose into dialogue just because it is near a character cue.

ABOUT THE SOURCE CANDIDATES:
- The source is pre-grouped into candidate screenplay blocks.
- Each candidate appears like [candidate 12 | locked-dialogue-sequence] ...
- Treat each candidate as an observed unit from the file.
- Do not create extra blocks unless a dialogue candidate explicitly contains:
  1. a CHARACTER line
  2. an optional PARENTHETICAL line
  3. one DIALOGUE line
- For ordinary action candidates, keep them as one action block instead of splitting them into many lines.
- Do not copy the [candidate ...] markers into the output text.
- Only move to a new output block when the source candidate boundary or clear screenplay structure requires it.

Return this exact shape:
{
  "lines": [
    { "type": "scene", "text": "INT. KITCHEN - DAY" }
  ],
  "warnings": []
}

SOURCE FILE: ${fileName || "script"}
CHUNK: ${Number(chunkIndex) + 1} of ${Number(chunkCount)}
${operatorGuidance ? `\nEDITOR GUIDANCE:\n${operatorGuidance}\nUse this guidance only to classify or group content more accurately. Do not invent or remove content.` : ""}

SOURCE TEXT:
${text}`;
}

function parseNormalizationResponse(output) {
  const cleaned = String(output || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : cleaned;
  const parsed = JSON.parse(candidate);
  const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
  const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings.map((item) => String(item)) : [];
  return {
    text,
    warnings
  };
}

function parseConversionResponse(output) {
  const cleaned = String(output || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : cleaned;
  const parsed = JSON.parse(candidate);
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings.map((item) => String(item)) : [];
  return { lines: normalizeConvertedLines(lines), warnings };
}

function normalizeConvertedLines(lines) {
  const allowed = new Set(["scene", "action", "character", "dialogue", "parenthetical", "transition", "shot", "note", "image"]);
  return (lines || []).reduce((accumulator, line) => {
    const text = String(line?.text || "").replace(/\r/g, "").trim();
    let type = String(line?.type || "action").trim().toLowerCase();
    if (!text) return accumulator;
    const previousType = accumulator[accumulator.length - 1]?.type || "";
    if (
      type === "action"
      && (previousType === "character" || previousType === "parenthetical")
      && looksLikeDialogueText(text)
    ) {
      type = "dialogue";
    }
    if (type === "dialogue" && previousType === "dialogue") {
      accumulator[accumulator.length - 1].text = `${accumulator[accumulator.length - 1].text} ${text}`.replace(/\s+/g, " ").trim();
      return accumulator;
    }
    accumulator.push({
      type: allowed.has(type) ? type : "action",
      text
    });
    return accumulator;
  }, []);
}

function simpleConvertTextToLines(text) {
  const rawLines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{1,2}/)
    .map((line) => line.trim())
    .filter(Boolean);

  return rawLines.map((line, index) => ({
    type: inferTypeFromText(line, rawLines[index - 1] || "", rawLines[index + 1] || ""),
    text: line
  }));
}

function simpleNormalizeText(text) {
  return String(text || "")
    .replace(/\[source break \d+\]/gi, "\n")
    .replace(/\[source line \d+ \| indent=\d+\]\s*/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferTypeFromText(line, prevLine, nextLine) {
  if (/^(INT\.|EXT\.|INT\/EXT\.|INT\.\/EXT\.|EST\.)/i.test(line)) return "scene";
  if (/^(CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|FADE OUT\.)/i.test(line)) return "transition";
  if (/^\(.*\)$/.test(line)) return "parenthetical";
  if (/^\[.*\]$/.test(line)) return "note";
  if (/^(CLOSE ON|WIDE SHOT|INSERT|POV|OVERHEAD SHOT)/i.test(line)) return "shot";
  if (looksLikeCharacter(line, prevLine, nextLine)) return "character";
  if (prevLine && looksLikeCharacter(prevLine, "", line)) return "dialogue";
  return "action";
}

function looksLikeCharacter(line, prevLine, nextLine) {
  if (!line || line.length > 32 || /:/.test(line) || /\.$/.test(line)) {
    return false;
  }
  const isUppercase = line === line.toUpperCase();
  const followedByDialogue = nextLine && !/^(INT\.|EXT\.|CUT TO:|\[|IMAGE:)/i.test(nextLine);
  const separated = !prevLine || /^(INT\.|EXT\.|\[|CUT TO:|FADE OUT\.)/i.test(prevLine);
  return isUppercase && (followedByDialogue || separated);
}

function looksLikeDialogueText(text) {
  if (!text) return false;
  if (/^(INT\.|EXT\.|CUT TO:|DISSOLVE TO:|SMASH CUT TO:|FADE OUT\.|CLOSE ON|WIDE SHOT|INSERT|POV)/i.test(text)) {
    return false;
  }
  if (/^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) {
    return false;
  }
  return !/^[A-Z0-9 .'\-()]+$/.test(text);
}
