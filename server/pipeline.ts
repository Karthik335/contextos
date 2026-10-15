// Background jobs: convert a file into text segments, then let Gemma 4 extract facts.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import * as ai from "./ai.js";
import { statusOf } from "./ai.js";
const isPrivateNow = () => ai.privateMode.getStore() === true;
import { extractFacts } from "./prompts.js";
import { Extraction } from "./schemas.js";
import { readDocx, readImage, readPdf, readPptx, readSheet, readText } from "./ingest/documents.js";
import { AUDIO_OFF, AUDIO_OFF_MESSAGE, MAX_MEDIA_SECONDS, mergeTimeline, mmss, probe, readFrames, transcribe } from "./ingest/media.js";
import type { Fact, JobStatus, Segment, SourceKind, SourceResult } from "../shared/types.js";

const jobs = new Map<string, JobStatus>();
const JOB_TTL_MS = 60 * 60 * 1000;

export function getJob(id: string) {
  return jobs.get(id);
}

export function kindOf(name: string, mime: string): SourceKind | null {
  const ext = path.extname(name).toLowerCase().slice(1);
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext) || mime.startsWith("image/")) return "image";
  if (ext === "pdf") return "pdf";
  if (["docx", "pptx"].includes(ext)) return "doc";
  if (["xlsx", "xls", "csv"].includes(ext)) return "sheet";
  if (["txt", "md", "markdown", "html", "htm", "json"].includes(ext) || mime.startsWith("text/")) return "text";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"].includes(ext) || mime.startsWith("audio/")) return "audio";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext) || mime.startsWith("video/")) return "video";
  return null;
}

/** Start processing an uploaded file. Returns immediately with a job id. */
export function startJob(file: { path: string; originalname: string; mimetype: string }, sourceId: string, isPrivate = false): string {
  const id = randomUUID();
  const job: JobStatus = { id, status: "queued", step: "Queued", progress: 0 };
  jobs.set(id, job);
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();

  const onProgress = (step: string, progress: number) => {
    job.status = "running";
    job.step = step;
    job.progress = Math.max(job.progress, Math.min(0.99, progress));
  };

  const used = new Set<string>();
  ai.privateMode
    .run(isPrivate, () =>
      ai.modelUsage.run(used, () => ai.waitNotifier.run((msg) => onProgress(msg, job.progress), () => process(file, sourceId, onProgress))),
    )
    .then((result) => {
      result.models = [...used];
      job.result = result;
      job.status = "done";
      job.step = `${result.facts.length} facts`;
      job.progress = 1;
    })
    .catch((err) => {
      console.error(`[job ${id}]`, err);
      job.status = "error";
      job.error = friendlyError(err);
      job.step = "Error";
    })
    .finally(() => fs.rm(file.path, { force: true }).catch(() => {}));

  return id;
}

function friendlyError(err: unknown) {
  const raw = String((err as any)?.message ?? err);
  // Google errors arrive as JSON text: pull out the human message.
  const inner = /"message"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? raw;
  const status = statusOf(err);
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(raw)) return "The API key was rejected. Check GEMINI_API_KEY in .env.";
  if (status === 404 || (/not found|NOT_FOUND/i.test(raw) && /model/i.test(raw))) return `Model not found. Check GEMMA_MODEL in .env (${inner.slice(0, 80)})`;
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw))
    return /PerDay|per day|daily/i.test(raw)
      ? "Gemma's free DAILY limit is used up on this API key (resets ~1:30 pm India time)."
      : "Free-tier per-minute limit reached. Wait a minute, then click Retry.";
  if (status >= 500) return "Google's Gemma API had an internal error on this file. Retry, or try a smaller file.";
  if (/abort|timeout/i.test(raw)) return "Gemma took too long to answer. Retry, or try a smaller file.";
  return inner.slice(0, 200);
}

