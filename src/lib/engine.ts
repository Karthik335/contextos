// Orchestration: files → background jobs → analysis → briefing → co-pilot answers.
import * as api from "./api";
import { loadBlob, saveBlob, useStore } from "./store";
import { kindOf, uid } from "./files";
import { diffAnalyses } from "../../shared/conflicts";
import { labelFacts } from "../../shared/labels";
import type { Analysis, ChatTurn, SourcePayload } from "../../shared/types";
import type { Chat, Ctx, SourceRec } from "./types";

const S = () => useStore.getState();

/** Create source records for files, save the originals in the browser. */
export async function createSources(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    const kind = kindOf(f.name, f.type);
    if (!kind) continue;
    const rec: SourceRec = {
      id: uid(),
      name: f.name,
      kind,
      mime: f.type,
      size: f.size,
      status: "uploading",
      step: "Uploading",
      progress: 0,
      createdAt: Date.now(),
    };
    S().upsertSource(rec);
    await saveBlob(rec.id, f);
    ids.push(rec.id);
  }
  return ids;
}

/** Upload and process sources, two at a time. Resolves when all are finished. */
export async function processSources(ids: string[], files: Map<string, File>) {
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      const file = files.get(id);
      if (!file) continue;
      try {
        const jobId = await api.uploadSource(file, file.name, id, S().privateMode);
        S().patchSource(id, { status: "processing", step: "Starting", progress: 0.02 });
        const job = await api.pollJob(jobId, (j) =>
          S().patchSource(id, { step: j.step, progress: j.progress, status: j.status === "done" ? "done" : "processing" }),
        );
        if (job.status === "error") S().patchSource(id, { status: "error", error: job.error, step: "Error" });
        else S().patchSource(id, { status: "done", result: job.result, step: job.step, progress: 1 });
      } catch (err: any) {
        S().patchSource(id, { status: "error", error: String(err?.message ?? err), step: "Error" });
      }
    }
  };
  // Local GPU handles one file at a time best.
  await Promise.all(S().privateMode ? [worker()] : [worker(), worker()]);
}

/** Sources visible to a chat: its context's sources first, then its own. */
export function scopeSourceIds(chat: Chat | undefined, ctx?: Ctx): string[] {
  const ids = [...(ctx?.sourceIds ?? []), ...(chat?.sourceIds ?? [])];
  return [...new Set(ids)];
}

export function toPayload(ids: string[], withText: boolean): SourcePayload[] {
  const { sources } = S();
  return ids
    .map((id) => sources[id])
    .filter((s): s is SourceRec => !!s && s.status === "done" && !!s.result)
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      summary: s.result!.summary,
      facts: s.result!.facts,
      text: withText ? s.result!.segments.map((g) => `[${g.location}] ${g.text}`).join("\n") : undefined,
    }));
}

/** fact id → {fact, source} lookup across everything this profile has. */
export function findFact(factId: string) {
  const sid = factId.split(":")[0];
  const src = S().sources[sid];
  const fact = src?.result?.facts.find((f) => f.id === factId);
  return fact && src ? { fact, source: src } : null;
}

const factIdsOf = (payload: SourcePayload[]) => payload.flatMap((s) => s.facts.map((f) => f.id));

/** Run Gemma's analysis for a set of sources and compare with the previous one. */
async function analyzeScope(ids: string[], prev: Analysis | undefined, prevFactIds: string[] | undefined, instructions?: string) {
  const payload = toPayload(ids, false);
  const analysis = await api.analyze(payload, instructions, S().language, S().privateMode);
  const factIds = factIdsOf(payload);
  const changes = prev ? diffAnalyses(prev, analysis, prevFactIds ?? [], factIds) : undefined;
  return { analysis, factIds, changes };
}

