import type { ActionPlan, Analysis, ChatTurn, JobStatus, SourcePayload } from "../../shared/types";

export interface ServerStatus {
  mock: boolean;
  model: string;
  audioModel: string | null;
  backupModel: string | null;
  fastModel: string | null;
  reasoningModel?: string;
  visionFirst: string;
  hasKey: boolean;
  local?: { running: boolean; hasModel: boolean; model: string };
}

/** fetch() that explains the most common local problem: the server isn't running. */
async function call(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error("Can't reach the ContextOS server. Make sure `npm run dev` is still running in the terminal, then try again.");
  }
}

export async function getStatus(): Promise<ServerStatus | null> {
  try {
    const r = await fetch("/api/status");
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

async function errorOf(r: Response) {
  try {
    const j = await r.json();
    return j.error ?? r.statusText;
  } catch {
    return r.statusText;
  }
}

export async function uploadSource(file: Blob, name: string, sourceId: string, isPrivate = false): Promise<string> {
  const fd = new FormData();
  fd.append("sourceId", sourceId);
  fd.append("private", isPrivate ? "1" : "0");
  fd.append("file", file, name);
  const r = await call("/api/sources", { method: "POST", body: fd });
  if (!r.ok) throw new Error(await errorOf(r));
  return (await r.json()).jobId;
}

export async function pollJob(jobId: string, onUpdate: (j: JobStatus) => void): Promise<JobStatus> {
  for (;;) {
    const r = await call(`/api/jobs/${jobId}`);
    if (!r.ok) throw new Error(await errorOf(r));
    const job: JobStatus = await r.json();
    onUpdate(job);
    if (job.status === "done" || job.status === "error") return job;
    await new Promise((res) => setTimeout(res, 1200));
  }
}

export async function analyze(sources: SourcePayload[], instructions?: string, language?: string, isPrivate = false): Promise<Analysis> {
  const r = await call("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources, instructions, language, private: isPrivate }),
  });
  if (!r.ok) throw new Error(await errorOf(r));
  return r.json();
}

export async function streamChat(
  body: { sources: SourcePayload[]; analysis?: Analysis; history: ChatTurn[]; instructions?: string; language?: string; private?: boolean },
  onText: (chunk: string) => void,
  onModel?: (model: string) => void,
) {
  const r = await call("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) throw new Error(await errorOf(r));
  const model = r.headers.get("X-Model");
  if (model && model !== "none") onModel?.(model);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(dec.decode(value, { stream: true }));
  }
}

export async function suggestActions(sources: SourcePayload[], analysis: Analysis | undefined, instructions?: string, language?: string, isPrivate = false): Promise<ActionPlan> {
  const r = await call("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources, analysis, instructions, language, private: isPrivate }),
  });
  if (!r.ok) throw new Error(await errorOf(r));
  return r.json();
}
