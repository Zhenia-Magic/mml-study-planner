import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, "..", "cache", "storage.json");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

const DIST_DIR = path.join(__dirname, "..", "dist");

const app = express();
app.use(express.json({ limit: "2mb" }));

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

async function writeCache(data) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
}

// Replaces window.storage.get(key) -> { value }
app.get("/api/storage/:key", async (req, res) => {
  const cache = await readCache();
  const value = cache[req.params.key];
  if (value === undefined) return res.json(null);
  res.json({ value });
});

// Replaces window.storage.set(key, value)
app.post("/api/storage/:key", async (req, res) => {
  const cache = await readCache();
  cache[req.params.key] = req.body.value;
  await writeCache(cache);
  res.json({ ok: true });
});

// Proxies fetch("https://api.anthropic.com/v1/messages")
app.post("/api/messages", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY is not set on the server (.env)" } });
  }
  try {
    const body = { ...req.body, model: req.body.model || ANTHROPIC_MODEL };
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

// Serve the built frontend (vite build output) in production. In dev, vite's own
// server handles the frontend separately and this directory won't exist yet.
app.use(express.static(DIST_DIR));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API server listening on http://localhost:${PORT}`));
