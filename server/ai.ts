// Every call to an AI model goes through this file, so models can be swapped in one place.
//
// ContextOS runs on open models only. Two Gemma 4 models are routed per task:
//   - GEMMA_MODEL (31B dense): reads images, connects sources, answers in the co-pilot.
//   - GEMMA_FAST_MODEL (26B A4B mixture-of-experts): fast fact extraction from text.
// Audio uses an audio-capable Gemma 4 model if configured, otherwise open-source Whisper locally.
// Reliability: minimal thinking, small requests, retries on the same model, and a disk cache
// of real Gemma answers (so a repeated demo is instant). A Gemini backup exists but is OFF
// unless GEMINI_BACKUP=1 is set.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { GoogleGenAI, ThinkingLevel, type Content, type Part, type ThinkingConfig } from "@google/genai";
import * as mock from "./mock.js";
import * as local from "./local.js";

export const MOCK = process.env.MOCK_AI === "1";
export const MODEL = process.env.GEMMA_MODEL || "gemma-4-31b-it";
export const AUDIO_MODEL = process.env.GEMMA_AUDIO_MODEL || "";
/** Fast Gemma 4 model for text-only work (it cannot read images). Set to "" to use GEMMA_MODEL for everything. */
export const FAST_MODEL = process.env.GEMMA_FAST_MODEL ?? (MODEL.includes("31b") ? "gemma-4-26b-a4b-it" : "");
/**
 * Model for reasoning (connecting sources) and the co-pilot chat.
 * Defaults to the fast model: on the free API, 31B answers take ~40 s while 26B takes ~5 s.
 * Set GEMMA_REASONING_MODEL=gemma-4-31b-it to use 31B for reasoning too.
 */
export const REASONING_MODEL = process.env.GEMMA_REASONING_MODEL || FAST_MODEL || MODEL;
/** Optional, off by default: GEMINI_BACKUP=1 adds a Gemini Flash model as a last resort. */
const GEMINI_BACKUP = process.env.GEMINI_BACKUP === "1";
const CACHE = process.env.AI_CACHE !== "0";
const CACHE_DIR = path.resolve(".cache", "ai");
/** "gemma" (default) tries Gemma first for images; "gemini" reads images with Gemini first. */
export const VISION_FIRST = process.env.VISION_FIRST === "gemini" ? "gemini" : "gemma";
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 150_000;
const VISION_TIMEOUT_MS = Number(process.env.AI_VISION_TIMEOUT_MS) || 90_000;

let client: GoogleGenAI | null = null;
function ai() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to your secrets / .env file.");
    // GEMINI_BASE_URL is only for testing against a fake server.
    client = new GoogleGenAI({ apiKey, ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}) });
  }
  return client;
}

/** Private mode for the current request/job: every model call goes to local Gemma (Ollama). */
export const privateMode = new AsyncLocalStorage<boolean>();
// A hosted server (Render) can never reach Ollama on a laptop, so Private mode is ignored there.
export const isPrivate = () => !MOCK && !local.HOSTED && privateMode.getStore() === true;
export const LOCAL_MODEL = local.LOCAL_MODEL;
export const localStatus = local.localStatus;

/** Turn Gemini-style contents into Ollama messages. */
function toLocal(contents: Content[]): local.LocalMessage[] {
  return contents.map((c) => {
    const images = (c.parts ?? []).filter((p) => p.inlineData?.data).map((p) => p.inlineData!.data!);
    return {
      role: c.role === "model" ? "assistant" : "user",
      content: (c.parts ?? []).map((p) => p.text ?? "").join(""),
      ...(images.length ? { images } : {}),
    };
  });
}

async function localCached(messages: local.LocalMessage[], opts: { json?: boolean; maxTokens?: number; temperature?: number }) {
  const key = createHash("sha256").update(local.LOCAL_MODEL).update(JSON.stringify(messages)).update(JSON.stringify(opts)).digest("hex");
  const hit = await cacheGet(key);
  if (hit) {
    modelUsage.getStore()?.add(local.LOCAL_MODEL);
    return hit;
  }
  const out = await local.localChat(messages, opts, (m) => modelUsage.getStore()?.add(m));
  void cachePut(key, out);
  return out;
}

