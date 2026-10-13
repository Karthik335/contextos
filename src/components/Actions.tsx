// "Act on it": the tool calls Gemma 4 chose. Nothing happens until the user approves each one.
import { useState } from "react";
import { motion } from "motion/react";
import { CalendarPlus, Check, CheckSquare, Code2, Copy, ExternalLink, Mail, MessageCircle, Square, X } from "lucide-react";
import { Citations } from "./Citation";
import { useStore } from "../lib/store";
import { checklistText, downloadIcs, googleCalendarUrl, mailtoUrl, whatsappUrl } from "../lib/actions";
import { formatDate } from "../../shared/conflicts";
import type { ActionPlan, CalendarAction, ChecklistAction, MessageAction, ProposedAction } from "../../shared/types";

type Patch = (i: number, p: Partial<ProposedAction>) => void;

export default function ActionsCard({ plan, chatId, msgId }: { plan: ActionPlan; chatId: string; msgId: string }) {
  const patchMessage = useStore((s) => s.patchMessage);
  const patch: Patch = (i, p) =>
    patchMessage(chatId, msgId, (m) => ({
      actions: { ...m.actions!, actions: m.actions!.actions.map((a, k) => (k === i ? ({ ...a, ...p } as ProposedAction) : a)) },
    }));

  const events = plan.actions.map((a, i) => ({ a, i })).filter((x): x is { a: CalendarAction & ProposedAction; i: number } => x.a.tool === "create_calendar_event");
  const pendingEvents = events.filter((x) => !x.a.status);

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Gemma 4 chose {plan.actions.length} tool call{plan.actions.length === 1 ? "" : "s"} from your sources. Nothing happens until you approve.
      </p>
      {pendingEvents.length > 1 && (
        <button
          onClick={() => {
            downloadIcs(pendingEvents.map((x) => x.a));
            pendingEvents.forEach((x) => patch(x.i, { status: "approved" }));
          }}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <CalendarPlus size={15} /> Approve all {pendingEvents.length} dates (.ics)
        </button>
      )}
      {plan.actions.map((a, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: a.status === "dismissed" ? 0.45 : 1, y: 0 }} transition={{ delay: i * 0.06 }}>
          {a.tool === "create_calendar_event" && <EventItem a={a} i={i} patch={patch} />}
          {a.tool === "draft_message" && <MessageItem a={a} i={i} patch={patch} />}
          {a.tool === "create_checklist" && <ChecklistItem a={a} i={i} patch={patch} />}
        </motion.div>
      ))}
    </div>
  );
}

function Shell({
  a,
  icon: Icon,
  color,
  label,
  children,
  i,
  patch,
}: {
  a: ProposedAction;
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  label: string;
  children: React.ReactNode;
  i: number;
  patch: Patch;
}) {
  const [showCall, setShowCall] = useState(false);
  const { status, ...call } = a;
  const { tool, ...args } = call;
  return (
    <div className="rounded-2xl border border-edge bg-surface/70 p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full text-white" style={{ background: color }}>
          <Icon size={13} />
        </span>
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>
          {label}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {status === "approved" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-resolved-soft px-2 py-0.5 text-[10px] font-bold uppercase text-resolved">
              <Check size={11} /> Approved
            </span>
          )}
          {status === "dismissed" ? (
            <button onClick={() => patch(i, { status: undefined })} className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-ink-soft hover:text-ink">
              Undo
            </button>
          ) : (
            !status && (
              <button onClick={() => patch(i, { status: "dismissed" })} title="Dismiss" className="grid size-6 place-items-center rounded-full text-ink-soft hover:bg-ink/5 hover:text-ink">
                <X size={14} />
              </button>
            )
          )}
          <button onClick={() => setShowCall(!showCall)} title="Show the function call Gemma made" className={`grid size-6 place-items-center rounded-full hover:bg-ink/5 ${showCall ? "text-accent" : "text-ink-soft"}`}>
            <Code2 size={14} />
          </button>
        </span>
      </div>
      {showCall && (
        <pre className="mb-2 max-h-56 overflow-auto rounded-xl bg-ink/[0.06] p-2.5 font-mono text-[11px] leading-relaxed text-ink/80">
          {`${tool}(${JSON.stringify(args, null, 2)})`}
        </pre>
      )}
      {status !== "dismissed" && children}
    </div>
  );
}

const Btn = ({ onClick, href, icon: Icon, children, primary }: { onClick?: () => void; href?: string; icon: React.ComponentType<{ size?: number }>; children: React.ReactNode; primary?: boolean }) => {
  const cls = `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition hover:-translate-y-0.5 ${
    primary ? "bg-accent text-white shadow-sm hover:shadow-md" : "border border-edge-strong bg-surface text-ink hover:text-accent"
  }`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={cls}>
      <Icon size={14} /> {children}
    </a>
  ) : (
    <button onClick={onClick} className={cls}>
      <Icon size={14} /> {children}
    </button>
  );
};

function useCopy() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: (t: string) => {
      navigator.clipboard?.writeText(t).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
  };
}

