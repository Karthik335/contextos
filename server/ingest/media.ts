// Audio and video: ffmpeg converts, Gemma 4 transcribes (or local Whisper as fallback),
// and Gemma 4 vision reads key frames from videos.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import * as ai from "../ai.js";
import { FRAMES_READ } from "../prompts.js";
import type { Segment } from "../../shared/types.js";

export const MAX_MEDIA_SECONDS = 15 * 60;
const CHUNK_SECONDS = 30; // Gemma 4 audio limit per clip
const MAX_FRAMES = 16;

function run(bin: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: err }) : reject(new Error(`${path.basename(bin)} failed: ${err.slice(-400)}`)),
    );
  });
}

export async function probe(file: string) {
  const { stdout } = await run(ffprobe.path, [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  const info = JSON.parse(stdout.toString());
  const duration = Number(info.format?.duration ?? 0);
  const hasAudio = (info.streams ?? []).some((s: any) => s.codec_type === "audio");
  const hasVideo = (info.streams ?? []).some((s: any) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  return { duration, hasAudio, hasVideo };
}

export const mmss = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

type Progress = (step: string, progress: number) => void;

/** Transcribe the audio track of any media file into "[mm:ss] text" segments. */
export async function transcribe(file: string, workDir: string, duration: number, onProgress: Progress): Promise<Segment[]> {
  const chunks = Math.max(1, Math.ceil(duration / CHUNK_SECONDS));
  onProgress(`Converting audio`, 0.1);

  // Cloud first (audio-capable Gemma, else Gemini); local Whisper if no cloud model or if it fails.
  if (!(await ai.canTranscribeInCloud())) return transcribeWithWhisper(file, duration, onProgress);
  try {
    return await transcribeInCloud(file, workDir, duration, chunks, onProgress);
  } catch (err) {
    console.warn("[media] cloud transcription failed, trying local Whisper:", String(err).slice(0, 160));
    try {
      return await transcribeWithWhisper(file, duration, onProgress);
    } catch {
      throw err;
    }
  }
}

async function transcribeInCloud(file: string, workDir: string, duration: number, chunks: number, onProgress: Progress): Promise<Segment[]> {
  const segments: Segment[] = new Array(chunks);
  let done = 0;
  const work = Array.from({ length: chunks }, (_, i) => i);
  const worker = async () => {
    while (work.length) {
      const i = work.shift()!;
      const start = i * CHUNK_SECONDS;
      const out = path.join(workDir, `chunk_${i}.wav`);
      await run(ffmpegPath as unknown as string, [
        "-y", "-v", "error", "-ss", String(start), "-t", String(CHUNK_SECONDS), "-i", file,
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", out,
      ]);
      const base64 = (await fs.readFile(out)).toString("base64");
      const text = await ai.audioChunk({ mimeType: "audio/wav", base64 });
      segments[i] = { location: mmss(start), text: text.trim().replace(/^\(no speech\)$/i, "") || "(no speech)" };
      done++;
      onProgress(`Transcribing ${mmss(start)}–${mmss(Math.min(duration, start + CHUNK_SECONDS))} (${done} of ${chunks})`, 0.15 + 0.55 * (done / chunks));
    }
  };
  await Promise.all([worker(), worker()]);
  return cleanTranscript(segments.filter((s) => s && s.text !== "(no speech)"), duration);
}

/* ---------------- Whisper (open-source speech-to-text, runs on this server's CPU) ---------------- */

// Whisper "base", 8-bit quantized: about 80 MB, fits Render's 512 MB free plan.
// The first run downloads the model once (needs internet); after that it works offline.
const WHISPER_MODEL = process.env.WHISPER_MODEL || "Xenova/whisper-base";
const WHISPER_CACHE = path.resolve(".cache", "whisper");
let asrPromise: Promise<any> | null = null;
let asrReady = false;

/** Load Whisper once and keep it in memory (loading takes far longer than transcribing a short clip). */
function loadWhisper(): Promise<any> {
  if (!asrPromise) {
    const started = Date.now();
    asrPromise = (async () => {
      let mod: any;
      try {
        // Optional dependency: npm install @huggingface/transformers
        mod = await import(/* @vite-ignore */ "@huggingface/" + "transformers");
      } catch {
        throw new Error("Audio needs the Whisper package: run npm install (it installs @huggingface/transformers).");
      }
      // WHISPER_DEVICE=dml uses the GPU on Windows (DirectML), =cuda on NVIDIA+Linux; falls back to CPU.
      const wanted = (process.env.WHISPER_DEVICE || "cpu").toLowerCase();
      const devices = wanted === "cpu" ? ["cpu"] : [wanted, "cpu"];
      let asr: any;
      let device = "cpu";
      for (const d of devices) {
        try {
          const dtype = process.env.WHISPER_DTYPE || (d === "cpu" ? "q8" : "fp32"); // GPUs prefer fp32/fp16
          asr = await mod.pipeline("automatic-speech-recognition", WHISPER_MODEL, { dtype, device: d });
          device = d;
          break;
        } catch (err: any) {
          if (d === "cpu") throw err;
          console.warn(`[whisper] device "${d}" not available (${String(err?.message ?? err).slice(0, 120)}); using the CPU`);
        }
      }
      asrReady = true;
      console.log(`[whisper] ${WHISPER_MODEL} loaded on ${device.toUpperCase()} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return asr;
    })();
    asrPromise.catch(() => (asrPromise = null)); // allow another try later
  }
  return asrPromise;
}

/** Called at server start, so the first audio file in a demo doesn't wait for Whisper to load. */
/** AUDIO_TRANSCRIPTION=off: for small hosted servers (e.g. Render free, 512 MB), where Whisper runs out of memory. */
export const AUDIO_OFF = process.env.AUDIO_TRANSCRIPTION === "off";
export const AUDIO_OFF_MESSAGE =
  "Audio transcription is turned off on this hosted demo (the free server doesn't have enough memory for Whisper). Run ContextOS locally to read audio, or upload a document instead.";

export function warmUpWhisper() {
  if (process.env.WHISPER_WARMUP === "0" || AUDIO_OFF) return;
  loadWhisper().catch((err) => console.warn("[whisper] warm-up failed (audio will retry on first use):", String(err?.message ?? err).slice(0, 160)));
}

async function transcribeWithWhisper(file: string, duration: number, onProgress: Progress): Promise<Segment[]> {
  ai.modelUsage.getStore()?.add(`whisper-${WHISPER_MODEL.split("whisper-")[1] ?? "base"}`);

  // Same audio again (e.g. a rehearsed demo): reuse the saved transcript.
  const bytes = await fs.readFile(file);
  const key = createHash("sha256").update(WHISPER_MODEL + ":v2-capped").update(bytes).digest("hex");
  const cacheFile = path.join(WHISPER_CACHE, key + ".json");
  try {
    const hit = JSON.parse(await fs.readFile(cacheFile, "utf8")) as Segment[];
    onProgress("Transcript ready (saved from before)", 0.7);
    return hit;
  } catch {
    /* not cached */
  }

  if (!asrReady) onProgress("Loading Whisper (only the first time)", 0.15);
  const asrP = loadWhisper();
  const { stdout } = await run(ffmpegPath as unknown as string, [
    "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1",
  ]);
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  const asr = await asrP;
  onProgress(`Transcribing ${mmss(duration)} of audio with Whisper`, 0.35);
  const started = Date.now();
  // Cap the output by the clip length (people say at most ~4 words, ~6 tokens, per second).
  // On non-speech sounds (music, animals) Whisper otherwise "hallucinates" up to 448 tokens per
  // 30 s window, which can take minutes on a CPU. Real speech is never longer than this cap.
  const maxNewTokens = Math.min(224, Math.ceil(Math.min(duration, 30) * 6) + 24);
  const out: any = await asr(samples, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    language: "english",
    task: "transcribe",
    max_new_tokens: maxNewTokens,
    no_repeat_ngram_size: 4,
  });
  console.log(`[whisper] ${mmss(duration)} transcribed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const chunks: any[] = out.chunks ?? [{ timestamp: [0], text: out.text }];
  const segments = cleanTranscript(
    chunks.filter((c) => c.text?.trim()).map((c) => ({ location: mmss(c.timestamp?.[0] ?? 0), text: c.text.trim() })),
    duration,
  );
  await fs.mkdir(WHISPER_CACHE, { recursive: true }).catch(() => {});
  await fs.writeFile(cacheFile, JSON.stringify(segments)).catch(() => {});
  return segments;
}

/**
 * Whisper can "hallucinate" repeated text on music or non-speech sounds.
 * Drop repeated sentences/segments and cap the length to what is humanly speakable.
 */
export function cleanTranscript(segments: Segment[], duration: number): Segment[] {
  const out: Segment[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const sentences = seg.text.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];
    for (const sent of sentences) {
      const key = sent.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      kept.push(sent);
    }
    if (kept.length) out.push({ location: seg.location, text: kept.join(" ") });
  }
  // People speak at most ~4 words per second.
  const maxWords = Math.max(30, Math.ceil(duration * 4));
  let words = 0;
  const capped: Segment[] = [];
  for (const seg of out) {
    const n = seg.text.split(/\s+/).length;
    if (words + n > maxWords) break;
    words += n;
    capped.push(seg);
  }
  return capped.length ? capped : [{ location: "00:00", text: "(no clear speech detected; only sounds)" }];
}

/** Pick evenly spaced frames from a video and let Gemma 4 vision read them. */
export async function readFrames(
  file: string,
  workDir: string,
  duration: number,
  onProgress: Progress,
): Promise<{ segments: Segment[]; frames: { t: number; dataUrl: string }[] }> {
  const maxFrames = ai.privateMode.getStore() ? 6 : MAX_FRAMES; // local GPU: fewer frames
  const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration / 8)));
  const times = Array.from({ length: count }, (_, i) => Math.min(duration - 0.5, (duration / count) * (i + 0.5)));
  const frames: { t: number; buf: Buffer }[] = [];
  for (const t of times) {
    const out = path.join(workDir, `frame_${Math.round(t * 10)}.jpg`);
    await run(ffmpegPath as unknown as string, [
      "-y", "-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "4", out,
    ]);
    frames.push({ t, buf: await fs.readFile(out) });
  }

  const segments: Segment[] = [];
  for (let i = 0; i < frames.length; i += 4) {
    const batch = frames.slice(i, i + 4);
    onProgress(`Reading video frames ${i + 1}–${i + batch.length} of ${frames.length}`, 0.7 + 0.15 * (i / frames.length));
    const reply = await ai.vision(
      batch.map((f) => ({ mimeType: "image/jpeg", base64: f.buf.toString("base64") })),
      FRAMES_READ(batch.map((f) => mmss(f.t))),
    );
    for (const line of reply.split("\n")) {
      const m = /^\[(\d{2}:\d{2})\]\s*(.*)$/.exec(line.trim());
      if (m && !/\(on screen\)\s*—\s*$/.test(m[2])) segments.push({ location: m[1], text: m[2] });
    }
  }

  // Small thumbnails for the source viewer.
  const thumbs = frames.filter((_, i) => i % Math.ceil(frames.length / 6) === 0).slice(0, 6);
  return {
    segments,
    frames: thumbs.map((f) => ({ t: f.t, dataUrl: `data:image/jpeg;base64,${f.buf.toString("base64")}` })),
  };
}

/** Merge speech and on-screen segments into one timeline sorted by time. */
export function mergeTimeline(speech: Segment[], screen: Segment[]): Segment[] {
  const toSec = (l: string) => {
    const [m, s] = l.split(":").map(Number);
    return m * 60 + s;
  };
  return [
    ...speech.map((s) => ({ ...s, text: `(speech) ${s.text}` })),
    ...screen.map((s) => ({ ...s, text: s.text.startsWith("(on screen)") ? s.text : `(on screen) ${s.text}` })),
  ].sort((a, b) => toSec(a.location) - toSec(b.location));
}