/** Records which models were used inside a job / request, for the "via …" labels in the UI. */
export const modelUsage = new AsyncLocalStorage<Set<string>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function statusOf(err: any): number {
  if (typeof err?.status === "number") return err.status;
  const msg = String(err?.message ?? err);
  const m = /"code"\s*:\s*(\d{3})/.exec(msg) ?? /\b(400|401|403|404|408|429|500|502|503|504)\b/.exec(msg);
  return m ? Number(m[1]) : 0;
}

/* ---------------- Gemini backup model discovery ---------------- */

let geminiResolved: Promise<string | null> | null = null;

/** Pick the best available Gemini Flash model on this key (or GEMINI_MODEL if set). */
export function geminiModel(): Promise<string | null> {
  if (MOCK || !GEMINI_BACKUP) return Promise.resolve(null);
  if (process.env.GEMINI_MODEL) return Promise.resolve(process.env.GEMINI_MODEL);
  geminiResolved ??= (async () => {
    try {
      const names: string[] = [];
      const pager = await ai().models.list({ config: { pageSize: 200 } });
      for await (const m of pager) {
        const name = (m.name ?? "").replace(/^models\//, "");
        const actions = m.supportedActions ?? [];
        if (!/^gemini-[\d.]+-flash/.test(name)) continue;
        if (actions.length && !actions.includes("generateContent")) continue;
        if (/image|tts|live|audio|embedding|exp|thinking|computer|robotics/.test(name)) continue;
        names.push(name);
      }
      const version = (n: string) => Number(/gemini-([\d.]+)/.exec(n)?.[1] ?? 0);
      names.sort(
        (a, b) =>
          Number(/preview/.test(a)) - Number(/preview/.test(b)) || // stable first
          Number(/lite/.test(a)) - Number(/lite/.test(b)) || // full flash before lite
          version(b) - version(a) || // newest version
          a.length - b.length,
      );
      const pick = names[0] ?? null;
      console.log(pick ? `[ai] Gemini backup model: ${pick}` : "[ai] No Gemini Flash model found on this key; Gemma only.");
      return pick;
    } catch (err) {
      console.warn("[ai] Could not list models for the Gemini backup:", String(err).slice(0, 160));
      geminiResolved = null; // try again next time
      return null;
    }
  })();
  return geminiResolved;
}

/* ---------------- One model call ---------------- */

/*
 * Gemma 4 "thinks" before answering by default; on the free API that can take 30+ s and
 * can use the whole output budget, leaving an empty answer. We ask for minimal thinking;
 * if the API rejects a setting we try the next one and remember what works per model.
 */
const THINKING_MODES: (ThinkingConfig | undefined)[] =
  process.env.GEMMA_THINKING === "default"
    ? [undefined]
    : [{ thinkingLevel: ThinkingLevel.MINIMAL }, { thinkingBudget: 0 }, { thinkingLevel: ThinkingLevel.LOW }, undefined];
const thinkingMode = new Map<string, number>();

const isConfigRejection = (err: unknown) =>
  statusOf(err) === 400 && /think|budget|level|INVALID_ARGUMENT|not supported/i.test(String((err as any)?.message ?? err));

/** Retry the SAME model: server hiccups twice (2 s, 5 s), rate limits twice (8 s, 20 s). */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  // server errors: 3 retries with backoff; rate limits: wait as Google asks; timeouts: 1 retry.
  const waits: Record<string, number[]> = { server: [2000, 5000, 10000], rate: [15000, 30000, 45000], timeout: [2000] };
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = statusOf(err);
      const msg = String((err as any)?.message ?? err);
      const isTimeout = (err as any)?.name === "AbortError" || /aborted|timed? ?out|deadline/i.test(msg);
      const kind = status === 429 ? "rate" : [500, 502, 503, 504].includes(status) ? "server" : isTimeout ? "timeout" : null;
      if (!kind || attempt >= waits[kind].length) throw err;
      // Google says how long to wait, e.g. "retryDelay": "23s".
      const asked = /retry(?:Delay| in)[^0-9]{0,6}(\d+(?:\.\d+)?)\s*s/i.exec(msg);
      const wait = kind === "rate" && asked ? Math.min(60000, Number(asked[1]) * 1000 + 1000) : waits[kind][attempt];
      const quota = /"quotaId"\s*:\s*"([^"]+)"/.exec(msg)?.[1];
      console.warn(`[ai] ${label}: ${kind === "timeout" ? "timeout" : `HTTP ${status}`}${quota ? ` (${quota})` : ""}, retry ${attempt + 1} in ${Math.round(wait / 1000)}s`);
      if (kind === "rate" && quota && /PerDay/i.test(quota)) throw err; // daily limit: waiting won't help
      notify(
        kind === "rate"
          ? `Waiting for Gemma's free-tier limit (${Math.round(wait / 1000)}s)…`
          : `Google's Gemma service ${kind === "timeout" ? "was slow" : "hiccuped"}, trying again (${attempt + 2} of ${waits[kind].length + 1})…`,
      );
      await sleep(wait);
    }
  }
}

