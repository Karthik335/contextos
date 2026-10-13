// Snap with camera: take a photo of a notice, whiteboard or page and send it straight to Gemma 4.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Camera, Check, RotateCcw, SwitchCamera, X } from "lucide-react";

const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");

/** Camera button for the composer. Phones use the native camera app; laptops get a live preview. */
export default function CameraButton({ onCapture }: { onCapture: (files: File[]) => void }) {
  const [open, setOpen] = useState(false);
  const nativeRef = useRef<HTMLInputElement>(null);
  const canStream = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

  return (
    <>
      <button
        onClick={() => (isTouch() || !canStream ? nativeRef.current?.click() : setOpen(true))}
        title="Snap with camera: photograph a notice, page or whiteboard"
        className="attach-btn grid size-10 shrink-0 place-items-center rounded-full transition hover:bg-rose/40 hover:text-accent"
      >
        <Camera size={19} />
      </button>
      <input
        ref={nativeRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onCapture([new File([f], `camera-${stamp()}.${f.type === "image/png" ? "png" : "jpg"}`, { type: f.type || "image/jpeg" })]);
          e.target.value = "";
        }}
      />
      {createPortal(
        <AnimatePresence>
          {open && (
            <CameraModal
              onClose={() => setOpen(false)}
              onFallback={() => {
                setOpen(false);
                nativeRef.current?.click();
              }}
              onCapture={(f) => {
                onCapture([f]);
                setOpen(false);
              }}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function CameraModal({ onClose, onCapture, onFallback }: { onClose: () => void; onCapture: (f: File) => void; onFallback: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cams, setCams] = useState(0);
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError("");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => {});
        }
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCams(devices.filter((d) => d.kind === "videoinput").length);
      })
      .catch((err) => {
        const name = String(err?.name ?? "");
        setError(
          name === "NotAllowedError"
            ? "Camera permission was blocked. Allow the camera in your browser's address bar, then try again."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : `Couldn't open the camera (${err?.message ?? name}).`,
        );
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.key === " " || e.key === "Enter") && !shot && !error) {
        e.preventDefault();
        snap();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  useEffect(() => () => void (shot && URL.revokeObjectURL(shot.url)), [shot]);

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    c.toBlob((b) => b && setShot({ url: URL.createObjectURL(b), blob: b }), "image/jpeg", 0.92);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong w-full max-w-2xl overflow-hidden rounded-3xl"
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <Camera size={16} className="text-accent" />
          <p className="text-sm font-bold">Snap with camera</p>
          <p className="hidden text-xs text-ink-soft sm:block">Notices, pages, whiteboards, screens. Gemma 4 reads the photo.</p>
          <button onClick={onClose} className="ml-auto grid size-8 place-items-center rounded-full text-ink-soft hover:bg-ink/10" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="relative aspect-video w-full bg-black">
          {error ? (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <p className="text-sm text-white/90">{error}</p>
                <button onClick={onFallback} className="mt-3 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25">
                  Choose a photo instead
                </button>
              </div>
            </div>
          ) : (
            <>
              <video ref={videoRef} playsInline muted className={`h-full w-full object-contain ${shot ? "hidden" : ""} ${facing === "user" ? "-scale-x-100" : ""}`} />
              {shot && <img src={shot.url} alt="Captured" className="h-full w-full object-contain" />}
              {/* Framing guide */}
              {!shot && <div className="pointer-events-none absolute inset-[8%] rounded-2xl border-2 border-dashed border-white/35" />}
              <AnimatePresence>{flash && <motion.div initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-white" />}</AnimatePresence>
            </>
          )}
        </div>
        <div className="flex items-center justify-center gap-3 px-4 py-4">
          {shot ? (
            <>
              <button onClick={() => setShot(null)} className="inline-flex items-center gap-2 rounded-full border border-edge-strong bg-surface px-4 py-2 text-sm font-semibold hover:text-accent">
                <RotateCcw size={15} /> Retake
              </button>
              <button
                onClick={() => onCapture(new File([shot.blob], `camera-${stamp()}.jpg`, { type: "image/jpeg" }))}
                className="inline-flex items-center gap-2 rounded-full bg-send px-5 py-2 text-sm font-semibold text-white shadow-md hover:-translate-y-0.5"
              >
                <Check size={15} /> Use photo
              </button>
            </>
          ) : (
            !error && (
              <>
                <span className="size-10" />
                <button onClick={snap} title="Take photo (Space)" className="grid size-16 place-items-center rounded-full border-4 border-white/80 bg-accent shadow-lg transition hover:scale-105 active:scale-95">
                  <Camera size={22} className="text-white" />
                </button>
                {cams > 1 ? (
                  <button onClick={() => setFacing(facing === "environment" ? "user" : "environment")} title="Switch camera" className="grid size-10 place-items-center rounded-full text-ink-soft hover:bg-ink/10">
                    <SwitchCamera size={18} />
                  </button>
                ) : (
                  <span className="size-10" />
                )}
              </>
            )
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
