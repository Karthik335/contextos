// ContextOS server: API routes + serves the React app.
import "./env.js";
import express from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { planActions } from "./actions.js";
import { existsSync } from "node:fs";
import { z } from "zod";
import * as ai from "./ai.js";
import { getJob, kindOf, startJob } from "./pipeline.js";
import { warmUpWhisper } from "./ingest/media.js";
import { buildChat, runAnalysis } from "./analysis.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production" || process.argv.includes("--prod");

app.use(express.json({ limit: "25mb" }));

const upload = multer({
  dest: path.join(os.tmpdir(), "contextos-uploads"),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// Health / config check used by the UI banner.
app.get("/api/status", async (_req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY;
  res.json({
    mock: ai.MOCK,
    model: ai.MODEL,
    audioModel: ai.AUDIO_MODEL || (process.env.SARVAM_API_KEY ? `Sarvam AI ${process.env.SARVAM_MODEL || "saaras:v4"} (Whisper offline)` : null),
    backupModel: hasKey ? await ai.geminiModel() : null,
    fastModel: ai.FAST_MODEL || null,
    local: await ai.localStatus(),
    reasoningModel: ai.REASONING_MODEL,
    visionFirst: ai.VISION_FIRST,
    hasKey,
    audio: process.env.SARVAM_API_KEY ? "sarvam" : process.env.AUDIO_TRANSCRIPTION === "off" ? "off" : "whisper",
  });
});

// 1. Upload one file → background job.
app.post("/api/sources", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });
  // multer decodes names as latin1; fix UTF-8 names.
  file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
  if (!kindOf(file.originalname, file.mimetype))
    return res.status(415).json({ error: `Unsupported file type: ${file.originalname}` });
  const sourceId = String(req.body?.sourceId || Date.now().toString(36));
  const jobId = startJob(file, sourceId, req.body?.private === "1");
  res.json({ jobId });
});

// 2. Poll job status.
app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found (it may have expired). Please re-upload." });
  res.json(job);
});

const FactZ = z.object({
  id: z.string(),
  text: z.string(),
  type: z.string(),
  date: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  quote: z.string().optional(),
  location: z.string().optional(),
  certainty: z.enum(["stated", "inferred"]),
});
const SourceZ = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  summary: z.string(),
  facts: z.array(FactZ),
  text: z.string().optional(),
});

// 3. Analyse all facts in a chat or context.
app.post("/api/analyze", async (req, res) => {
  try {
    const body = z.object({ sources: z.array(SourceZ), instructions: z.string().optional(), language: z.string().max(40).optional(), private: z.boolean().optional() }).parse(req.body);
    const used = new Set<string>();
    const analysis = await ai.privateMode.run(!!body.private, () => ai.modelUsage.run(used, () => runAnalysis(body.sources as any, body.instructions, body.language)));
    analysis.models = [...used];
    res.json(analysis);
  } catch (err: any) {
    console.error("[analyze]", err);
    res.status(500).json({ error: String(err?.message ?? err).slice(0, 300) });
  }
});

// 3b. "Act on it": Gemma 4 proposes tool calls (calendar events, messages, checklist).
app.post("/api/actions", async (req, res) => {
  try {
    const body = z
      .object({ sources: z.array(SourceZ), analysis: z.any().optional(), instructions: z.string().optional(), language: z.string().max(40).optional(), private: z.boolean().optional() })
      .parse(req.body);
    const used = new Set<string>();
    const plan = await ai.privateMode.run(!!body.private, () => ai.modelUsage.run(used, () => planActions(body.sources as any, body.analysis, body.instructions, body.language)));
    plan.models = [...used];
    res.json(plan);
  } catch (err: any) {
    console.error("[actions]", err);
    res.status(500).json({ error: String(err?.message ?? err).slice(0, 300) });
  }
});