/** At most N model calls at a time on this server (default 2), whoever sends them. */
const MAX_CALLS = Number(process.env.MAX_CONCURRENT_CALLS) || 2;
let activeCalls = 0;
const callQueue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (activeCalls >= MAX_CALLS) await new Promise<void>((r) => callQueue.push(r));
  activeCalls++;
  try {
    return await fn();
  } finally {
    activeCalls--;
    callQueue.shift()?.();
  }
}

/* ---------------- Pacing under the free-tier tokens-per-minute limit ---------------- */

/** Callback for "waiting…" messages, so the UI can show why something is paused. */
export const waitNotifier = new AsyncLocalStorage<(msg: string) => void>();
const notify = (msg: string) => waitNotifier.getStore()?.(msg);

const TPM = Number(process.env.GEMMA_TPM) || 14000; // assumed per-model budget; set GEMMA_TPM to tune
const sent = new Map<string, { t: number; tokens: number }[]>();

function estimateTokens(contents: Content[], maxOutputTokens: number) {
  let chars = 0;
  let images = 0;
  for (const c of contents)
    for (const p of c.parts ?? []) {
      if (p.text) chars += p.text.length;
      if (p.inlineData) images++;
    }
  return Math.ceil(chars / 4) + images * 600 + Math.min(maxOutputTokens, 1500);
}

/** Wait (if needed) so this request stays under the per-minute token budget for this model. */
async function pace(model: string, tokens: number) {
  for (;;) {
    const now = Date.now();
    const recent = (sent.get(model) ?? []).filter((x) => now - x.t < 60_000);
    sent.set(model, recent);
    const used = recent.reduce((n, x) => n + x.tokens, 0);
    if (!recent.length || used + tokens <= TPM) {
      recent.push({ t: now, tokens });
      return;
    }
    const wait = Math.max(1000, 60_000 - (now - recent[0].t) + 250);
    notify(`Pacing for Gemma's free-tier limit (${Math.ceil(wait / 1000)}s)…`);
    console.log(`[ai] pacing ${model}: ${used}+${tokens} tokens in the last minute, waiting ${Math.ceil(wait / 1000)}s`);
    await sleep(wait);
  }
}

/* Disk cache of successful answers, keyed by model + exact request. */
const cacheKey = (model: string, o: { contents: Content[]; maxOutputTokens: number }) =>
  createHash("sha256").update(model).update(JSON.stringify(o.contents)).update(String(o.maxOutputTokens)).digest("hex");
async function cacheGet(key: string): Promise<string | null> {
  if (!CACHE) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, key + ".json"), "utf8")).text ?? null;
  } catch {
    return null;
  }
}
async function cachePut(key: string, text: string) {
  if (!CACHE) return;
  await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
  await fs.writeFile(path.join(CACHE_DIR, key + ".json"), JSON.stringify({ text })).catch(() => {});
}

interface CallOpts {
  contents: Content[];
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
}

