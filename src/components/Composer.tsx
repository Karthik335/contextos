import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Plus, X } from "lucide-react";
import { ACCEPT, KIND_STYLE, MAX_BYTES, formatSize, kindIcon, kindOf } from "../lib/files";
import LanguagePicker from "./LanguagePicker";
import CameraButton from "./CameraCapture";

export const ATTACH_EVENT = "contextos:attach";
export const attachFiles = (files: File[]) => window.dispatchEvent(new CustomEvent(ATTACH_EVENT, { detail: files }));

interface Props {
  onSend: (text: string, files: File[]) => void;
  disabled?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
  autoFocus?: boolean;
}

/** The glass input bar: text + attachments (all supported formats). */
export default function Composer({ onSend, disabled, placeholder, value, onChange, autoFocus }: Props) {
  const [inner, setInner] = useState("");
  const text = value ?? inner;
  const setText = onChange ?? setInner;
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const add = (list: File[]) => {
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of list) {
      if (!kindOf(f.name, f.type)) bad.push(`${f.name} (unsupported type)`);
      else if (f.size > MAX_BYTES) bad.push(`${f.name} (over 200 MB)`);
      else ok.push(f);
    }
    setError(bad.length ? `Skipped: ${bad.join(", ")}` : "");
    setFiles((cur) => [...cur, ...ok]);
  };

  useEffect(() => {
    const h = (e: Event) => add((e as CustomEvent<File[]>).detail);
    window.addEventListener(ATTACH_EVENT, h);
    return () => window.removeEventListener(ATTACH_EVENT, h);
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(220, ta.scrollHeight) + "px";
  }, [text]);

  const canSend = !disabled && (text.trim() || files.length);
  const submit = () => {
    if (!canSend) return;
    onSend(text, files);
    setText("");
    setFiles([]);
    setError("");
  };

  return (
    <div className="w-full">
      <div className="glass-strong rounded-[22px] p-2 transition-shadow focus-within:shadow-[0_0_0_4px_var(--focus-glow),0_12px_36px_rgba(110,74,126,0.14)]">
        <AnimatePresence initial={false}>
          {files.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="thin-scroll flex gap-2 overflow-x-auto px-1 pb-2 pt-1">
                {files.map((f, i) => (
                  <FileChip key={f.name + i} file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-end gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            title="Attach images, PDFs, documents, audio or video"
            className="attach-btn grid size-10 shrink-0 place-items-center rounded-full transition hover:bg-rose/40 hover:text-accent"
          >
            <Plus size={20} />
          </button>
          <CameraButton onCapture={add} />
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <textarea
            ref={taRef}
            rows={1}
            autoFocus={autoFocus}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                add(pasted);
              }
            }}
            placeholder={placeholder ?? "Ask anything, or drop your files here…"}
            className="max-h-[220px] min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-soft/70"
          />
          <LanguagePicker />
          <button
            onClick={submit}
            disabled={!canSend}
            title="Send"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-send text-white shadow-md shadow-send/30 transition hover:-translate-y-0.5 hover:shadow-lg disabled:translate-y-0 disabled:bg-[var(--send-disabled)] disabled:shadow-none"
          >
            <ArrowUp size={19} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {error && <p className="mt-1.5 px-3 text-xs text-conflict">{error}</p>}
    </div>
  );
}

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const kind = kindOf(file.name, file.type)!;
  const style = KIND_STYLE[kind];
  const Icon = kindIcon(kind, file.name);
  const url = useMemo(() => (kind === "image" ? URL.createObjectURL(file) : null), [file, kind]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <motion.div
      layout
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="group relative flex w-52 shrink-0 items-center gap-2.5 rounded-2xl border border-edge bg-surface/90 p-2 pr-7 shadow-sm"
    >
      {url ? (
        <img src={url} alt="" className="size-10 rounded-xl object-cover" />
      ) : (
        <span className="grid size-10 place-items-center rounded-xl" style={{ background: style.bg, color: style.color }}>
          <Icon size={18} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{file.name}</span>
        <span className="block text-[11px] text-ink-soft">
          {style.label} · {formatSize(file.size)}
        </span>
      </span>
      <button onClick={onRemove} className="absolute right-1.5 top-1.5 rounded-full p-0.5 text-ink-soft hover:bg-ink/10">
        <X size={13} />
      </button>
    </motion.div>
  );
}
