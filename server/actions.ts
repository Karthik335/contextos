// "Act on it": Gemma 4 picks tools (function calling) to turn the briefing into actions.
// Nothing runs automatically: the app shows each proposed call and the user approves it.
import * as ai from "./ai.js";
import { suggestActions } from "./prompts.js";
import { CalendarArgs, ChecklistArgs, MessageArgs, ToolCalls } from "./schemas.js";
import { briefingText } from "./analysis.js";
import { labelFacts } from "../shared/labels.js";
import type { ActionPlan, Analysis, ProposedAction, SourcePayload } from "../shared/types.js";

export async function planActions(sources: SourcePayload[], analysis: Analysis | undefined, instructions?: string, language?: string): Promise<ActionPlan> {
  const { toLabel, toId } = labelFacts(sources);
  const ids = (labels: string[] = []) => labels.map((l) => toId.get(String(l).trim().replace(/[\[\]]/g, ""))).filter((x): x is string => !!x);
  const facts = new Map(sources.flatMap((s) => s.facts).map((f) => [f.id, f]));
  const superseded = new Set(analysis?.superseded ?? []);

  const out = await ai.json(
    suggestActions(sources, toLabel, briefingText(analysis, toLabel), instructions, language),
    (v) => ToolCalls.parse(v),
    language && language !== "English" ? 3072 : 2048,
    "deep",
  );

  const today = new Date().toISOString().slice(0, 10);
  const actions: ProposedAction[] = [];
  const seenEvents = new Set<string>();
  for (const call of out.tool_calls) {
    // Accept the common variants: {name, arguments}, {name, parameters}, {function: {name, arguments}}.
    const fn = call?.function ?? call;
    const name = String(fn?.name ?? "");
    let args = fn?.arguments ?? fn?.parameters ?? fn?.args ?? {};
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { continue; }
    }
    if (name === "create_calendar_event") {
      const r = CalendarArgs.safeParse(args);
      if (!r.success || !r.data.date || r.data.date < today) continue;
      const factIds = ids(r.data.factIds);
      if (factIds.length && factIds.every((id) => superseded.has(id))) continue; // outdated
      // Ground the date: if a cited fact has a date, the event must match it (no invented dates).
      const dated = factIds.map((id) => facts.get(id)).filter((f) => f?.date);
      if (dated.length && !dated.some((f) => f!.date === r.data.date)) continue;
      const key = `${r.data.date}|${r.data.startTime ?? ""}|${r.data.title.toLowerCase()}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      actions.push({ tool: "create_calendar_event", ...r.data, date: r.data.date, factIds });
    } else if (name === "draft_message") {
      const r = MessageArgs.safeParse(args);
      if (r.success) actions.push({ tool: "draft_message", ...r.data, factIds: ids(r.data.factIds) });
    } else if (name === "create_checklist") {
      const r = ChecklistArgs.safeParse(args);
      if (r.success && r.data.items.length)
        actions.push({ tool: "create_checklist", title: r.data.title, items: r.data.items.map((i) => ({ text: i.text, due: i.due, factIds: ids(i.factIds) })) });
    }
  }
  const order = { create_calendar_event: 0, draft_message: 1, create_checklist: 2 } as const;
  actions.sort((a, b) => order[a.tool] - order[b.tool]);
  return { actions: capEach(actions), createdAt: Date.now() };
}

function capEach(actions: ProposedAction[]) {
  const limit = { create_calendar_event: 5, draft_message: 2, create_checklist: 1 } as const;
  const n = { create_calendar_event: 0, draft_message: 0, create_checklist: 0 };
  return actions.filter((a) => ++n[a.tool] <= limit[a.tool]);
}
