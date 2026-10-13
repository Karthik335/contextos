import { useEffect, useState } from "react";
import { AlertTriangle, Cloud, Lock } from "lucide-react";
import { getStatus, type ServerStatus } from "../lib/api";
import { useStore } from "../lib/store";
import { modelLabel } from "../../shared/labels";

/**
 * Bottom of the sidebar: which Gemma is answering, plus the Private mode switch
 * (everything runs on local Gemma 4 through Ollama; nothing leaves the computer).
 */
export default function StatusPill() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const privateMode = useStore((s) => s.privateMode);
  const setPrivateMode = useStore((s) => s.setPrivateMode);

  useEffect(() => {
    let alive = true;
    const load = () => getStatus().then((s) => alive && setStatus(s));
    load();
    const t = setInterval(load, 15000); // notice when Ollama is started or stopped
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!status) return null;
  const local = status.local;
  const localReady = !!local?.running && !!local?.hasModel;
  const localHint = !local?.running
    ? "Start the Ollama app on this computer to use Private mode."
    : !local.hasModel
      ? `Download the model first: ollama pull ${local.model}`
      : `Runs Gemma 4 on this computer (${local.model}). Nothing is sent to the internet.`;

  const cloudWarn = status.mock ? "Mock mode: not Gemma" : !status.hasKey ? "API key missing on server" : null;
  const usingPrivate = privateMode && !status.mock;

  return (
    <div className="mx-3 mb-2 space-y-1.5">
      {/* Private mode switch */}
      <button
        onClick={() => (localReady || privateMode) && setPrivateMode(!privateMode)}
        title={localHint}
        className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ${
          usingPrivate ? "bg-resolved-soft" : "bg-surface/50 hover:bg-surface/80"
        } ${!localReady && !privateMode ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <Lock size={14} className={usingPrivate ? "text-resolved" : "text-ink-soft"} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold">Private mode</span>
          <span className="block truncate text-[10.5px] text-ink-soft">
            {usingPrivate ? (localReady ? "On this computer · offline" : "Ollama not reachable!") : localReady ? "Off · uses Google cloud" : !local?.running ? "Start Ollama to enable" : "Model not downloaded"}
          </span>
        </span>
        <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${usingPrivate ? "bg-resolved" : "bg-ink/20"}`}>
          <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${usingPrivate ? "left-[18px]" : "left-0.5"}`} />
        </span>
      </button>

      {/* Which model is answering */}
      <div
        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-medium ${
          !usingPrivate && cloudWarn ? "bg-conflict/10 text-conflict" : "bg-surface/50 text-ink-soft"
        }`}
        title={
          usingPrivate
            ? localHint
            : `Vision: ${status.model}\nExtraction: ${status.fastModel ?? status.model}\nReasoning + chat: ${status.reasoningModel ?? status.model}\nAudio: ${status.audioModel ?? "Whisper (open-source, local)"}`
        }
      >
        {usingPrivate ? <Lock size={12} className="text-resolved" /> : cloudWarn ? <AlertTriangle size={12} /> : <Cloud size={12} className="text-accent" />}
        <span className="truncate">
          {usingPrivate
            ? modelLabel(local?.model ?? "gemma4:e4b")
            : cloudWarn ?? `Open models · ${modelLabel(status.model)}${status.fastModel ? ` + ${modelLabel(status.fastModel).replace("Gemma 4 ", "")}` : ""}`}
        </span>
      </div>
    </div>
  );
}