/** Main entry: user sends text and/or files in a chat. */
export async function send(opts: { chatId?: string; contextId?: string | null; text: string; files: File[] }) {
  const st = S();
  let chat = opts.chatId ? st.chats.find((c) => c.id === opts.chatId) : undefined;
  if (!chat) {
    chat = st.createChat(opts.contextId ?? null);
    if (opts.text.trim()) st.patchChat(chat.id, { title: opts.text.trim().slice(0, 48) });
    st.setView({ type: "chat", chatId: chat.id });
  }
  const chatId = chat.id;

  const fileMap = new Map<string, File>();
  let newIds: string[] = [];
  if (opts.files.length) {
    newIds = await createSources(opts.files);
    newIds.forEach((id, i) => fileMap.set(id, opts.files[i]));
    const c = S().chats.find((x) => x.id === chatId)!;
    S().patchChat(chatId, { sourceIds: [...c.sourceIds, ...newIds] });
  }

  S().addMessage(chatId, { role: "user", kind: "text", text: opts.text.trim(), sourceIds: newIds });

  if (newIds.length) {
    const workingId = S().addMessage(chatId, { role: "assistant", kind: "working", sourceIds: newIds });
    await processSources(newIds, fileMap);
    S().patchMessage(chatId, workingId, { done: true });

    const ok = await analyzeChat(chatId, !opts.text.trim());
    if (!ok) return;
  }

  if (opts.text.trim()) await answer(chatId);
}

/** Build (or update) the briefing for a chat and post it as a message. Returns false on failure. */
export async function analyzeChat(chatId: string, withFollowups: boolean): Promise<boolean> {
  const c = S().chats.find((x) => x.id === chatId)!;
  const ctx = c.contextId ? S().contexts.find((x) => x.id === c.contextId) : undefined;
  const ids = scopeSourceIds(c, ctx);
  if (!toPayload(ids, false).length) {
    S().addMessage(chatId, {
      role: "assistant",
      kind: "error",
      text: "I couldn't read any of those files yet. Use Retry on the file cards, or add other files.",
    });
    return false;
  }
  const thinkingId = S().addMessage(chatId, { role: "assistant", kind: "text", text: "", streaming: true });
  try {
    const prev = c.analysis ?? ctx?.analysis;
    const prevIds = c.analysis ? c.analysisFactIds : ctx?.analysisFactIds;
    const { analysis, factIds, changes } = await analyzeScope(ids, prev, prevIds, ctx?.instructions);
    S().patchMessage(chatId, thinkingId, {
      kind: changes ? "changes" : "briefing",
      text: undefined,
      streaming: false,
      analysis,
      changes,
      followups: withFollowups ? analysis.followups : [],
    });
    S().patchChat(chatId, {
      analysis,
      analysisFactIds: factIds,
      title: c.title === "New chat" || !c.messages.some((m) => m.kind === "briefing") ? analysis.title : c.title,
    });
    return true;
  } catch (err: any) {
    S().patchMessage(chatId, thinkingId, {
      kind: "error",
      streaming: false,
      text: `Analysis failed: ${String(err?.message ?? err)}`,
    });
    return false;
  }
}

/** Re-process a failed source from its saved original, then refresh the briefing. */
export async function retrySource(sourceId: string, where: { chatId?: string; contextId?: string }) {
  const rec = S().sources[sourceId];
  const blob = await loadBlob(sourceId);
  if (!rec || !blob) return;
  S().patchSource(sourceId, { status: "uploading", step: "Retrying", progress: 0, error: undefined });
  await processSources([sourceId], new Map([[sourceId, new File([blob], rec.name, { type: rec.mime })]]));
  if (S().sources[sourceId]?.status !== "done") return;
  if (where.chatId) await analyzeChat(where.chatId, true);
  else if (where.contextId) await refreshContext(where.contextId);
}