async function callModel(model: string, o: CallOpts): Promise<string> {
  const started = Date.now();
  let idx = thinkingMode.get(model) ?? 0;
  for (;;) {
    const thinkingConfig = THINKING_MODES[idx];
    try {
      let budget = o.maxOutputTokens;
      for (let attempt = 0; attempt < 2; attempt++) {
        await pace(model, estimateTokens(o.contents, budget));
        const res = await withRetry(
          () =>
            limited(() => ai().models.generateContent({
              model,
              contents: o.contents,
              config: {
                temperature: o.temperature,
                maxOutputTokens: budget,
                abortSignal: AbortSignal.timeout(o.timeoutMs),
                ...(thinkingConfig ? { thinkingConfig } : {}),
              },
            })),
          model,
        );
        thinkingMode.set(model, idx);
        const text = (res.text ?? "").trim();
        const finish = String(res.candidates?.[0]?.finishReason ?? "");
        console.log(
          `[ai] ${model} ok in ${((Date.now() - started) / 1000).toFixed(1)}s` +
            ` (thinking ${thinkingConfig ? JSON.stringify(thinkingConfig) : "default"}, thought tokens ${res.usageMetadata?.thoughtsTokenCount ?? 0}, finish ${finish})`,
        );
        if (!text && finish.includes("MAX_TOKENS") && attempt === 0) {
          budget = Math.min(16384, budget * 3);
          continue;
        }
        if (!text) throw Object.assign(new Error(`${model} returned an empty answer (${finish || "no reason"})`), { status: 0 });
        return text;
      }
      throw new Error(`${model} returned an empty answer`);
    } catch (err) {
      if (isConfigRejection(err) && idx < THINKING_MODES.length - 1) {
        console.warn(`[ai] ${model} rejected thinking setting ${JSON.stringify(thinkingConfig)}; trying the next one`);
        idx++;
        continue;
      }
      throw err;
    }
  }
}

/** Try each model in order; move on unless the error is about the API key itself. */
async function runChain(models: (string | null | undefined)[], o: CallOpts): Promise<string> {
  const chain = [...new Set(models.filter((m): m is string => !!m))];
  let last: unknown = new Error("No model available");
  for (const [i, model] of chain.entries()) {
    try {
      const key = cacheKey(model, o);
      const cached = await cacheGet(key);
      if (cached) {
        console.log(`[ai] ${model} answer from cache`);
        modelUsage.getStore()?.add(model);
        return cached;
      }
      const out = await callModel(model, o);
      modelUsage.getStore()?.add(model);
      void cachePut(key, out);
      return out;
    } catch (err) {
      last = err;
      const status = statusOf(err);
      if (status === 401 || status === 403) throw err; // key problem: no point trying others
      if (i < chain.length - 1) console.warn(`[ai] ${model} failed (${status || String(err).slice(0, 80)}); trying ${chain[i + 1]}`);
    }
  }
  throw last;
}

/* ---------------- Public API ---------------- */

export interface InlineFile {
  mimeType: string;
  base64: string;
}

/**
 * Text prompt → text.
 * tier "fast": Gemma 26B first (extraction); tier "deep": Gemma 31B first (reasoning).
 * The other Gemma model is the backup; Gemini only if GEMINI_BACKUP=1.
 */
export async function text(
  prompt: string,
  maxOutputTokens = 4096,
  tier: "fast" | "deep" = "deep",
  opts: { json?: boolean } = {},
): Promise<string> {
  if (MOCK) return mock.text(prompt);
  if (isPrivate()) return localCached([{ role: "user", content: prompt }], { json: opts.json, maxTokens: maxOutputTokens });
  const order = tier === "fast" ? [FAST_MODEL, MODEL] : [REASONING_MODEL, MODEL, FAST_MODEL];
  return runChain([...order, await geminiModel()], {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    maxOutputTokens,
    temperature: 0.2,
    timeoutMs: TIMEOUT_MS,
  });
}

