import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertCircle, Check, ChevronDown, Cpu, FolderInput, Loader2, RotateCcw, Sparkles } from "lucide-react";
import Briefing, { ChangesCard } from "./Briefing";
import Citation from "./Citation";
import ActionsCard from "./Actions";
import { useStore, loadBlob } from "../lib/store";
import { KIND_STYLE, kindIcon } from "../lib/files";
import { retryAnswer, retrySource, saveToContext } from "../lib/engine";
import { modelLabel } from "../../shared/labels";
import type { Chat, Message, SourceRec } from "../lib/types";

export function MessageView({ m, chat, onFollowup }: { m: Message; chat: Chat; onFollowup: (q: string) => void }) {
  if (m.role === "user") return <UserMessage m={m} chat={chat} />;
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex gap-3">
      <div className={`orb mt-1 size-8 shrink-0 rounded-full shadow-sm ${m.streaming || (m.kind === "working" && !m.done) ? "orb-busy" : ""}`} />
      <div className="min-w-0 flex-1">
        {m.kind === "working" && <WorkingBlock m={m} />}
        {m.kind === "briefing" && m.analysis && (
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Eyebrow>Context briefing</Eyebrow>
              <ModelChip models={m.analysis.models} />
            </div>
            <Briefing analysis={m.analysis} scope={{ chatId: chat.id }} />
          </Card>
        )}
        {m.kind === "changes" && m.changes && m.analysis && (
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Eyebrow>What changed</Eyebrow>
              <ModelChip models={m.analysis.models} />
            </div>
            <ChangesCard changes={m.changes} />
            <UpdatedBriefing m={m} chatId={chat.id} />
          </Card>
        )}
        {m.kind === "actions" && m.actions && (
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Eyebrow>Act on it</Eyebrow>
              <ModelChip models={m.actions.models} />
            </div>
            <ActionsCard plan={m.actions} chatId={chat.id} msgId={m.id} />
          </Card>
        )}
        {m.kind === "text" && <TextAnswer m={m} />}
        {m.kind === "text" && !m.streaming && m.text?.trimStart().startsWith("⚠️") && (
          <button
            onClick={() => retryAnswer(chat.id, m.id)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-surface/80 px-3.5 py-1.5 text-sm font-semibold text-accent transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <RotateCcw size={14} /> Retry
          </button>
        )}
        {m.kind === "error" && (
          <div className="flex items-start gap-2 rounded-2xl border border-conflict/30 bg-conflict-soft p-3.5 text-sm text-conflict">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> {m.text}
          </div>
        )}
        {!!m.followups?.length && !m.streaming && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.followups.map((q, i) => (
              <motion.button
                key={q}
                onClick={() => onFollowup(q)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, rotate: [-1.2, 1, -0.6, 1.4][i % 4] }}
                whileHover={{ rotate: 0, y: -2 }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className="glass-strong rounded-2xl px-3.5 py-2 text-left text-[13px] font-semibold text-ink hover:text-accent"
              >
                {q}
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Small label showing which open model produced a result. */
export function ModelChip({ models }: { models?: string[] }) {
  if (!models?.length) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-2/10 px-2 py-0.5 text-[10px] font-semibold text-accent-2" title={models.join(", ")}>
      <Cpu size={10} /> {[...new Set(models.map(modelLabel))].join(" + ")}
    </span>
  );
}

const Card = ({ children }: { children: React.ReactNode }) => <div className="glass-strong rounded-3xl p-5">{children}</div>;
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
    <Sparkles size={12} /> {children}
  </p>
);

function UpdatedBriefing({ m, chatId }: { m: Message; chatId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-ink/10 pt-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-sm font-semibold text-accent">
        <ChevronDown size={16} className={`transition ${open ? "rotate-180" : ""}`} /> {open ? "Hide" : "Show"} updated briefing
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pt-3">
            <Briefing analysis={m.analysis!} scope={{ chatId }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserMessage({ m, chat }: { m: Message; chat: Chat }) {
  const sources = useStore((s) => s.sources);
  const recs = (m.sourceIds ?? []).map((id) => sources[id]).filter(Boolean) as SourceRec[];
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end gap-2">
      {recs.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {recs.map((r) => (
            <SourceCard key={r.id} rec={r} canSave={!!chat.contextId && chat.sourceIds.includes(r.id)} chatId={chat.id} />
          ))}
        </div>
      )}
      {m.text && <div className="glass-strong max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg px-4 py-2.5 text-[15px] leading-relaxed">{m.text}</div>}
    </motion.div>
  );
}

function Thumb({ rec }: { rec: SourceRec }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (rec.kind !== "image") return;
    let u: string | null = null;
    loadBlob(rec.id).then((b) => b && setUrl((u = URL.createObjectURL(b))));
    return () => void (u && URL.revokeObjectURL(u));
  }, [rec.id, rec.kind]);
  const style = KIND_STYLE[rec.kind];
  const Icon = kindIcon(rec.kind, rec.name);
  const frame = rec.result?.frames?.[0]?.dataUrl;
  if (url || frame) return <img src={url ?? frame} alt="" className="size-10 rounded-xl object-cover" />;
  return (
    <span className="grid size-10 place-items-center rounded-xl" style={{ background: style.bg, color: style.color }}>
      <Icon size={18} />
    </span>
  );
}

export function SourceCard({
  rec,
  canSave,
  chatId,
  contextId,
  onRemove,
}: {
  rec: SourceRec;
  canSave?: boolean;
  chatId?: string;
  contextId?: string;
  onRemove?: () => void;
}) {
  const setPanel = useStore((s) => s.setPanel);
  const busy = rec.status === "uploading" || rec.status === "processing";
  return (
    <div
      onClick={() => rec.status === "done" && setPanel({ open: true, mode: "source", sourceId: rec.id, location: undefined, focusFactId: undefined })}
      className={`relative w-56 overflow-hidden rounded-2xl border bg-surface/90 p-2 shadow-sm transition ${rec.status === "done" ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""} ${rec.status === "error" ? "border-conflict/40" : "border-edge"}`}
    >
      <div className="flex items-center gap-2.5">
        <Thumb rec={rec} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{rec.name}</p>
          <p className={`truncate text-[11px] ${rec.status === "error" ? "text-conflict" : "text-ink-soft"}`} title={rec.error}>
            {rec.status === "done" ? `✓ ${rec.result?.facts.length ?? 0} fact${rec.result?.facts.length === 1 ? "" : "s"}` : rec.status === "error" ? rec.error ?? "Error" : rec.step}
          </p>
        </div>
        {canSave && chatId && rec.status === "done" && (
          <button
            title="Save to context (share with every chat in it)"
            onClick={(e) => {
              e.stopPropagation();
              void saveToContext(chatId, rec.id);
            }}
            className="rounded-lg p-1 text-ink-soft hover:bg-accent/10 hover:text-accent"
          >
            <FolderInput size={15} />
          </button>
        )}
        {rec.status === "error" && (chatId || contextId) && (
          <button
            title="Try reading this file again"
            onClick={(e) => {
              e.stopPropagation();
              void retrySource(rec.id, { chatId, contextId });
            }}
            className="flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20"
          >
            <RotateCcw size={12} /> Retry
          </button>
        )}
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded-lg px-1.5 text-xs text-ink-soft hover:bg-conflict/10 hover:text-conflict"
          >
            ✕
          </button>
        )}
      </div>
      {busy && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-ink/5">
          <motion.div className="h-full bg-gradient-to-r from-rose via-accent to-accent-2" animate={{ width: `${Math.max(6, rec.progress * 100)}%` }} transition={{ duration: 0.6 }} />
        </div>
      )}
    </div>
  );
}