/** Stream a co-pilot answer for the latest user message. */
export async function answer(chatId: string) {
  const chat = S().chats.find((c) => c.id === chatId)!;
  const ctx = chat.contextId ? S().contexts.find((x) => x.id === chat.contextId) : undefined;
  const ids = scopeSourceIds(chat, ctx);
  const sources = toPayload(ids, true);
  const analysis = chat.analysis ?? ctx?.analysis;

  const history: ChatTurn[] = [];
  for (const m of chat.messages) {
    if (m.role === "user") {
      const names = (m.sourceIds ?? []).map((id) => S().sources[id]?.name).filter(Boolean);
      const t = [m.text, names.length ? `(attached: ${names.join(", ")})` : ""].filter(Boolean).join(" ");
      if (t) history.push({ role: "user", text: t });
    } else if (m.kind === "text" && m.text) {
      history.push({ role: "assistant", text: stripCitations(m.text) });
    } else if (m.kind === "actions" && m.actions) {
      const kept = m.actions.actions.filter((a) => a.status !== "dismissed");
      history.push({ role: "assistant", text: `I proposed ${kept.length} actions: ${kept.map((a) => (a.tool === "create_checklist" ? `checklist "${a.title}"` : a.tool === "draft_message" ? `a message to ${a.to}` : `calendar event "${a.title}" on ${a.date}`)).join("; ")}.` });
    } else if ((m.kind === "briefing" || m.kind === "changes") && m.analysis) {
      history.push({
        role: "assistant",
        text: `I read the sources and built the briefing "${m.analysis.title}". ${m.analysis.overview}${m.changes ? ` What changed: ${m.changes.summary}.` : ""}`,
      });
    }
  }

  // The question being answered must be the last thing the model reads
  // (a briefing generated after the question would otherwise come after it).
  const lastQuestion = [...chat.messages].reverse().find((m) => m.role === "user" && m.text?.trim())?.text?.trim();
  if (lastQuestion && history[history.length - 1]?.role !== "user") history.push({ role: "user", text: lastQuestion });

  const msgId = S().addMessage(chatId, { role: "assistant", kind: "text", text: "", streaming: true });
  let raw = "";
  try {
    await api.streamChat(
      { sources, analysis, history, instructions: ctx?.instructions, language: S().language, private: S().privateMode },
      (chunk) => {
        raw += chunk;
        S().patchMessage(chatId, msgId, { text: raw });
      },
      (model) => S().patchMessage(chatId, msgId, { model }),
    );
  } catch (err: any) {
    raw += `\n\n⚠️ ${String(err?.message ?? err)}`;
  }
  const { body, followups } = splitFollowups(raw);
  S().patchMessage(chatId, msgId, { text: linkCitations(body, sources), followups, streaming: false });
}

/** "Act on it": Gemma 4 proposes tool calls (calendar, message, checklist); the user approves each one. */
export async function actOnIt(scope: { chatId?: string; contextId?: string }) {
  let chatId = scope.chatId;
  if (!chatId) {
    if (!scope.contextId) return;
    const c = S().createChat(scope.contextId);
    chatId = c.id;
    S().patchChat(chatId, { title: "Act on it" });
    S().setView({ type: "chat", chatId });
  }
  const chat = S().chats.find((c) => c.id === chatId)!;
  const ctx = chat.contextId ? S().contexts.find((x) => x.id === chat.contextId) : undefined;
  const sources = toPayload(scopeSourceIds(chat, ctx), false);
  const analysis = chat.analysis ?? ctx?.analysis;
  S().addMessage(chatId, { role: "user", kind: "text", text: "Act on it" });
  const msgId = S().addMessage(chatId, {
    role: "assistant",
    kind: "text",
    text: "",
    streaming: true,
    pending: S().privateMode ? "Gemma is choosing tools on this computer… (can take a minute)" : "Gemma is choosing which tools to call…",
  });
  try {
    const plan = await api.suggestActions(sources, analysis, ctx?.instructions, S().language, S().privateMode);
    if (!plan.actions.length) throw new Error("Gemma didn't find anything to act on yet. Add files with dates, tasks or open questions.");
    S().patchMessage(chatId, msgId, { kind: "actions", actions: plan, streaming: false, pending: undefined });
  } catch (err: any) {
    S().patchMessage(chatId, msgId, { kind: "error", streaming: false, text: `Act on it failed: ${String(err?.message ?? err)}` });
  }
}

