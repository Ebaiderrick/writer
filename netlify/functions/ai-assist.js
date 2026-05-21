import { adminAuth, adminDb } from './_admin.js';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "openai/gpt-3.5-turbo";
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1";

const ALLOWED_TYPES = new Set(["scene", "dialogue", "action", "character", "parenthetical", "transition", "shot", "general", "script"]);
const ALLOWED_ACTIONS = new Set(["Predict", "Expand", "Fix", "Add Conflict", "Cinematic", "Suggest Reply", "Rephrase", "Add Emotion", "Shorten", "Subtext", "Continue", "Visualize", "Add Tension", "Describe", "Grammar", "Camera Angle", "Improve Shot", "Add Movement", "Improve"]);
const MAX_CURRENT = 4000;
const MAX_CONTEXT = 15000;
const MAX_INSTRUCTION = 500;

const JSON_HEADERS = { "Content-Type": "application/json" };

function newRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function jsonHeaders(requestId) {
  return { ...JSON_HEADERS, "X-Request-Id": requestId };
}

function badRequest(msg, requestId = "") {
  return { statusCode: 400, headers: jsonHeaders(requestId), body: JSON.stringify({ error: msg }) };
}

export const handler = async (event) => {
  const requestId = newRequestId();

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: jsonHeaders(requestId), body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return badRequest("Invalid JSON", requestId);
  }

  const { type, action, current, context: screenplayContext, instruction } = body;

  if (current === undefined || current === null) return badRequest("Missing current block", requestId);
  if (type && !ALLOWED_TYPES.has(type)) return badRequest("Invalid block type", requestId);
  if (action && !ALLOWED_ACTIONS.has(action)) return badRequest("Invalid action", requestId);
  if (typeof current === "string" && current.length > MAX_CURRENT) return badRequest("Content too long", requestId);
  if (typeof screenplayContext === "string" && screenplayContext.length > MAX_CONTEXT) return badRequest("Context too long", requestId);
  if (typeof instruction === "string" && instruction.length > MAX_INSTRUCTION) return badRequest("Instruction too long", requestId);

  console.log(`[${requestId}] AI request type=${type || "?"} action=${action || "?"}`);

  // Quota enforcement
  const FREE_MONTHLY_QUOTA = 50;
  let quotaUid = null;
  let isProUser = false;

  if (adminAuth && adminDb) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token) {
      try {
        const decoded = await adminAuth.verifyIdToken(token);
        quotaUid = decoded.uid;
      } catch { /* treat as anonymous */ }
    }
    if (quotaUid) {
      try {
        const qSnap = await adminDb.doc(`users/${quotaUid}/quota/current`).get();
        if (qSnap.exists) {
          const q = qSnap.data();
          isProUser = q.plan === 'pro';
          if (!isProUser) {
            const pastReset = q.resetAt && new Date() >= new Date(q.resetAt);
            const usedCount = pastReset ? 0 : (q.count || 0);
            if (usedCount >= FREE_MONTHLY_QUOTA) {
              return {
                statusCode: 429,
                headers: jsonHeaders(requestId),
                body: JSON.stringify({ error: 'quota_exceeded', remaining: 0 })
              };
            }
          }
        }
      } catch { /* quota check failed — allow request */ }
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      statusCode: 200,
      headers: jsonHeaders(requestId),
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
      console.error(`[${requestId}] Upstream API error status=${response.status}`);
      return {
        statusCode: response.status,
        headers: jsonHeaders(requestId),
        body: JSON.stringify({
          error: extractApiError(data) || `AI request failed with status ${response.status}`
        }),
      };
    }

    let output = extractOutputText(data);
    output = cleanAiResponse(output, current);

    if (!output) {
      return { statusCode: 500, headers: jsonHeaders(requestId), body: JSON.stringify({ error: "AI assistant returned no text." }) };
    }

    console.log(`[${requestId}] AI request completed successfully`);

    // Increment quota for non-pro authenticated users
    if (adminDb && quotaUid && !isProUser) {
      try {
        const ref = adminDb.doc(`users/${quotaUid}/quota/current`);
        const now = new Date();
        const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const qSnap = await ref.get();
        const q = qSnap.exists ? qSnap.data() : {};
        const pastReset = !q.resetAt || now >= new Date(q.resetAt);
        if (pastReset) {
          await ref.set({ count: 1, resetAt: nextReset.toISOString(), plan: q.plan || 'free' }, { merge: true });
        } else {
          await ref.set({ count: (q.count || 0) + 1 }, { merge: true });
        }
      } catch { /* silent */ }
    }

    return { statusCode: 200, headers: jsonHeaders(requestId), body: JSON.stringify({ output }) };
  } catch (error) {
    console.error(`[${requestId}] AI function error:`, error.message || error);
    return {
      statusCode: 500,
      headers: jsonHeaders(requestId),
      body: JSON.stringify({ error: "AI request failed. Please try again." }),
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