/** Images + prompt → text. Gemma 4 vision first (or Gemini first if VISION_FIRST=gemini). */
export async function vision(images: InlineFile[], prompt: string): Promise<string> {
  if (MOCK) return mock.vision(images.length);
  if (isPrivate())
    return localCached([{ role: "user", content: prompt, images: images.map((i) => i.base64) }], { maxTokens: 1536, temperature: 0.1 });
  const gemini = await geminiModel(); // null unless GEMINI_BACKUP=1
  const order = VISION_FIRST === "gemini" && gemini ? [gemini, MODEL] : [MODEL, gemini];
  const parts: Part[] = [{ text: prompt }, ...images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.base64 } }))];
  // Only Gemma 4 31B reads images on this API (the 26B model returns errors or invented text for
  // images), so failures are handled by retrying 31B: 3 retries on 500/503, 1 on timeouts (withRetry).
  return runChain(order, {
    contents: [{ role: "user", parts }],
    maxOutputTokens: 2048,
    temperature: 0.1,
    timeoutMs: VISION_TIMEOUT_MS,
  });
}

/** Is any cloud model available for audio? */
export async function canTranscribeInCloud() {
  if (isPrivate()) return false; // private mode: audio is transcribed by Whisper on this computer
  return MOCK || !!AUDIO_MODEL || !!(await geminiModel());
}

/** One ≤30 s audio chunk → transcript (audio-capable Gemma, then Gemini). */
export async function audioChunk(chunk: InlineFile): Promise<string> {
  if (MOCK) return mock.audio();
  return runChain([AUDIO_MODEL, await geminiModel()], {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Transcribe this audio verbatim. Output only the transcript, nothing else. If there is no speech, briefly describe the sound in brackets, e.g. (a horse neighing)." },
          { inlineData: { mimeType: chunk.mimeType, data: chunk.base64 } },
        ],
      },
    ],
    maxOutputTokens: 2048,
    temperature: 0,
    timeoutMs: VISION_TIMEOUT_MS,
  });
}

/**
 * Streaming multi-turn chat. Gemma first; if it fails before sending any text,
 * the whole answer is produced by the next model instead.
 */
export async function streamChat(contents: Content[]): Promise<{ model: string; stream: AsyncGenerator<string> }> {
  if (MOCK) return { model: "mock", stream: mock.streamChat(contents) };
  if (isPrivate()) {
    let usedModel = local.LOCAL_MODEL;
    const stream = local.localStream(toLocal(contents), 2048, (m) => (usedModel = m));
    // Pull the first piece now, so an error (Ollama not running) is reported cleanly.
    const it = stream[Symbol.asyncIterator]();
    const first = await it.next();
    modelUsage.getStore()?.add(usedModel);
    const rest = async function* () {
      if (!first.done && first.value) yield first.value;
      for (;;) {
        const n = await it.next();
        if (n.done) return;
        yield n.value;
      }
    };
    return { model: usedModel, stream: rest() };
  }
  // 1. A question asked before with the same sources: answer instantly from the disk cache.
  const ckey = cacheKey(`chat:${REASONING_MODEL}`, { contents, maxOutputTokens: 4096 });
  const cached = await cacheGet(ckey);
  if (cached) {
    console.log("[ai] chat answer from cache");
    modelUsage.getStore()?.add(REASONING_MODEL);
    return {
      model: REASONING_MODEL,
      stream: (async function* () {
        for (const piece of cached.match(/[\s\S]{1,24}/g) ?? []) {
          await sleep(8);
          yield piece;
        }
      })(),
    };
  }

  const chain = [...new Set([REASONING_MODEL, MODEL, FAST_MODEL, await geminiModel()].filter((m): m is string => !!m))];
  let last: unknown = new Error("No model available");
  for (const model of chain) {
    let idx = thinkingMode.get(model) ?? 0;
    for (;;) {
      const thinkingConfig = THINKING_MODES[idx];
      try {
        await pace(model, estimateTokens(contents, 4096));
        // Start the stream AND wait for its first text inside the retry: Google's 500s
        // usually arrive with the first chunk, not when the request is sent.
        const { it, first } = await withRetry(async () => {
          const res = await ai().models.generateContentStream({
            model,
            contents,
            config: {
              temperature: 0.3,
              maxOutputTokens: 4096,
              abortSignal: AbortSignal.timeout(TIMEOUT_MS),
              ...(thinkingConfig ? { thinkingConfig } : {}),
            },
          });
          const it = res[Symbol.asyncIterator]();
          let first = "";
          for (;;) {
            const n = await it.next();
            if (n.done) break;
            first = n.value.text ?? "";
            if (first) break;
          }
          if (!first) throw Object.assign(new Error(`${model} returned an empty answer`), { status: 503 });
          return { it, first };
        }, model);
        thinkingMode.set(model, idx);
        modelUsage.getStore()?.add(model);
        const rest = async function* () {
          let all = first;
          yield first;
          for (;;) {
            const n = await it.next();
            if (n.done) break;
            if (n.value.text) {
              all += n.value.text;
              yield n.value.text;
            }
          }
          void cachePut(ckey, all); // only complete answers are cached
        };
        return { model, stream: rest() };
      } catch (err) {
        last = err;
        if (isConfigRejection(err) && idx < THINKING_MODES.length - 1) {
          idx++;
          continue;
        }
        const status = statusOf(err);
        if (status === 401 || status === 403) throw err;
        console.warn(`[ai] chat on ${model} failed (${status || String(err).slice(0, 80)}); trying next model`);
        break;
      }
    }
  }
  throw last;
}

