# EyaWriter

EyaWriter is a screenplay editor with a block-based writing workflow and an optional AI assistant for scene expansion, dialogue rewrites, and next-beat suggestions.

## Run the AI backend

1. Open a terminal in `server/`.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`.
5. Run `npm start`.

If `OPENAI_API_KEY` is missing, the backend stays in mock mode and returns placeholder AI output for UI testing. If `OPENAI_API_KEY` is present but `OPENAI_MODEL` is missing, the AI endpoint now returns a clear configuration error instead of silently relying on a baked-in model name.

The frontend can be opened separately, but the AI assistant needs the backend running on port `3001` unless you configure a different endpoint through `window.EYAWRITER_AI_API_URL` or `localStorage.eyawriter.aiApiUrl`. `OPENAI_BASE_URL` is optional and defaults to `https://api.openai.com/v1`.

## AI usage

- Turn on `AI Assistance`.
- Hover or focus a script block and click the `AI` button on that row.
- Pick an action, optionally add an instruction, then submit.
