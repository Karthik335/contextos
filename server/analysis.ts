// Build the situation model: Gemma 4 connects facts across sources;
// plain code verifies time conflicts and sorts dates.
import type { Content } from "@google/genai";
import * as ai from "./ai.js";
import { analyze as analyzePrompt, chatContext } from "./prompts.js";
import { AnalysisOut } from "./schemas.js";
import { findTimeConflicts, formatDate } from "../shared/conflicts.js";
import { labelFacts } from "../shared/labels.js";
import type { Analysis, ChatTurn, Conflict, Fact, SourcePayload } from "../shared/types.js";

export async function runAnalysis(sources: SourcePayload[], instructions?: string, language?: string): Promise<Analysis> {
  const allFacts: Fact[] = sources.flatMap((s) => s.facts);
  const { toLabel, toId } = labelFacts(sources);
  const mapIds = (labels: string[]) =>
    labels.map((l) => toId.get(l.trim().replace(/[\[\]]/g, ""))).filter((x): x is string => !!x);

  let out = {
    title: "Your situation",
    overview: "",
    relationships: [] as any[],
    gaps: [] as any[],
    actions: [] as any[],
    followups: [] as string[],
  };
  if (allFacts.length) {
    out = await ai.json(analyzePrompt(sources, toLabel, instructions, language), (v) => AnalysisOut.parse(v), language && language !== "English" ? 4096 : 3072, "deep");
  }

  const relationships = out.relationships
    .map((r) => ({ ...r, from: toId.get(r.from.trim()) ?? "", to: toId.get(r.to.trim()) ?? "" }))
    .filter((r) => r.from && r.to && r.from !== r.to);

  // Newer information replaces older information.
  const superseded = new Set(relationships.filter((r) => r.type === "updates").map((r) => r.to));

  // Conflicts: verified ones from code, plus the model's, minus anything superseded.
  const codeConflicts = findTimeConflicts(allFacts, superseded);
  const seen = new Set(codeConflicts.map((c) => [c.a, c.b].sort().join("|")));
  const modelConflicts: Conflict[] = relationships
    .filter((r) => r.type === "conflicts_with" && !superseded.has(r.from) && !superseded.has(r.to))
    .filter((r) => !seen.has([r.from, r.to].sort().join("|")))
    .map((r) => ({ a: r.from, b: r.to, explanation: r.explanation, verifiedByCode: false }));
  const conflicts = [...codeConflicts, ...modelConflicts];

  // Add code-found conflicts to the graph too.
  for (const c of codeConflicts)
    if (!relationships.some((r) => r.type === "conflicts_with" && [r.from, r.to].sort().join("|") === [c.a, c.b].sort().join("|")))
      relationships.push({ from: c.a, to: c.b, type: "conflicts_with", explanation: c.explanation });

  const keyDates = allFacts
    .filter((f) => f.date && !superseded.has(f.id) && ["deadline", "event", "task", "requirement"].includes(f.type))
    .sort((a, b) => (a.date! + (a.startTime ?? "")).localeCompare(b.date! + (b.startTime ?? "")))
    .map((f) => ({ factId: f.id, date: f.date!, label: f.text }));

  return {
    title: out.title,
    overview: out.overview,
    relationships: relationships.filter((r) => !(r.type === "conflicts_with" && (superseded.has(r.from) || superseded.has(r.to)))),
    conflicts,
    gaps: out.gaps.map((g) => ({ ...g, factIds: mapIds(g.factIds) })),
    actions: out.actions.map((a) => ({ ...a, factIds: mapIds(a.factIds) })),
    keyDates,
    superseded: [...superseded],
    followups: out.followups,
    createdAt: Date.now(),
  };
}

/** Plain-text version of the briefing, for the chat prompt. */
export function briefingText(a: Analysis | undefined, labels: Map<string, string>) {
  if (!a) return "";
  const L = (id: string) => labels.get(id) ?? id;
  return [
    `Title: ${a.title}`,
    `Overview: ${a.overview}`,
    a.conflicts.length && `Conflicts:\n${a.conflicts.map((c) => `- ${L(c.a)} vs ${L(c.b)}: ${c.explanation}${c.verifiedByCode ? " (verified by code)" : ""}`).join("\n")}`,
    a.gaps.length && `Missing information:\n${a.gaps.map((g) => `- ${g.question} (${g.impact}): ${g.why}`).join("\n")}`,
    a.keyDates.length && `Key dates:\n${a.keyDates.map((d) => `- ${formatDate(d.date)}: ${d.label}`).join("\n")}`,
    a.actions.length && `Suggested actions:\n${a.actions.map((x, i) => `${i + 1}. ${x.text}`).join("\n")}`,
    a.superseded.length && `Superseded (outdated) facts: ${a.superseded.map(L).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Build the multi-turn conversation for Gemma: context first, then the whole history. */
export function buildChat(
  sources: SourcePayload[],
  analysis: Analysis | undefined,
  history: ChatTurn[],
  instructions?: string,
  language?: string,
  budgetOverride?: number,
): { contents: Content[]; toId: Map<string, string> } {
  const { toLabel, toId } = labelFacts(sources);
  const turnsAll = history.filter((t) => t.text.trim());
  const question = [...turnsAll].reverse().find((t) => t.role === "user")?.text ?? "";
  const ctx = chatContext(sources, toLabel, briefingText(analysis, toLabel), instructions, budgetOverride ?? (ai.privateMode.getStore() ? 5_000 : Number(process.env.CHAT_CONTEXT_CHARS) || 12_000), question, language);

  const turns = history.filter((t) => t.text.trim());
  const contents: Content[] = [
    { role: "user", parts: [{ text: ctx + "\n\nReply with just: Ready." }] },
    { role: "model", parts: [{ text: "Ready." }] },
  ];
  // Keep the last 12 turns (long answers shortened); roles must alternate.
  for (const t of turns.slice(ai.privateMode.getStore() ? -6 : -12)) {
    const role = t.role === "user" ? "user" : "model";
    const text = role === "model" && t.text.length > 1200 ? t.text.slice(0, 1200) + " […]" : t.text;
    const last = contents[contents.length - 1];
    if (last.role === role) last.parts!.push({ text: "\n\n" + text });
    else contents.push({ role, parts: [{ text }] });
  }
  if (contents[contents.length - 1].role !== "user")
    contents.push({ role: "user", parts: [{ text: "Continue." }] });
  return { contents, toId };
}
