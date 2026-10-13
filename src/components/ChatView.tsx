import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Network, RefreshCw } from "lucide-react";
import Composer from "./Composer";
import { MessageView } from "./Messages";
import { useStore } from "../lib/store";
import { DEMO_FILES, DEMO_UPDATE, answer, loadDemoFiles, send } from "../lib/engine";

export default function ChatView({ chatId }: { chatId: string }) {
  const chat = useStore((s) => s.chats.find((c) => c.id === chatId));
  const ctx = useStore((s) => s.contexts.find((c) => c.id === chat?.contextId));
  const sources = useStore((s) => s.sources);
  const setPanel = useStore((s) => s.setPanel);
  const setView = useStore((s) => s.setView);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const last = chat?.messages[chat.messages.length - 1];
  const busy = !!chat?.messages.some((m) => m.streaming || (m.kind === "working" && !m.done));

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat?.messages.length, last?.text, last?.kind]);

  if (!chat) return null;

  // Offer the "update" file in the demo, to show what changes.
  const names = chat.sourceIds.map((id) => sources[id]?.name);
  const isDemo = DEMO_FILES.every((n) => names.includes(n));
  const showDemoUpdate = isDemo && !names.includes(DEMO_UPDATE[0]) && !busy && !!chat.analysis;

  const onSend = (text: string, files: File[]) => void send({ chatId, text, files });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-6 pb-2 pt-4 pl-16 lg:pl-6">
        <div className="min-w-0">
          {ctx && (
            <button onClick={() => setView({ type: "context", contextId: ctx.id })} className="text-xs font-semibold text-ink-soft hover:text-accent">
              {ctx.emoji} {ctx.name} /
            </button>
          )}
          <h2 className="truncate text-base font-bold">{chat.title}</h2>
        </div>
        {chat.analysis && (
          <button
            onClick={() => setPanel({ open: true, mode: "graph", scope: { chatId } })}
            className="glass ml-auto flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-accent transition hover:-translate-y-0.5"
          >
            <Network size={14} /> Graph
            {chat.analysis.conflicts.length > 0 && (
              <span className="rounded-full bg-conflict px-1.5 text-[10px] text-white">{chat.analysis.conflicts.length}</span>
            )}
          </button>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="thin-scroll flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl space-y-6 px-5 pb-8 pt-4">
          {chat.messages.map((m) => (
            <MessageView key={m.id} m={m} chat={chat} onFollowup={(q) => !busy && onSend(q, [])} />
          ))}
          {showDemoUpdate && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={async () => onSend("", await loadDemoFiles(DEMO_UPDATE))}
              className="glass-strong mx-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-accent-2 hover:-translate-y-0.5"
            >
              <RefreshCw size={14} /> Demo: add the revised circular
            </motion.button>
          )}
          {last?.role === "user" && !busy && last.text && !last.sourceIds?.length && (
            <button onClick={() => void answer(chatId)} className="mx-auto block text-xs text-ink-soft underline">
              Retry answer
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-5 pb-5">
        <Composer onSend={onSend} disabled={busy} placeholder={chat.analysis ? "Ask a follow-up, or add more files…" : "Ask anything, or drop your files here…"} />
        <p className="mt-2 text-center text-[11px] text-ink-soft">Answers come only from your sources. Click a citation to check the evidence.</p>
      </div>
    </div>
  );
}
