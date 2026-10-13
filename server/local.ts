// Private mode: Gemma 4 running on this computer through Ollama (https://ollama.com).
// Nothing leaves the machine. Install Ollama, then: `ollama pull gemma4:e4b`.
export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const LOCAL_MODEL = process.env.LOCAL_MODEL || "gemma4:e4b";
// Generous: requests wait in Ollama's queue while earlier files are processed.
const LOCAL_TIMEOUT_MS = Number(process.env.LOCAL_TIMEOUT_MS) || 900_000;
// Smaller context = less GPU memory = faster on 6–8 GB laptop GPUs.
const NUM_CTX = Number(process.env.LOCAL_NUM_CTX) || 8192;

export interface LocalMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[]; // base64, no data: prefix
}

/** Is Ollama running, and is the Gemma model downloaded? */
export async function localStatus(): Promise<{ running: boolean; hasModel: boolean; model: string }> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { running: false, hasModel: false, model: LOCAL_MODEL };
    const j = (await r.json()) as { models?: { name: string }[] };
    const names = (j.models ?? []).map((m) => m.name);
    const want = LOCAL_MODEL.includes(":") ? LOCAL_MODEL : `${LOCAL_MODEL}:latest`;
    return { running: true, hasModel: names.includes(want) || names.includes(LOCAL_MODEL), model: LOCAL_MODEL };
  } catch {
    return { running: false, hasModel: false, model: LOCAL_MODEL };
  }
}

function friendly(err: unknown): Error {
  const msg = String((err as any)?.message ?? err);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg))
    return new Error("Private mode: Ollama isn't running on this computer. Start the Ollama app, then retry.");
  if (/not found|pull/i.test(msg)) return new Error(`Private mode: the model "${LOCAL_MODEL}" isn't downloaded. Run: ollama pull ${LOCAL_MODEL}`);
  if (/abort|timeout/i.test(msg)) return new Error("Private mode: the local model took too long. Try a smaller file.");
  return new Error(`Private mode: ${msg.slice(0, 200)}`);
}

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
    throw friendly(err);
  }
}

/** One complete answer from local Gemma. */
export async function localChat(
  messages: LocalMessage[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const started = Date.now();
  const r = await post("/api/chat", {
    model: LOCAL_MODEL,
    messages,
    stream: false,
    ...(opts.json ? { format: "json" } : {}),
    options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? 2048, num_ctx: NUM_CTX },
    keep_alive: "30m",
  });
  const j = (await r.json()) as { message?: { content?: string } };
  const text = (j.message?.content ?? "").trim();
  console.log(`[local] ${LOCAL_MODEL} ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!text || text === "{}") {
    // Strict JSON mode sometimes yields nothing from small models: retry once in free-text mode.
    if (opts.json) return localChat(messages, { ...opts, json: false });
    throw new Error("Private mode: the local model returned an empty answer.");
  }
  return text;
}

/** Streaming answer from local Gemma (newline-delimited JSON from Ollama). */
export async function* localStream(messages: LocalMessage[], maxTokens = 2048): AsyncGenerator<string> {
  const r = await post("/api/chat", {
    model: LOCAL_MODEL,
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
      if (j.error) throw friendly(j.error);
      if (j.message?.content) yield j.message.content;
    }
  }
}