function WorkingBlock({ m }: { m: Message }) {
  const sources = useStore((s) => s.sources);
  const recs = (m.sourceIds ?? []).map((id) => sources[id]).filter(Boolean) as SourceRec[];
  const [open, setOpen] = useState(!m.done);
  useEffect(() => setOpen(!m.done), [m.done]);
  const facts = recs.reduce((n, r) => n + (r.result?.facts.length ?? 0), 0);
  return (
    <div className="glass rounded-3xl px-4 py-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        {m.done ? <Check size={16} className="text-resolved" /> : <Loader2 size={16} className="animate-spin text-accent" />}
        <span className={`text-sm font-semibold ${m.done ? "text-ink" : "shimmer"}`}>
          {m.done ? `Read ${recs.length} source${recs.length > 1 ? "s" : ""} · ${facts} fact${facts === 1 ? "" : "s"}` : "Reading your sources with Gemma…"}
        </span>
        <ChevronDown size={15} className={`ml-auto text-ink-soft transition ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 space-y-1.5 overflow-hidden">
            {recs.map((r) => {
              const Icon = kindIcon(r.kind, r.name);
              return (
                <li key={r.id} className="flex items-center gap-2 text-[13px]">
                  <span className="grid size-5 place-items-center">
                    {r.status === "done" ? (
                      <Check size={14} className="text-resolved" />
                    ) : r.status === "error" ? (
                      <AlertCircle size={14} className="text-conflict" />
                    ) : (
                      <Loader2 size={13} className="animate-spin text-accent" />
                    )}
                  </span>
                  <Icon size={13} style={{ color: KIND_STYLE[r.kind].color }} />
                  <span className="font-medium">{r.name}</span>
                  <span className={`truncate ${r.status === "error" ? "text-conflict" : "text-ink-soft"}`}>
                    — {r.status === "done" ? `${r.result?.facts.length ?? 0} fact${r.result?.facts.length === 1 ? "" : "s"}${r.result?.models?.length ? ` · via ${[...new Set(r.result.models.map(modelLabel))].join(" + ")}` : ""}${r.result?.notes?.length ? ` · ${r.result.notes[0]}` : ""}` : r.status === "error" ? r.error : r.step}
                  </span>
                </li>
              );
            })}
            {m.done && (
              <li className="flex items-center gap-2 text-[13px]">
                <Check size={14} className="ml-0.5 text-resolved" />
                <span className="font-medium">Connecting the dots across sources</span>
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function TextAnswer({ m }: { m: Message }) {
  const text = m.text ?? "";
  // While streaming, show [F3] labels as plain text; after, they become chips.
  const components = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        if (href?.startsWith("#cite:")) return <Citation factId={href.slice(6)} />;
        return (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">
            {children}
          </a>
        );
      },
    }),
    [],
  );
  if (m.streaming && !text)
    return (
      <div className="glass inline-flex items-center gap-2 rounded-2xl px-4 py-3">
        <span className="dot-pulse flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2 rounded-full bg-accent" />
          ))}
        </span>
        <span className="shimmer text-sm font-medium">{m.pending ?? (useStore.getState().privateMode ? "Thinking on this computer… (local Gemma can take a minute)" : "Thinking…")}</span>
      </div>
    );
  const shown = m.streaming ? text.replace(/\n?\s*\**FOLLOWUPS:[\s\S]*$/i, "") : text;
  return (
    <div className="glass-strong rounded-3xl rounded-tl-lg px-5 py-3.5 text-[15px] text-ink">
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as any} urlTransform={(u) => u}>
          {shown}
        </ReactMarkdown>
      </div>
      {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />}
      {!m.streaming && m.model && (
        <div className="mt-2 flex justify-end">
          <ModelChip models={[m.model]} />
        </div>
      )}
    </div>
  );
}