/** Remove a failed answer and ask again. */
export async function retryAnswer(chatId: string, msgId: string) {
  const c = S().chats.find((x) => x.id === chatId);
  if (!c) return;
  S().patchChat(chatId, { messages: c.messages.filter((m) => m.id !== msgId) });
  await answer(chatId);
}

export function splitFollowups(raw: string) {
  const m = /\n?\s*\**FOLLOWUPS:?\**:?\s*(.+)\s*$/i.exec(raw);
  if (!m) return { body: raw.trim(), followups: [] as string[] };
  return {
    body: raw.slice(0, m.index).trim(),
    followups: m[1].split("|").map((q) => q.trim()).filter(Boolean).slice(0, 4),
  };
}

/** Turn [F3, F7] into permanent links to fact ids, so they survive later changes. */
export function linkCitations(text: string, sources: Pick<SourcePayload, "facts">[]) {
  const { toId } = labelFacts(sources);
  return text.replace(/\[((?:F\d+\s*,?\s*)+)\]/g, (_all, inner: string) =>
    inner
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((l) => (toId.get(l) ? `[${l}](#cite:${toId.get(l)})` : l))
      .join(" "),
  );
}

const stripCitations = (t: string) => t.replace(/\[(F\d+)\]\(#cite:[^)]+\)/g, "[$1]");

/** Add files to a context's shared sources and refresh its briefing. */
export async function addToContext(contextId: string, files: File[]) {
  const ids = await createSources(files);
  const map = new Map<string, File>();
  ids.forEach((id, i) => map.set(id, files[i]));
  const ctx = S().contexts.find((c) => c.id === contextId)!;
  S().patchContext(contextId, { sourceIds: [...ctx.sourceIds, ...ids] });
  await processSources(ids, map);
  await refreshContext(contextId);
}

export async function refreshContext(contextId: string) {
  const ctx = S().contexts.find((c) => c.id === contextId);
  if (!ctx) return;
  if (!toPayload(ctx.sourceIds, false).length) {
    S().patchContext(contextId, { analysis: undefined, analysisFactIds: [], lastChanges: undefined });
    return;
  }
  S().patchContext(contextId, { analyzing: true });
  try {
    const { analysis, factIds, changes } = await analyzeScope(ctx.sourceIds, ctx.analysis, ctx.analysisFactIds, ctx.instructions);
    S().patchContext(contextId, { analysis, analysisFactIds: factIds, lastChanges: changes, analyzing: false });
  } catch (err) {
    console.error(err);
    S().patchContext(contextId, { analyzing: false });
  }
}

/** Move a chat attachment into its context's shared sources. */
export async function saveToContext(chatId: string, sourceId: string) {
  const chat = S().chats.find((c) => c.id === chatId);
  if (!chat?.contextId) return;
  const ctx = S().contexts.find((c) => c.id === chat.contextId)!;
  if (!ctx.sourceIds.includes(sourceId)) S().patchContext(ctx.id, { sourceIds: [...ctx.sourceIds, sourceId] });
  S().patchChat(chatId, { sourceIds: chat.sourceIds.filter((id) => id !== sourceId) });
  await refreshContext(ctx.id);
}

export function removeContextSource(contextId: string, sourceId: string) {
  const ctx = S().contexts.find((c) => c.id === contextId);
  if (!ctx) return;
  S().patchContext(contextId, { sourceIds: ctx.sourceIds.filter((id) => id !== sourceId) });
  void refreshContext(contextId);
}

/** Load the bundled demo files from /demo through the real pipeline. */
export async function loadDemoFiles(names: string[]): Promise<File[]> {
  const out: File[] = [];
  for (const n of names) {
    const r = await fetch(`/demo/${n}`);
    if (!r.ok) continue;
    const blob = await r.blob();
    out.push(new File([blob], n, { type: blob.type }));
  }
  return out;
}

export const DEMO_FILES = ["notice_board_ia2.jpg", "class_group_chat.png", "dbms_course_plan.pdf", "my_notes.txt"];
export const DEMO_UPDATE = ["revised_circular.jpg"];
