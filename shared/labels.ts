// Short fact labels (F1, F2, …) used in prompts and chat citations.
// Server and browser compute them the same way, so citations map back to facts.
import type { SourcePayload } from "./types";

export function labelFacts(sources: Pick<SourcePayload, "facts">[]) {
  const toLabel = new Map<string, string>();
  const toId = new Map<string, string>();
  let n = 1;
  for (const s of sources)
    for (const f of s.facts) {
      const label = `F${n++}`;
      toLabel.set(f.id, label);
      toId.set(label, f.id);
    }
  return { toLabel, toId };
}

/** Friendly model name for the UI, e.g. "Gemma 4 31B" or "Gemini 2.5 Flash". */
export function modelLabel(m: string) {
  if (m === "mock") return "Mock (not AI)";
  if (/whisper/i.test(m)) return "Whisper";
  if (/sarvam|saaras/i.test(m)) return "Sarvam AI";
  const loc = /^gemma4:(\w+)/i.exec(m);
  if (loc) return `Gemma 4 ${loc[1].toUpperCase()} · on this computer`;
  const g4 = /gemma-4-(\w+?)(?:-a\d+b)?-it/i.exec(m);
  if (g4) return `Gemma 4 ${g4[1].toUpperCase()}`;
  const gm = /gemini-([\d.]+)-flash(-lite)?/i.exec(m);
  if (gm) return `Gemini ${gm[1]} Flash${gm[2] ? " Lite" : ""}`;
  return m;
}

export const isGemma = (m: string) => /gemma/i.test(m);
