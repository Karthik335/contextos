import { useStore } from "../lib/store";
import { findFact } from "../lib/engine";
import { KIND_STYLE, kindIcon } from "../lib/files";

/** A small clickable chip pointing at the evidence for a claim. */
export default function Citation({ factId, label }: { factId: string; label?: string }) {
  const setPanel = useStore((s) => s.setPanel);
  useStore((s) => s.sources); // re-render when sources change
  const hit = findFact(factId);
  if (!hit) return label ? <span className="text-xs text-ink-soft">[{label}]</span> : null;
  const { fact, source } = hit;
  const style = KIND_STYLE[source.kind];
  const Icon = kindIcon(source.kind, source.name);
  const short = source.name.length > 22 ? source.name.slice(0, 19) + "…" : source.name;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setPanel({ open: true, mode: "source", sourceId: source.id, location: fact.location, focusFactId: fact.id });
      }}
      title={`${fact.text}${fact.quote ? `\n“${fact.quote}”` : ""}`}
      className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full border px-2 py-[1px] align-middle text-[11px] font-semibold leading-5 transition hover:-translate-y-0.5 hover:shadow-sm"
      style={{ background: style.bg, color: style.color, borderColor: `color-mix(in srgb, ${style.color} 22%, transparent)` }}
    >
      <Icon size={11} />
      {short}
      {fact.location && fact.location !== "image" && fact.location !== "text" ? ` · ${fact.location}` : ""}
    </button>
  );
}

export function Citations({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-y-1">
      {[...new Set(ids)].slice(0, 4).map((id) => (
        <Citation key={id} factId={id} />
      ))}
    </span>
  );
}
