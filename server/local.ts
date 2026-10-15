// Private mode: Gemma 4 running on this computer through Ollama (https://ollama.com).
// Nothing leaves the machine. Install Ollama, then: `ollama pull gemma4:e4b` (and optionally gemma4:e2b).
export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const LOCAL_MODEL = process.env.LOCAL_MODEL || "gemma4:e4b";
/** Smaller, faster model used if the main one fails (out of GPU memory, too slow, not downloaded). */
export const LOCAL_FALLBACK_MODEL = process.env.LOCAL_FALLBACK_MODEL || "gemma4:e2b";
// Generous: requests wait in Ollama's queue while earlier files are processed.
const LOCAL_TIMEOUT_MS = Number(process.env.LOCAL_TIMEOUT_MS) || 900_000;
// Smaller context = less GPU memory = faster on 6–8 GB laptop GPUs.
const NUM_CTX = Number(process.env.LOCAL_NUM_CTX) || 8192;
/** Hosted deployments (Render) can never reach Ollama on someone's laptop. */
export const HOSTED = !!process.env.RENDER || !!process.env.SPACE_ID || process.env.HOSTED === "1";

export interface LocalMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[]; // base64, no data: prefix
}

export interface LocalStatus {
  running: boolean;
  hasModel: boolean; // at least one usable Gemma model is downloaded
  model: string; // the model that will answer first
  models: string[]; // usable models in the order they are tried
  hosted: boolean;
}

const tagName = (m: string) => (m.includes(":") ? m : `${m}:latest`);
let cached: { at: number; status: LocalStatus } | null = null;

/** Is Ollama running, and which Gemma models are downloaded? (cached for 10 s) */
export async function localStatus(): Promise<LocalStatus> {
  if (HOSTED) return { running: false, hasModel: false, model: LOCAL_MODEL, models: [], hosted: true };
  if (cached && Date.now() - cached.at < 10_000) return cached.status;
  let status: LocalStatus = { running: false, hasModel: false, model: LOCAL_MODEL, models: [], hosted: false };
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const j = (await r.json()) as { models?: { name: string }[] };
      const names = new Set((j.models ?? []).map((m) => m.name));
      const models = [...new Set([LOCAL_MODEL, LOCAL_FALLBACK_MODEL])].filter((m) => names.has(tagName(m)) || names.has(m));
      status = { running: true, hasModel: models.length > 0, model: models[0] ?? LOCAL_MODEL, models, hosted: false };
    }
  } catch {
    /* not running */
  }
  cached = { at: Date.now(), status };
  return status;
}

function friendly(err: unknown, model = LOCAL_MODEL): Error {
  const msg = String((err as any)?.message ?? err);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg))
    return new Error("Private mode: Ollama isn't running on this computer. Start the Ollama app, then retry.");
  if (/not found|pull/i.test(msg)) return new Error(`Private mode: the model "${model}" isn't downloaded. Run: ollama pull ${model}`);
  if (/abort|timeout/i.test(msg)) return new Error("Private mode: the local model took too long. Try a smaller file.");
  return new Error(`Private mode: ${msg.slice(0, 200)}`);
}

const isConnectionError = (err: unknown) => /isn't running|ECONNREFUSED|fetch failed/i.test(String((err as any)?.message ?? err));

let thinkSupported: boolean | null = null; // remembered after the first call

async function post(path: string, body: Record<string, unknown>) {
  const send = (b: Record<string, unknown>) =>
    fetch(`${OLLAMA_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
    });
  try {
    // Turn off "thinking" for speed; older Ollama versions or models may reject the option.
    let r = await send(thinkSupported === false ? body : { ...body, think: false });
    if (r.status === 400 && thinkSupported !== false) {
      const t = await r.text();
      if (/think/i.test(t)) {
        thinkSupported = false;
        r = await send(body);
      } else throw new Error(t);
    } else if (r.ok) thinkSupported ??= true;
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r;
  } catch (err) {
    throw friendly(err, String(body.model));
  }
}

/** Models to try, in order: the main one, then the faster fallback (only those downloaded). */
async function modelOrder() {
  const st = await localStatus();
  return st.models.length ? st.models : [LOCAL_MODEL];
}

/** One complete answer from local Gemma. Tries E4B, then E2B. `onModel` reports which one answered. */
export async function localChat(
  messages: LocalMessage[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {},
  onModel?: (model: string) => void,
): Promise<string> {
  let last: unknown;
  for (const model of await modelOrder()) {
    try {
      const text = await localChatWith(model, messages, opts);
      onModel?.(model);
      return text;
    } catch (err) {
      last = err;
      if (isConnectionError(err)) throw err; // Ollama itself is down: another model won't help
      console.warn(`[local] ${model} failed (${String((err as any)?.message ?? err).slice(0, 120)}); trying the next local model`);
    }
  }
  throw last;
}

async function localChatWith(model: string, messages: LocalMessage[], opts: { json?: boolean; maxTokens?: number; temperature?: number }): Promise<string> {
  const started = Date.now();
  const r = await post("/api/chat", {
    model,
    messages,
    stream: false,
    ...(opts.json ? { format: "json" } : {}),
    options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? 2048, num_ctx: NUM_CTX },
    keep_alive: "30m",
  });
  const j = (await r.json()) as { message?: { content?: string } };
  const text = (j.message?.content ?? "").trim();
  console.log(`[local] ${model} ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!text || text === "{}") {
    // Strict JSON mode sometimes yields nothing from small models: retry once in free-text mode.
    if (opts.json) return localChatWith(model, messages, { ...opts, json: false });
    throw new Error("Private mode: the local model returned an empty answer.");
  }
  return text;
}

/** Streaming answer from local Gemma (newline-delimited JSON from Ollama). Falls back to E2B before the first word. */
export async function* localStream(messages: LocalMessage[], maxTokens = 2048, onModel?: (model: string) => void): AsyncGenerator<string> {
  let last: unknown;
  for (const model of await modelOrder()) {
    let started = false;
    try {
      for await (const piece of localStreamWith(model, messages, maxTokens)) {
        if (!started) {
          started = true;
          onModel?.(model);
        }
        yield piece;
      }
      if (started) return;
      throw new Error("Private mode: the local model returned an empty answer.");
    } catch (err) {
      if (started) throw err; // already showing text: can't switch models mid-answer
      last = err;
      if (isConnectionError(err)) throw err;
      console.warn(`[local] chat on ${model} failed; trying the next local model`);
    }
  }
  throw last;
}

async function* localStreamWith(model: string, messages: LocalMessage[], maxTokens: number): AsyncGenerator<string> {
  const r = await post("/api/chat", {
    model,
    messages,
    stream: true,
    options: { temperature: 0.3, num_predict: maxTokens, num_ctx: NUM_CTX },
    keep_alive: "30m",
  });
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (j.error) throw friendly(j.error, model);
      if (j.message?.content) yield j.message.content;
    }
  }
}