// 4. Co-pilot chat, streamed as plain text.
app.post("/api/chat", async (req, res) => {
  let body;
  try {
    body = z
      .object({
        sources: z.array(SourceZ),
        analysis: z.any().optional(),
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
        instructions: z.string().optional(),
        language: z.string().max(40).optional(),
        private: z.boolean().optional(),
      })
      .parse(req.body);
  } catch (err: any) {
    return res.status(400).json({ error: String(err?.message ?? err).slice(0, 300) });
  }
  const send = (model: string) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Model", model);
  };
  try {
    const { model, stream } = await ai.privateMode.run(!!body.private, () => {
      const { contents } = buildChat(body.sources as any, body.analysis, body.history, body.instructions, body.language);
      return ai.streamChat(contents);
    });
    send(model);
    try {
      for await (const piece of stream) res.write(piece);
    } catch (err: any) {
      res.write(`\n\n⚠️ The answer was cut off: ${String(err?.message ?? err).slice(0, 160)}`);
    }
  } catch (err: any) {
    console.error("[chat]", err);
    const status = ai.statusOf(err);
    const raw = String(err?.message ?? err);
    // Google sometimes returns 500/503 on streamed requests. Retry once without streaming,
    // with a smaller context, before giving up.
    if (!body.private && (status >= 500 || /INTERNAL|UNAVAILABLE|overloaded/i.test(raw))) {
      try {
        const { contents } = buildChat(body.sources as any, body.analysis, body.history, body.instructions, body.language, 6_000);
        const { model, text } = await ai.completeChat(contents);
        console.log(`[chat] recovered without streaming on ${model}`);
        if (!res.headersSent) send(model);
        res.write(text);
        return res.end();
      } catch (err2: any) {
        console.error("[chat] fallback also failed", err2);
      }
      // Last resort on a laptop: the same Gemma 4 family running locally through Ollama.
      try {
        const local = await ai.localStatus();
        if (local.running && local.hasModel) {
          const { model, stream } = await ai.privateMode.run(true, () => {
            const { contents } = buildChat(body.sources as any, body.analysis, body.history, body.instructions, body.language);
            return ai.streamChat(contents);
          });
          console.log("[chat] recovered with local Gemma");
          if (!res.headersSent) send(model);
          for await (const piece of stream) res.write(piece);
          return res.end();
        }
      } catch (err3: any) {
        console.error("[chat] local fallback failed", err3);
      }
    }
    if (!res.headersSent) send("none");
    res.write(
      status === 429
        ? /PerDay|per day|daily/i.test(raw)
          ? "⚠️ The Gemma free tier's DAILY limit is used up on this API key. It resets at midnight Pacific time (about 1:30 pm India time). Until then, use a different API key, or replay cached answers from earlier runs."
          : "⚠️ The free-tier per-minute limit was reached. Wait about a minute, then ask again."
        : status >= 500 || /INTERNAL|UNAVAILABLE/i.test(raw)
          ? "⚠️ Google's Gemma service had a temporary problem answering this. Please send your question again in a few seconds."
          : `⚠️ No model could answer right now (${raw.replace(/\s+/g, " ").slice(0, 160)}). Please try again.`,
    );
  }
  res.end();
});

// Serve the frontend.
if (isProd) {
  const dist = path.resolve("dist");
  if (!existsSync(dist)) console.warn("dist/ not found: run `npm run build` first.");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(PORT, "0.0.0.0", () => {
  if (!ai.MOCK && process.env.GEMINI_API_KEY) void ai.geminiModel(); // discover the backup model early
  // Load Whisper in the background now, so the first audio file isn't slow.
  if (!ai.MOCK && !ai.AUDIO_MODEL) setTimeout(() => warmUpWhisper(), 3000);
  console.log(`ContextOS running on http://localhost:${PORT}`);
  console.log(
    ai.MOCK
      ? "MOCK_AI=1: rule-based stand-in, NOT Gemma."
      : `Gemma 4: ${ai.MODEL} (vision), ${ai.FAST_MODEL || ai.MODEL} (extraction), ${ai.REASONING_MODEL} (reasoning + chat); audio: ${ai.AUDIO_MODEL || (process.env.SARVAM_API_KEY ? "Sarvam AI (Whisper for Private mode)" : "Whisper (local)")}${process.env.GEMINI_API_KEY ? "" : " (GEMINI_API_KEY missing!)"}`,
  );
});
