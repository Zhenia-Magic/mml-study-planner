# MML Study Planner (local)

Local version of the Claude-artifact study planner, with:

- A small Express server (`server/index.js`) that proxies requests to the
  Anthropic API using your own API key (kept server-side, no CORS issues).
- A file-based cache (`cache/storage.json`) that replaces the artifact-only
  `window.storage` API, so generated explanations and your completed-section
  progress persist across runs.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
npm run dev
```

This starts the Vite dev server (frontend) and the Express API server
together. Open the URL Vite prints (usually http://localhost:5173).

## Notes

- `cache/storage.json` is created automatically and is gitignored — delete it
  to clear cached explanations/progress.
- The model used can be overridden via `ANTHROPIC_MODEL` in `.env`.
