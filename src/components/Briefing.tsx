import { motion } from "motion/react";
import { AlertTriangle, ArrowRight, CalendarDays, CalendarPlus, CheckCircle2, Lightbulb, ListChecks, Network, ShieldCheck, Wand2 } from "lucide-react";
import Citation, { Citations } from "./Citation";
import { actOnIt, findFact } from "../lib/engine";
import { downloadIcs } from "../lib/actions";
import { useStore } from "../lib/store";
import { formatDate } from "../../shared/conflicts";
import type { Analysis, Changes } from "../../shared/types";

const section = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.12 * i, duration: 0.45, ease: "easeOut" as const } }),
};

const urgency = (iso: string) => {
  const days = (new Date(iso + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 86400000;
  if (days < 0) return { color: "var(--t-ink-soft)", label: "past" };
  if (days <= 2) return { color: "var(--color-conflict)", label: days === 0 ? "today" : days === 1 ? "tomorrow" : "in 2 days" };
  if (days <= 7) return { color: "var(--color-gap)", label: `in ${Math.round(days)} days` };
  return { color: "var(--color-resolved)", label: `in ${Math.round(days)} days` };
};

/** The context briefing: overview, conflicts, gaps, key dates, actions, all with citations. */
export default function Briefing({
  analysis,
  scope,
  compact,
}: {
  analysis: Analysis;
  scope: { chatId?: string; contextId?: string };
  compact?: boolean;
}) {
  const setPanel = useStore((s) => s.setPanel);
  let i = 0;
  return (
    <div className="space-y-4">
      <motion.div custom={i++} variants={section} initial="hidden" animate="show">
        <h3 className="text-lg font-bold tracking-tight">{analysis.title}</h3>
        <p className="mt-1 text-[15px] leading-relaxed text-ink/85">{analysis.overview}</p>
      </motion.div>

      {analysis.conflicts.length > 0 && (
        <motion.div custom={i++} variants={section} initial="hidden" animate="show">
          <Heading icon={AlertTriangle} color="var(--color-conflict)" label={`Conflicts (${analysis.conflicts.length})`} pulse />
          <div className="space-y-2">
            {analysis.conflicts.map((c, k) => (
              <div key={k} className="rounded-2xl border-l-4 border-conflict bg-conflict-soft p-3.5">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="flex-1 text-sm font-medium leading-relaxed">
                    {findFact(c.a)?.fact.text ?? "?"} <span className="mx-1 font-bold text-conflict">vs</span> {findFact(c.b)?.fact.text ?? "?"}
                  </p>
                  {c.verifiedByCode && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-conflict" title="Overlap checked by deterministic code, not by the AI">
                      <ShieldCheck size={11} /> Verified by code
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[13px] text-ink-soft">{c.explanation}</p>
                <div className="mt-2">
                  <Citations ids={[c.a, c.b]} />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {analysis.gaps.length > 0 && (
        <motion.div custom={i++} variants={section} initial="hidden" animate="show">
          <Heading icon={Lightbulb} color="var(--color-gap)" label="What you might be missing" />
          <div className="space-y-2">
            {analysis.gaps.map((g, k) => (
              <div key={k} className="rounded-2xl border-l-4 border-gap bg-gap-soft p-3.5">
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-sm font-semibold">{g.question}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${g.impact === "high" ? "bg-gap text-white" : "bg-surface text-gap"}`}>{g.impact}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink/75">{g.why}</p>
                {g.resolveBy && (
                  <p className="mt-1 flex items-start gap-1 text-[13px] text-ink-soft">
                    <ArrowRight size={13} className="mt-0.5 shrink-0" /> {g.resolveBy}
                  </p>
                )}
                <div className="mt-2">
                  <Citations ids={g.factIds} />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {analysis.keyDates.length > 0 && !compact && (
        <motion.div custom={i++} variants={section} initial="hidden" animate="show">
          <Heading icon={CalendarDays} color="var(--color-accent-2)" label="Key dates" />
          <ol className="relative ml-2 border-l-2 border-edge-strong pl-5">
            {analysis.keyDates.slice(0, 10).map((d) => {
              const u = urgency(d.date);
              return (
                <li key={d.factId} className="relative mb-3 last:mb-0">
                  <span className="absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-edge-strong" style={{ background: u.color }} />
                  <p className="text-xs font-bold" style={{ color: u.color }}>
                    {formatDate(d.date)}
                    {findFact(d.factId)?.fact.startTime ? ` · ${findFact(d.factId)!.fact.startTime}` : ""} <span className="font-medium text-ink-soft">({u.label})</span>
                  </p>
                  <p className="text-sm">
                    {d.label} <Citation factId={d.factId} />
                    {u.label !== "past" && (
                      <button
                        title="Add this date to your calendar (.ics)"
                        onClick={() => {
                          const f = findFact(d.factId)?.fact;
                          downloadIcs([{ tool: "create_calendar_event", title: d.label.slice(0, 80), date: d.date, startTime: f?.startTime, endTime: f?.endTime, factIds: [d.factId] }]);
                        }}
                        className="ml-1 inline-grid size-6 translate-y-[3px] place-items-center rounded-full text-ink-soft transition hover:bg-accent-2/10 hover:text-accent-2"
                      >
                        <CalendarPlus size={13} />
                      </button>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </motion.div>
      )}

      {analysis.actions.length > 0 && (
        <motion.div custom={i++} variants={section} initial="hidden" animate="show">
          <Heading icon={ListChecks} color="var(--color-accent)" label="What to do next" />
          <ol className="space-y-1.5">
            {analysis.actions.map((a, k) => (
              <li key={k} className="flex gap-3 rounded-2xl bg-surface/70 p-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-white">{k + 1}</span>
                <p className="text-sm leading-relaxed">
                  {a.text} <Citations ids={a.factIds} />
                </p>
              </li>
            ))}
          </ol>
        </motion.div>
      )}

      {analysis.conflicts.length === 0 && analysis.gaps.length === 0 && (
        <motion.p custom={i++} variants={section} initial="hidden" animate="show" className="flex items-center gap-2 text-sm text-resolved">
          <CheckCircle2 size={16} /> No conflicts or obvious gaps found in these sources.
        </motion.p>
      )}

      <motion.div custom={i++} variants={section} initial="hidden" animate="show" className="flex flex-wrap gap-2">
        <button
          onClick={() => actOnIt(scope)}
          title="Gemma 4 picks tools (calendar, message, checklist); you approve each one"
          className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <Wand2 size={15} /> Act on it
        </button>
        <button
          onClick={() => setPanel({ open: true, mode: "graph", scope, focusFactId: undefined })}
          className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-surface/80 px-4 py-2 text-sm font-semibold text-accent transition hover:-translate-y-0.5 hover:bg-surface hover:shadow-md"
        >
          <Network size={15} /> View context graph
        </button>
      </motion.div>
    </div>
  );
}

function Heading({ icon: Icon, color, label, pulse }: { icon: React.ComponentType<{ size?: number }>; color: string; label: string; pulse?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className={`grid size-6 place-items-center rounded-full text-white ${pulse ? "pulse-ring" : ""}`} style={{ background: color }}>
        <Icon size={13} />
      </span>
      <span className="text-sm font-bold uppercase tracking-wide" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

/** "What changed" after new evidence arrives. */
export function ChangesCard({ changes }: { changes: Changes }) {
  const rows: { color: string; bg: string; label: string; items: React.ReactNode[] }[] = [
    {
      color: "var(--color-resolved)",
      bg: "var(--t-resolved-soft)",
      label: "Resolved",
      items: [
        ...changes.resolvedConflicts.map((c, k) => (
          <span key={"rc" + k}>
            Conflict cleared: {findFact(c.a)?.fact.text ?? "?"} vs {findFact(c.b)?.fact.text ?? "?"}
          </span>
        )),
        ...changes.resolvedGaps.map((g, k) => <span key={"rg" + k}>No longer missing: {g.question}</span>),
      ],
    },
    {
      color: "var(--color-conflict)",
      bg: "var(--t-conflict-soft)",
      label: "New conflicts",
      items: changes.newConflicts.map((c, k) => (
        <span key={k}>
          {c.explanation} <Citations ids={[c.a, c.b]} />
        </span>
      )),
    },
    {
      color: "var(--color-gap)",
      bg: "var(--t-gap-soft)",
      label: "New gaps",
      items: changes.newGaps.map((g, k) => <span key={k}>{g.question}</span>),
    },
    {
      color: "var(--color-accent-2)",
      bg: "var(--t-violet-soft)",
      label: "New facts",
      items: changes.newFacts.slice(0, 6).map((id) => (
        <span key={id}>
          {findFact(id)?.fact.text} <Citation factId={id} />
        </span>
      )),
    },
  ].filter((r) => r.items.length);

  return (
    <div>
      <p className="text-sm font-semibold">What changed: {changes.summary}</p>
      <div className="mt-3 space-y-2">
        {rows.map((r, idx) => (
          <motion.div
            key={r.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.12, duration: 0.6 }}
            className="rounded-2xl border-l-4 p-3"
            style={{ borderColor: r.color, background: r.bg }}
          >
            <p className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: r.color }}>
              {r.label}
            </p>
            <ul className="space-y-1 text-sm">
              {r.items.map((it, k) => (
                <li key={k}>{it}</li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