function EventItem({ a, i, patch }: { a: CalendarAction & ProposedAction; i: number; patch: Patch }) {
  const time = a.startTime ? `${a.startTime}${a.endTime ? "–" + a.endTime : ""}` : "All day";
  return (
    <Shell a={a} i={i} patch={patch} icon={CalendarPlus} color="var(--color-accent-2)" label="Add to calendar">
      <p className="text-sm font-semibold">{a.title}</p>
      <p className="mt-0.5 text-[13px] text-ink-soft">
        {formatDate(a.date)} · {time}
        {a.location ? ` · ${a.location}` : ""}
      </p>
      {a.notes && <p className="mt-1 text-[13px] text-ink/75">{a.notes}</p>}
      <div className="mt-1.5">
        <Citations ids={a.factIds} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Btn
          primary={!a.status}
          icon={a.status ? Check : CalendarPlus}
          onClick={() => {
            downloadIcs([a]);
            patch(i, { status: "approved" });
          }}
        >
          {a.status ? "Download .ics again" : "Approve & add (.ics)"}
        </Btn>
        <Btn icon={ExternalLink} href={googleCalendarUrl(a)} onClick={() => patch(i, { status: "approved" })}>
          Google Calendar
        </Btn>
      </div>
    </Shell>
  );
}

function MessageItem({ a, i, patch }: { a: MessageAction & ProposedAction; i: number; patch: Patch }) {
  const { copied, copy } = useCopy();
  const approve = () => patch(i, { status: "approved" });
  return (
    <Shell a={a} i={i} patch={patch} icon={a.channel === "whatsapp" ? MessageCircle : Mail} color="var(--color-gap)" label={`Draft ${a.channel === "whatsapp" ? "WhatsApp" : "email"} · to ${a.to}`}>
      {a.why && <p className="mb-2 text-[13px] text-ink-soft">{a.why}</p>}
      {a.subject !== undefined && a.channel === "email" && (
        <input
          value={a.subject ?? ""}
          onChange={(e) => patch(i, { subject: e.target.value } as Partial<MessageAction>)}
          className="mb-2 w-full rounded-xl border border-edge bg-surface px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
          aria-label="Subject"
        />
      )}
      <textarea
        value={a.body}
        onChange={(e) => patch(i, { body: e.target.value } as Partial<MessageAction>)}
        rows={Math.min(8, Math.max(3, Math.ceil(a.body.length / 70)))}
        className="w-full resize-y rounded-xl border border-edge bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent"
        aria-label="Message"
      />
      <div className="mt-1.5">
        <Citations ids={a.factIds} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Btn primary={!a.status} icon={copied ? Check : Copy} onClick={() => (copy(a.subject && a.channel === "email" ? `Subject: ${a.subject}\n\n${a.body}` : a.body), approve())}>
          {copied ? "Copied" : "Approve & copy"}
        </Btn>
        <Btn icon={Mail} href={mailtoUrl(a)} onClick={approve}>
          Email
        </Btn>
        <Btn icon={MessageCircle} href={whatsappUrl(a.body)} onClick={approve}>
          WhatsApp
        </Btn>
      </div>
    </Shell>
  );
}

function ChecklistItem({ a, i, patch }: { a: ChecklistAction & ProposedAction; i: number; patch: Patch }) {
  const { copied, copy } = useCopy();
  const approved = a.status === "approved";
  const toggle = (k: number) => patch(i, { items: a.items.map((it, j) => (j === k ? { ...it, done: !it.done } : it)) } as Partial<ChecklistAction>);
  const done = a.items.filter((x) => x.done).length;
  return (
    <Shell a={a} i={i} patch={patch} icon={CheckSquare} color="var(--color-resolved)" label={`Checklist${approved ? ` · ${done}/${a.items.length} done` : ""}`}>
      <p className="mb-1.5 text-sm font-semibold">{a.title}</p>
      <ul className="space-y-1">
        {a.items.map((it, k) => (
          <li key={k} className={`flex items-start gap-2 rounded-xl px-1.5 py-1 text-sm ${approved ? "hover:bg-ink/5" : ""}`}>
            <button disabled={!approved} onClick={() => toggle(k)} aria-label={it.done ? "Mark not done" : "Mark done"} className={`mt-0.5 shrink-0 ${approved ? "" : "cursor-default"}`}>
              {it.done ? <CheckSquare size={16} className="text-resolved" /> : <Square size={16} className="text-ink-soft" />}
            </button>
            <span>
              <span onClick={() => approved && toggle(k)} className={`${approved ? "cursor-pointer" : ""} ${it.done ? "text-ink-soft line-through" : ""}`}>
                {it.text}
              </span>
              {it.due && <span className="ml-1.5 text-[12px] font-semibold text-gap">by {formatDate(it.due)}</span>} <Citations ids={it.factIds} />
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {!approved && (
          <Btn primary icon={Check} onClick={() => patch(i, { status: "approved" })}>
            Approve checklist
          </Btn>
        )}
        <Btn icon={copied ? Check : Copy} onClick={() => copy(checklistText(a))}>
          {copied ? "Copied" : "Copy"}
        </Btn>
      </div>
    </Shell>
  );
}
