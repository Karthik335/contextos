import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Languages } from "lucide-react";
import { useStore } from "../lib/store";
import { LANGUAGES } from "../../shared/languages";

/** Small pill in the composer: choose the language for briefings and co-pilot answers. */
export default function LanguagePicker() {
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.name === language) ?? LANGUAGES[0];

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Answer language: briefings and co-pilot replies are written in this language"
        className={`flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition hover:bg-rose/30 ${
          current.code === "en" ? "text-ink-soft" : "bg-accent-2/15 text-accent-2"
        }`}
      >
        <Languages size={16} />
        <span className="hidden sm:inline">{current.native}</span>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="thin-scroll absolute bottom-12 right-0 z-50 max-h-80 w-56 overflow-y-auto rounded-2xl border border-edge-strong bg-surface p-1.5 shadow-2xl"
            >
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-soft">Answer in</p>
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    setLanguage(l.name);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-ink/5 ${l.name === language ? "font-semibold text-accent" : "text-ink"}`}
                >
                  <span className="flex-1">
                    {l.native}
                    {l.native !== l.name && <span className="ml-1.5 text-xs text-ink-soft">{l.name}</span>}
                  </span>
                  {l.name === language && <Check size={14} />}
                </button>
              ))}
              <p className="px-2.5 pb-1.5 pt-1 text-[10px] leading-snug text-ink-soft">Sources can be in any language. Gemma 4 understands 140+.</p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
