import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { X, Network, FileText } from "lucide-react";
import { ReactFlow, Background as FlowBg, Controls, MarkerType, type Edge, type Node, Handle, Position } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { useStore, loadBlob } from "../lib/store";
import { findFact, scopeSourceIds } from "../lib/engine";
import { KIND_STYLE, kindIcon, parseLocation } from "../lib/files";
import type { Analysis } from "../../shared/types";
import type { SourceRec } from "../lib/types";

/** Right-hand panel (like Claude's artifacts): the context graph or a source viewer. */
export default function SidePanel() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const [width, setWidth] = useState(() => Math.min(560, Math.max(380, window.innerWidth * 0.38)));
  const isMobile = window.innerWidth < 900;

  const startDrag = (e: React.PointerEvent) => {
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => setWidth(Math.min(900, Math.max(340, w0 + (x0 - ev.clientX))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className={`glass-strong z-40 flex flex-col overflow-hidden ${isMobile ? "fixed inset-0 rounded-none" : "relative m-3 ml-0 rounded-3xl"}`}
      style={isMobile ? undefined : { width }}
    >
      {!isMobile && <div onPointerDown={startDrag} className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-accent/20" />}
      <div className="flex items-center gap-1 border-b border-ink/5 p-2">
        <Tab active={panel.mode === "graph"} onClick={() => setPanel({ mode: "graph" })} icon={Network} label="Context graph" />
        <Tab active={panel.mode === "source"} onClick={() => setPanel({ mode: "source" })} icon={FileText} label="Source" disabled={!panel.sourceId} />
        <button onClick={() => setPanel({ open: false })} className="ml-auto rounded-full p-2 text-ink-soft hover:bg-ink/5">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1">{panel.mode === "graph" ? <GraphView /> : <SourceViewer />}</div>
    </motion.aside>
  );
}

function Tab({ active, onClick, icon: Icon, label, disabled }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ size?: number }>; label: string; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition disabled:opacity-35 ${active ? "bg-accent text-white shadow-sm" : "text-ink-soft hover:bg-ink/5"}`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

/* ---------------- Graph ---------------- */

const EDGE_STYLE: Record<string, { color: string; dash?: string; animated?: boolean; label: string }> = {
  conflicts_with: { color: "#E5484D", animated: true, label: "conflicts" },
  depends_on: { color: "#E59A3A", label: "depends on" },
  updates: { color: "#6E4A7E", dash: "6 4", label: "updates" },
  supports: { color: "#4C9A6A", label: "supports" },
};

function useScope() {
  const panel = useStore((s) => s.panel);
  const view = useStore((s) => s.view);
  const chats = useStore((s) => s.chats);
  const contexts = useStore((s) => s.contexts);
  const scope = panel.scope ?? (view.type === "chat" ? { chatId: view.chatId } : view.type === "context" ? { contextId: view.contextId } : {});
  const chat = scope.chatId ? chats.find((c) => c.id === scope.chatId) : undefined;
  const ctx = scope.contextId ? contexts.find((c) => c.id === scope.contextId) : chat?.contextId ? contexts.find((c) => c.id === chat.contextId) : undefined;
  const analysis: Analysis | undefined = chat?.analysis ?? ctx?.analysis;
  const sourceIds = chat ? scopeSourceIds(chat, ctx) : ctx?.sourceIds ?? [];
  return { analysis, sourceIds };
}

function SourceNode({ data }: { data: { rec: SourceRec } }) {
  const Icon = kindIcon(data.rec.kind, data.rec.name);
  const st = KIND_STYLE[data.rec.kind];
  return (
    <div className="flex w-[190px] items-center gap-2 rounded-2xl border-2 bg-surface px-3 py-2 shadow-sm" style={{ borderColor: `color-mix(in srgb, ${st.color} 35%, transparent)` }}>
      <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: st.bg, color: st.color }}>
        <Icon size={15} />
      </span>
      <span className="truncate text-xs font-bold">{data.rec.name}</span>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-scrim" />
    </div>
  );
}

function FactNode({ data }: { data: { text: string; type: string; superseded: boolean; conflict: boolean; focus: boolean; color: string } }) {
  return (
    <div
      className={`w-[220px] rounded-2xl border bg-surface/95 px-3 py-2 text-[11px] leading-snug shadow-sm transition ${data.superseded ? "opacity-45 line-through" : ""} ${data.focus ? "ring-4 ring-accent/40" : ""}`}
      style={{ borderColor: data.conflict ? "#E5484D" : `color-mix(in srgb, ${data.color} 25%, transparent)`, boxShadow: data.conflict ? "0 0 0 3px rgba(229,72,77,0.15)" : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-scrim" />
      <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wide" style={{ color: data.color }}>
        {data.type}
      </span>
      {data.text.length > 110 ? data.text.slice(0, 107) + "…" : data.text}
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-scrim" />
    </div>
  );
}

const nodeTypes = { source: SourceNode, fact: FactNode };

function GraphView() {
  const { analysis, sourceIds } = useScope();
  const sources = useStore((s) => s.sources);
  const setPanel = useStore((s) => s.setPanel);
  const focus = useStore((s) => s.panel.focusFactId);
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const recs = sourceIds.map((id) => sources[id]).filter((r): r is SourceRec => !!r?.result);
    if (!analysis || !recs.length) return { nodes: [] as Node[], edges: [] as Edge[] };
    const superseded = new Set(analysis.superseded);
    const conflictIds = new Set(analysis.conflicts.flatMap((c) => [c.a, c.b]));
    // Show facts that matter: in a relationship, a conflict, a gap, an action or a key date.
    const important = new Set<string>([
      ...analysis.relationships.flatMap((r) => [r.from, r.to]),
      ...conflictIds,
      ...analysis.gaps.flatMap((g) => g.factIds),
      ...analysis.actions.flatMap((a) => a.factIds),
      ...analysis.keyDates.map((d) => d.factId),
    ]);
    const facts = recs.flatMap((r) => r.result!.facts.filter((f) => important.has(f.id)).map((f) => ({ f, r }))).slice(0, 60);

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 18, ranksep: 70 });
    g.setDefaultEdgeLabel(() => ({}));
    recs.forEach((r) => g.setNode(r.id, { width: 190, height: 46 }));
    facts.forEach(({ f }) => g.setNode(f.id, { width: 220, height: 64 }));
    const edges: Edge[] = [];
    facts.forEach(({ f, r }) => {
      g.setEdge(r.id, f.id);
      edges.push({ id: `s-${f.id}`, source: r.id, target: f.id, style: { stroke: "var(--t-edge-strong)", strokeWidth: 1.2 } });
    });
    const shown = new Set(facts.map((x) => x.f.id));
    analysis.relationships.forEach((rel, i) => {
      if (!shown.has(rel.from) || !shown.has(rel.to)) return;
      // Let relationships shape the layout so connected facts spread out.
      if (rel.type === "updates") g.setEdge(rel.to, rel.from);
      else if (rel.type !== "conflicts_with") g.setEdge(rel.from, rel.to);
      const st = EDGE_STYLE[rel.type];
      edges.push({
        id: `r-${i}`,
        source: rel.from,
        target: rel.to,
        animated: st.animated,
        label: st.label,
        labelStyle: { fill: st.color, fontWeight: 700, fontSize: 10 },
        labelBgStyle: { fill: "var(--t-surface)", fillOpacity: 0.9 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 6,
        style: { stroke: st.color, strokeWidth: rel.type === "conflicts_with" ? 2.6 : 1.8, strokeDasharray: st.dash },
        markerEnd: { type: MarkerType.ArrowClosed, color: st.color, width: 16, height: 16 },
      });
    });
    dagre.layout(g);
    const nodes: Node[] = [
      ...recs.map((r) => {
        const p = g.node(r.id);
        return { id: r.id, type: "source", position: { x: p.x - 95, y: p.y - 23 }, data: { rec: r } };
      }),
      ...facts.map(({ f, r }) => {
        const p = g.node(f.id);
        return {
          id: f.id,
          type: "fact",
          position: { x: p.x - 110, y: p.y - 32 },
          data: {
            text: f.text,
            type: f.type,
            superseded: superseded.has(f.id),
            conflict: conflictIds.has(f.id) && !superseded.has(f.id),
            focus: f.id === focus,
            color: KIND_STYLE[r.kind].color,
          },
        };
      }),
    ];
    return { nodes, edges };
  }, [analysis, sourceIds, sources, focus]);

  const sel = selected ? findFact(selected) : null;

  if (!nodes.length)
    return <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-soft">The graph appears once your sources have been analysed.</div>;

  return (
    <div className="relative h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        nodesConnectable={false}
        onNodeClick={(_, n) => (n.type === "fact" ? setSelected(n.id) : setPanel({ mode: "source", sourceId: n.id, location: undefined }))}
        onPaneClick={() => setSelected(null)}
      >
        <FlowBg gap={22} size={1} color="#6E4A7E22" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-xl bg-surface/90 p-2 text-[10px] font-semibold shadow-sm">
        {Object.entries(EDGE_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: v.color }} /> {v.label}
          </span>
        ))}
      </div>
      {sel && (
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass-strong absolute inset-x-3 bottom-3 rounded-2xl p-4 text-sm">
          <p className="font-semibold">{sel.fact.text}</p>
          {sel.fact.quote && <p className="mt-1 text-xs italic text-ink-soft">“{sel.fact.quote}”</p>}
          <div className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
            <span>
              {sel.source.name}
              {sel.fact.location ? ` · ${sel.fact.location}` : ""} · {sel.fact.certainty}
            </span>
            <button
              onClick={() => setPanel({ mode: "source", sourceId: sel.source.id, location: sel.fact.location, focusFactId: sel.fact.id })}
              className="ml-auto rounded-full bg-accent px-3 py-1 font-semibold text-white"
            >
              Open source
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ---------------- Source viewer ---------------- */

function SourceViewer() {
  const { sourceId, location, focusFactId } = useStore((s) => s.panel);
  const rec = useStore((s) => (sourceId ? s.sources[sourceId] : undefined));
  const [url, setUrl] = useState<string | null>(null);
  const media = useRef<HTMLMediaElement | null>(null);
  const { seconds, page } = parseLocation(location);

  useEffect(() => {
    let u: string | null = null;
    setUrl(null);
    if (sourceId) loadBlob(sourceId).then((b) => b && setUrl((u = URL.createObjectURL(b))));
    return () => void (u && URL.revokeObjectURL(u));
  }, [sourceId]);

  useEffect(() => {
    if (media.current && seconds !== undefined) {
      media.current.currentTime = seconds;
      media.current.play().catch(() => {});
    }
  }, [seconds, url]);

  if (!rec) return <div className="p-6 text-sm text-ink-soft">Select a source.</div>;
  const st = KIND_STYLE[rec.kind];
  const Icon = kindIcon(rec.kind, rec.name);
  const seek = (loc?: string) => {
    const t = parseLocation(loc).seconds;
    if (media.current && t !== undefined) {
      media.current.currentTime = t;
      media.current.play().catch(() => {});
    }
  };

  return (
    <div className="thin-scroll h-full overflow-y-auto p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl" style={{ background: st.bg, color: st.color }}>
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold">{rec.name}</p>
          <p className="text-xs text-ink-soft">{rec.result?.summary}</p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl bg-surface/70">
        {!url && <p className="p-6 text-center text-xs text-ink-soft">Loading preview…</p>}
        {url && rec.kind === "image" && <img src={url} alt={rec.name} className="max-h-[420px] w-full object-contain" />}
        {url && rec.kind === "pdf" && <iframe title={rec.name} src={`${url}#page=${page ?? 1}`} className="h-[440px] w-full" />}
        {url && rec.kind === "audio" && <audio ref={(el) => void (media.current = el)} src={url} controls className="w-full p-3" />}
        {url && rec.kind === "video" && <video ref={(el) => void (media.current = el)} src={url} controls className="max-h-[320px] w-full bg-black" />}
        {url && ["doc", "sheet", "text"].includes(rec.kind) && (
          <div className="max-h-[360px] space-y-2 overflow-y-auto p-3 text-xs">
            {rec.result?.segments.map((s, i) => (
              <div key={i} className={`rounded-lg p-2 ${s.location === location ? "bg-gap/15 ring-1 ring-gap" : "bg-surface"}`}>
                <span className="font-bold text-ink-soft">{s.location}</span>
                <p className="mt-0.5 whitespace-pre-wrap">{s.text.slice(0, 1500)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {rec.result?.notes?.map((n, i) => (
        <p key={i} className="mt-2 rounded-xl bg-gap/10 px-3 py-2 text-xs text-ink">
          ⚠️ {n}
        </p>
      ))}

      {(rec.kind === "audio" || rec.kind === "video") && !!rec.result?.segments.length && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-soft">Transcript</h3>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-surface/60 p-2 text-xs">
            {rec.result.segments.map((s, i) => (
              <button key={i} onClick={() => seek(s.location)} className={`block w-full rounded-lg p-1.5 text-left hover:bg-surface ${s.location === location ? "bg-gap/15" : ""}`}>
                <span className="mr-1.5 font-bold text-accent">{s.location}</span>
                {s.text}
              </button>
            ))}
          </div>
        </>
      )}

      <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-soft">Extracted facts ({rec.result?.facts.length ?? 0})</h3>
      <div className="space-y-1.5">
        {rec.result?.facts.map((f) => (
          <button
            key={f.id}
            onClick={() => seek(f.location)}
            className={`block w-full rounded-xl p-2.5 text-left text-xs transition ${f.id === focusFactId ? "bg-gap/15 ring-2 ring-gap" : "bg-surface/70 hover:bg-surface"}`}
          >
            <span className="flex items-center gap-1.5">
              <span className="rounded-full bg-ink/5 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-soft">{f.type}</span>
              {f.location && <span className="font-semibold text-accent">{f.location}</span>}
              {f.certainty === "inferred" && <span className="text-[10px] italic text-gap">inferred</span>}
            </span>
            <span className="mt-1 block text-[13px] text-ink">{f.text}</span>
            {f.quote && <span className="mt-0.5 block italic text-ink-soft">“{f.quote}”</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
