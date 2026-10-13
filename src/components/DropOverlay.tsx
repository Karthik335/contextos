import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../lib/store";
import { attachFiles } from "./Composer";
import { addToContext } from "../lib/engine";

/** Drag files anywhere: a frosted overlay appears; dropping attaches them. */
export default function DropOverlay() {
  const [show, setShow] = useState(false);
  const depth = useRef(0);
  const view = useStore((s) => s.view);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setShow(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setShow(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setShow(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      const v = useStore.getState().view;
      if (v.type === "context") void addToContext(v.contextId, files);
      else attachFiles(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-surface/30 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-3 rounded-[32px] border-[3px] border-dashed border-edge shadow-[inset_0_0_80px_rgba(181,84,107,0.25)]" />
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="flex flex-col items-center">
            <div className="orb orb-busy size-24 rounded-full shadow-2xl" />
            <p className="headline mt-6 text-4xl">Drop to add to your context</p>
            <p className="mt-2 text-sm font-medium text-ink/70">
              {view.type === "context" ? "They'll be shared with every chat in this context." : "Images, PDFs, documents, audio and video."}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