async function process(
  file: { path: string; originalname: string; mimetype: string },
  sourceId: string,
  onProgress: (step: string, p: number) => void,
): Promise<SourceResult> {
  const name = file.originalname;
  const kind = kindOf(name, file.mimetype);
  if (!kind) throw new Error(`Unsupported file type: ${name}`);
  const ext = path.extname(name).toLowerCase();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-"));

  try {
    let segments: Segment[] = [];
    const notes: string[] = [];
    let durationSec: number | undefined;
    let frames: { t: number; dataUrl: string }[] | undefined;

    onProgress("Converting", 0.05);
    switch (kind) {
      case "image":
        segments = await readImage(file.path, onProgress);
        break;
      case "pdf": {
        const r = await readPdf(file.path, onProgress);
        segments = r.segments;
        notes.push(...r.notes);
        break;
      }
      case "doc":
        segments = ext === ".pptx" ? await readPptx(file.path) : await readDocx(file.path);
        break;
      case "sheet":
        segments = await readSheet(file.path);
        break;
      case "text":
        segments = await readText(file.path, ext === ".html" || ext === ".htm");
        break;
      case "audio":
      case "video": {
        const info = await probe(file.path);
        durationSec = info.duration;
        if (info.duration > MAX_MEDIA_SECONDS)
          throw new Error(`Media is ${mmss(info.duration)} long; the limit is ${MAX_MEDIA_SECONDS / 60} minutes.`);
        // Small hosted servers can't run Whisper: audio files get a clear message, videos are read from frames only.
        if (AUDIO_OFF && kind === "audio") throw new Error(AUDIO_OFF_MESSAGE);
        const speech = info.hasAudio && !AUDIO_OFF ? await transcribe(file.path, workDir, info.duration, onProgress) : [];
        if (AUDIO_OFF && info.hasAudio) notes.push("Speech in this video was not transcribed (audio is turned off on this hosted demo).");
        if (kind === "video" && info.hasVideo) {
          const r = await readFrames(file.path, workDir, info.duration, onProgress);
          frames = r.frames;
          segments = mergeTimeline(speech, r.segments);
        } else {
          segments = speech;
        }
        if (!info.hasAudio && kind === "audio") notes.push("No audio track found.");
        break;
      }
    }

    if (!segments.length || segments.every((s) => !s.text.trim())) {
      return { summary: "No readable content found in this file.", facts: [], segments: [], durationSec, frames, notes };
    }
    // Audio with no speech (music, animal sounds…): nothing to extract, no model call needed.
    if (kind === "audio" && segments.every((s) => /no clear speech|^\(.*\)$/i.test(s.text.trim()))) {
      return { summary: "Audio with no clear speech (only sounds), so there are no facts to extract.", facts: [], segments, durationSec, frames, notes };
    }

    onProgress(isPrivateNow() ? "Extracting facts with Gemma 4 on this computer" : "Extracting facts with Gemma 4", 0.88);
    try {
      const facts = await extract(name, kind, segments, sourceId, onProgress);
      return { summary: facts.summary, facts: facts.facts, segments, durationSec, frames, notes };
    } catch (err) {
      // Audio/video were already transcribed: keep the transcript so the co-pilot can still use it.
      if (kind !== "audio" && kind !== "video") throw err;
      const reason = friendlyError(err);
      console.warn(`[pipeline] fact extraction failed for ${name}, keeping transcript:`, reason);
      return {
        summary: `Transcribed (${segments.length} part${segments.length === 1 ? "" : "s"}). Facts could not be extracted, but you can still ask about it.`,
        facts: [],
        segments,
        durationSec,
        frames,
        notes: [...notes, `Fact extraction skipped: ${reason}`],
      };
    }
  } finally {
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Gemma reads the segments and returns structured facts. Long sources are processed in batches. */
async function extract(name: string, kind: string, segments: Segment[], sourceId: string, onProgress?: (step: string, p: number) => void) {
  const batches: Segment[][] = [];
  let cur: Segment[] = [];
  let size = 0;
  for (const s of segments) {
    if (size + s.text.length > 9000 && cur.length) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += s.text.length;
  }
  if (cur.length) batches.push(cur);

  const summaries: string[] = [];
  const facts: Fact[] = [];
  for (const [bi, batch] of batches.slice(0, 12).entries()) {
    if (batches.length > 1) onProgress?.(`Extracting facts (part ${bi + 1} of ${Math.min(12, batches.length)})`, 0.88 + 0.1 * (bi / batches.length));
    const out = await ai.json(extractFacts(name, kind, batch), (v) => Extraction.parse(v), 3072, "fast");
    if (out.summary) summaries.push(out.summary);
    for (const f of out.facts) {
      facts.push({
        id: `${sourceId}:${facts.length}`,
        text: f.text,
        type: f.type,
        date: f.date,
        startTime: f.startTime,
        endTime: f.endTime,
        quote: f.quote,
        location: f.location?.replace(/^\[|\]$/g, ""),
        certainty: f.certainty,
      });
    }
  }
  return { summary: summaries[0] ?? `${name}`, facts };
}
