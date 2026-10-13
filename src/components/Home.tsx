import { useState } from "react";
import { motion } from "motion/react";
import { CalendarClock, FileSearch, PlayCircle, Sparkles } from "lucide-react";
import Composer from "./Composer";
import { useStore } from "../lib/store";
import { DEMO_FILES, loadDemoFiles, send } from "../lib/engine";

const SUGGESTIONS = [
  { icon: CalendarClock, text: "Make sense of my exam schedule", prompt: "Here's my exam schedule and notices. What clashes, and what should I do first?", rot: -3, x: 0 },
  { icon: PlayCircle, text: "Summarise a lecture video", prompt: "Summarise this lecture and list anything I need to do, with timestamps.", rot: 2.5, x: 40 },
  { icon: FileSearch, text: "Find conflicts in my documents", prompt: "Find any conflicts, contradictions or missing information across these documents.", rot: -1.5, x: 12 },
  { icon: Sparkles, text: "Try the demo", prompt: "", rot: 3, x: 56, demo: true },
];

export default function Home({ contextId }: { contextId?: string }) {
  const ctx = useStore((s) => s.contexts.find((c) => c.id === contextId));
  const [draft, setDraft] = useState("");
  const [loadingDemo, setLoadingDemo] = useState(false);

  const runDemo = async () => {
    setLoadingDemo(true);
    const files = await loadDemoFiles(DEMO_FILES);
    setLoadingDemo(false);
    if (files.length) void send({ contextId: contextId ?? null, text: "", files });
  };

  return (
    <div className="thin-scroll flex flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col justify-center px-6 py-16">
        {ctx && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass mb-6 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold">
            <span>{ctx.emoji}</span> New chat in {ctx.name}
            <span className="font-normal text-ink-soft">· uses its {ctx.sourceIds.length} shared source{ctx.sourceIds.length === 1 ? "" : "s"}</span>
          </motion.div>
        )}
        <motion.h1
          className="headline text-[44px] sm:text-[68px]"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        >
          <span className="headline-accent">Hey!</span> What should
          <br />
          we analyse today?
        </motion.h1>
        <motion.p
          className="mt-4 max-w-xl text-[15px] font-medium text-ink/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
        >
          Drop photos, screenshots, PDFs, voice notes, videos or documents. ContextOS connects the dots, finds what clashes and what's missing, then you can ask it anything.
        </motion.p>

        <motion.div className="mt-8" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5 }}>
          <Composer
            autoFocus
            value={draft}
            onChange={setDraft}
            onSend={(text, files) => void send({ contextId: contextId ?? null, text, files })}
          />
        </motion.div>

        <div className="relative mt-8 flex flex-wrap gap-3">
          {SUGGESTIONS.map((s, i) => (
            <motion.button
              key={s.text}
              onClick={() => (s.demo ? runDemo() : setDraft(s.prompt))}
              initial={{ opacity: 0, y: 24, rotate: 0 }}
              animate={{ opacity: 1, y: 0, rotate: s.rot }}
              transition={{ delay: 0.5 + i * 0.09, type: "spring", stiffness: 180, damping: 14 }}
              whileHover={{ rotate: 0, scale: 1.04, y: -3 }}
              className="float glass-strong flex items-center gap-2 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-ink"
              style={{ animationDelay: `${i * 0.7}s` }}
            >
              <s.icon size={16} className={s.demo ? "text-accent" : "text-accent-2"} />
              {s.demo && loadingDemo ? "Loading demo…" : s.text}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
