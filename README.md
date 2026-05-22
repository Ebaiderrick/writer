# EyaWriter

A block-based screenplay editor with real-time collaboration, multi-language support, and an optional AI assistant for scene expansion, dialogue rewrites, and next-beat suggestions.

---

## Quick start

```bash
# 1. Clone and install
git clone <repo-url>
cd writer
npm run setup        # installs root + server dependencies

# 2. Configure the AI backend
cp server/.env.example server/.env
# Edit server/.env and set OPENAI_API_KEY

# 3. Start everything
npm start            # launches backend on :3001 and frontend on :8000
```

Open [http://localhost:8000](http://localhost:8000).

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| npm | 9+ |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Install all dependencies (root + server) |
| `npm start` | Start backend and frontend together |
| `npm run dev` | Same as start, with server hot-reload |
| `npm test` | Run Playwright end-to-end tests |
| `npm run test:ui` | Open Playwright's interactive UI |
| `npm run server` | Start only the AI backend |
| `npm run app` | Start only the static frontend |

---

## Environment variables

All environment variables are for the **AI backend server** only. The frontend has no build step and no `.env` file.

Copy the template and fill in your values:

```bash
cp server/.env.example server/.env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes (for AI) | — | API key from [OpenRouter](https://openrouter.ai) or OpenAI |
| `OPENAI_MODEL` | No | `openai/gpt-4o-mini` | Model identifier (OpenRouter format) |
| `OPENAI_BASE_URL` | No | `https://openrouter.ai/api/v1` | API base URL |
| `PORT` | No | `3001` | Port the backend listens on |

If `OPENAI_API_KEY` is not set, the backend runs in **test mode** and returns stub responses — useful for frontend development without a paid API key.

---

## Architecture

```
writer/
├── index.html              # Single-page app entry point
├── styles.css              # Application styles
├── js/                     # Frontend ES modules
│   ├── main.js             # Boot sequence
│   ├── config.js           # State and constants
│   ├── ui.js               # Rendering and DOM updates
│   ├── events.js           # Event handlers
│   ├── ai.js               # AI assistant client
│   ├── auth.js             # Firebase authentication
│   ├── editor.js           # Text editor and caret handling
│   ├── project.js          # Project CRUD and serialization
│   ├── collaborate.js      # Real-time Firestore collaboration
│   ├── i18n.js             # Internationalisation (EN/FR/DE/ES/IT/PT)
│   └── ...                 # Other modules
├── server/                 # Node.js AI backend
│   ├── index.js            # Express server with /api/ai-assist
│   ├── promptBuilder.js    # Prompt construction
│   ├── .env.example        # Environment variable template
│   └── package.json
├── netlify/functions/      # Serverless equivalent of server/ for Netlify
│   └── ai-assist.js
├── tests/                  # Playwright end-to-end tests
├── assets/dictionaries/    # Spell-check dictionaries
├── netlify.toml            # Netlify deployment configuration
└── playwright.config.js    # Test runner configuration
```

**Frontend** is vanilla JS (ES modules, no bundler). All CDN libraries are loaded from `index.html`:
- Firebase 10.12.0 — auth and Firestore
- Summernote 0.8.18 + jQuery 3.5.1 — rich text editing
- Three.js r128 — background animation
- DOCX 8.5.0 — Word export
- EmailJS v4 — password reset emails

**Backend** is Express + node-fetch. It proxies requests to [OpenRouter](https://openrouter.ai) and applies screenplay-specific prompt engineering and response cleaning.

---

## AI assistant

The AI endpoint is auto-detected at runtime:

1. `window.EYAWRITER_AI_API_URL` (if set)
2. `localStorage.eyawriter.aiApiUrl` (if configured in the app)
3. `http://localhost:3001/api/ai-assist` in local development
4. `/api/ai-assist` in production (proxied to Netlify function)

To use AI features:
1. Enable **AI Assistance** in the toolbar.
2. Hover or focus a script block — an **AI** button appears on that row.
3. Pick an action, optionally add a custom instruction, and submit.

---

## Deployment (Netlify)

The frontend deploys directly as a static site. The AI backend runs as a Netlify Function.

1. Connect the repository to Netlify.
2. Set `OPENAI_API_KEY` in Netlify → Site configuration → Environment variables.
3. Optionally set `OPENAI_MODEL` (defaults to `openai/gpt-4o-mini`).
4. Deploy. The `netlify.toml` handles everything else.

**No build step required.** Netlify publishes the repo root as-is and auto-deploys `netlify/functions/ai-assist.js`.

---

## Testing

```bash
# Install Playwright browsers (first time only)
npx playwright install

# Run all tests
npm test

# Run tests with interactive UI
npm run test:ui
```

Tests cover keyboard shortcuts, theme switching, context menu, grammar checking, and AI fine-tune functionality. The test runner spins up a local `http-server` automatically.

---

## Supported languages

The UI and spellcheck support: English, French, German, Spanish, Italian, Portuguese.

Switch language in **Settings → Language**.
