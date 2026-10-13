import { useRef } from "react";
import { motion } from "motion/react";
import { Loader2, MessageSquare, Pencil, Plus, Sparkles } from "lucide-react";
import Composer from "./Composer";
import Briefing, { ChangesCard } from "./Briefing";
import { SourceCard } from "./Messages";
import { useStore } from "../lib/store";
import { ACCEPT } from "../lib/files";
import { addToContext, removeContextSource, send } from "../lib/engine";
import type { SourceRec } from "../lib/types";
import { useState } from "react";
import { AnimatePresence } from "motion/react";
import ContextDialog from "./ContextDialog";

/** A context's home: shared sources, its briefing, its chats, and a composer for a new chat. */
export default function ContextPage({ contextId }: { contextId: string }) {
  const ctx = useStore((s) => s.contexts.find((c) => c.id === contextId));
  const allChats = useStore((s) => s.chats);
  const chats = allChats.filter((c) => c.contextId === contextId);
  const sources = useStore((s) => s.sources);
  const setView = useStore((s) => s.setView);
  const patchContext = useStore((s) => s.patchContext);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  if (!ctx) return null;

  const recs = ctx.sourceIds.map((id) => sources[id]).filter(Boolean) as SourceRec[];
  const processing = recs.some((r) => r.status === "uploading" || r.status === "processing");

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 pb-10 pt-6 pl-16 lg:pl-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-4">
          <div className="grid size-16 shrink-0 place-items-center rounded-3xl text-3xl shadow-sm" style={{ background: ctx.color + "26" }}>
            {ctx.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="headline text-4xl sm:text-5xl">{ctx.name}</h1>
            {ctx.description && <p className="mt-1 text-sm font-medium text-ink/70">{ctx.description}</p>}
            {ctx.instructions && (
              <p className="glass mt-3 inline-block rounded-2xl px-3 py-1.5 text-xs text-ink-soft">
                <span className="font-semibold text-ink">Instructions:</span> {ctx.instructions}
              </p>
            )}
          </div>
          <button onClick={() => setEditing(true)} className="glass rounded-full p-2.5 text-ink-soft hover:text-accent" title="Edit context">
            <Pencil size={16} />
          </button>
        </motion.div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Briefing */}
            <section className="glass-strong rounded-3xl p-5">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
                <Sparkles size={12} /> Context briefing
                {(ctx.analyzing || processing) && <Loader2 size={13} className="ml-1 animate-spin" />}
              </p>
              {ctx.lastChanges && (
                <div className="mb-5 rounded-2xl bg-surface/60 p-4">
                  <ChangesCard changes={ctx.lastChanges} />
                </div>
              )}
              {ctx.analysis ? (
                <Briefing analysis={ctx.analysis} scope={{ contextId }} />
              ) : (
                <p className="text-sm text-ink-soft">
                  {processing || ctx.analyzing ? (
                    <span className="shimmer font-semibold">Reading your sources and connecting the dots…</span>
                  ) : (
                    "Add sources to this context and its briefing will appear here. Every chat in this context can use them."
                  )}
                </p>
              )}
            </section>

            {/* New chat */}
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-on-bg drop-shadow">Ask about {ctx.name}</h2>
              <Composer
                placeholder={recs.length ? `Start a new chat about ${ctx.name}…` : "Add sources first, or just start chatting…"}
                onSend={(text, files) => void send({ contextId, text, files })}
              />
            </section>

            {chats.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-on-bg drop-shadow">Chats in this context</h2>
                <div className="space-y-2">
                  {chats.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setView({ type: "chat", chatId: c.id })}
                      className="glass flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:-translate-y-0.5"
                    >
                      <MessageSquare size={16} className="text-accent" />
                      <span className="flex-1 truncate text-sm font-semibold">{c.title}</span>
                      <span className="text-xs text-ink-soft">{new Date(c.updatedAt).toLocaleDateString()}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Sources */}
          <aside className="glass h-fit rounded-3xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">Sources ({recs.length})</h2>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5"
              >
                <Plus size={13} /> Add
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept={ACCEPT}
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (files.length) void addToContext(contextId, files);
                }}
              />
            </div>
            {recs.length === 0 ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-2xl border-2 border-dashed border-ink/10 p-6 text-center text-sm text-ink-soft transition hover:border-accent/40 hover:text-accent"
              >
                Drop files here or click to add.
                <br />
                <span className="text-xs">Images · PDFs · Docs · Sheets · Audio · Video</span>
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                {recs.map((r) => (
                  <SourceCard key={r.id} rec={r} contextId={contextId} onRemove={() => removeContextSource(contextId, r.id)} />
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <ContextDialog
            initial={ctx}
            onClose={() => setEditing(false)}
            onSave={(v) => {
              patchContext(contextId, v);
              setEditing(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
