import { useState } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { CONTEXT_COLORS } from "../lib/files";
import type { Ctx } from "../lib/types";

const EMOJIS = ["📚", "🎓", "🚀", "💼", "🧪", "🏥", "✈️", "🏠", "⚖️", "🛠️", "💡", "🎯"];
type Fields = Pick<Ctx, "name" | "emoji" | "color" | "description" | "instructions">;

/** Create or edit a Context (like a Project in ChatGPT/Claude). */
export default function ContextDialog({ initial, onClose, onSave }: { initial?: Ctx; onClose: () => void; onSave: (v: Fields) => void }) {
  const [v, setV] = useState<Fields>({
    name: initial?.name ?? "",
    emoji: initial?.emoji ?? "📚",
    color: initial?.color ?? CONTEXT_COLORS[0],
    description: initial?.description ?? "",
    instructions: initial?.instructions ?? "",
  });
  const input = "w-full rounded-xl border border-ink/10 bg-surface/85 px-4 py-2.5 text-sm outline-none transition focus:border-accent";
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="glass-strong relative w-full max-w-lg rounded-3xl p-7"
        initial={{ y: 24, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
      >
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1.5 text-ink-soft hover:bg-ink/5">
          <X size={18} />
        </button>
        <h2 className="text-xl font-bold">{initial ? "Edit context" : "New context"}</h2>
        <p className="mt-1 text-sm text-ink-soft">A context holds shared files and instructions. Every chat inside it can use them.</p>

        <div className="mt-5 flex gap-3">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: v.color + "22" }}>
            {v.emoji}
          </div>
          <input autoFocus className={input} placeholder="Name, e.g. Semester 5 exams" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value.slice(0, 40) })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => setV({ ...v, emoji: e })} className={`grid size-9 place-items-center rounded-xl text-lg ${v.emoji === e ? "bg-accent/15 ring-2 ring-accent" : "hover:bg-ink/5"}`}>
              {e}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          {CONTEXT_COLORS.map((c) => (
            <button key={c} onClick={() => setV({ ...v, color: c })} className={`size-7 rounded-full ${v.color === c ? "ring-2 ring-ink ring-offset-2" : ""}`} style={{ background: c }} />
          ))}
        </div>
        <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">Description</label>
        <input className={`${input} mt-1.5`} placeholder="What is this context about? (optional)" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-soft">Instructions for this context</label>
        <textarea
          rows={3}
          className={`${input} mt-1.5 resize-none`}
          placeholder="e.g. I'm a 3rd-year CSE student. Focus on exams, deadlines and what I should do first."
          value={v.instructions}
          onChange={(e) => setV({ ...v, instructions: e.target.value })}
        />
        <div className="mt-6 flex justify-end">
          <button
            disabled={!v.name.trim()}
            onClick={() => onSave({ ...v, name: v.name.trim() })}
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-md transition hover:-translate-y-0.5 disabled:opacity-40"
          >
            {initial ? "Save" : "Create context"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