/**
 * Non-streaming chat answer, used when streaming fails (Google's API sometimes returns
 * 500 on streamed requests that succeed as normal ones). Same Gemma chain as streamChat.
 */
export async function completeChat(contents: Content[]): Promise<{ model: string; text: string }> {
  if (MOCK || isPrivate()) throw new Error("completeChat is only for the cloud API");
  const used = new Set<string>();
  const outer = modelUsage.getStore();
  const text = await modelUsage.run(used, () =>
    runChain([REASONING_MODEL, MODEL, FAST_MODEL, null], { contents, maxOutputTokens: 4096, temperature: 0.3, timeoutMs: TIMEOUT_MS }),
  );
  used.forEach((m) => outer?.add(m));
  return { model: [...used][0] ?? REASONING_MODEL, text };
}

/** Pull the first JSON object/array out of a model reply (handles ``` fences and chatter). */
export function parseJson(raw: string): unknown {
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.search(/[{[]/);
  if (start > 0) s = s.slice(start);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (end >= 0) s = s.slice(0, end + 1);
  return JSON.parse(s);
}

/**
 * Repair JSON that was cut off mid-way (the model ran out of output tokens):
 * keep everything up to the last complete value, then close the open brackets.
 */
export function closeTruncatedJson(raw: string): string {
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*)/i.exec(s);
  if (fence) s = fence[1].replace(/```\s*$/, "");
  const start = s.search(/[{[]/);
  if (start < 0) return s;
  s = s.slice(start);
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastSafe = -1;
  let safeStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      stack.pop();
      lastSafe = i;
      safeStack = [...stack];
      if (!stack.length) break;
    } else if (c === ",") {
      lastSafe = i - 1;
      safeStack = [...stack];
    }
  }
  if (lastSafe < 0) return s;
  const close = [...safeStack].reverse().map((b) => (b === "{" ? "}" : "]")).join("");
  return s.slice(0, lastSafe + 1).replace(/,\s*$/, "") + close;
}

/** Ask for JSON and validate it. Cut-off answers are repaired; otherwise retry once, asking for less. */
export async function json<T>(
  prompt: string,
  validate: (v: unknown) => T,
  maxOutputTokens = 4096,
  tier: "fast" | "deep" = "deep",
): Promise<T> {
  const attempt = (reply: string): T => {
    try {
      return validate(parseJson(reply));
    } catch (err) {
      const repaired = validate(JSON.parse(closeTruncatedJson(reply)));
      console.warn("[ai] repaired a cut-off JSON answer");
      return repaired;
    }
  };
  let reply = await text(prompt, maxOutputTokens, tier, { json: true });
  try {
    return attempt(reply);
  } catch (err) {
    console.warn("[ai] invalid JSON, retrying once:", String(err).slice(0, 200));
    reply = await text(
      `${prompt}\n\nYour previous reply was not valid JSON (${String(err).slice(0, 200)}). Reply again with ONLY the JSON, and keep it SHORT: at most 8 items per list, no repeated items.`,
      maxOutputTokens,
      tier,
      { json: true },
    );
    return attempt(reply);
  }
}
