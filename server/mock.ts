// MOCK MODE (MOCK_AI=1): a crude, rule-based stand-in so the app can be tried without an API key.
// It is NOT AI and is clearly labelled in the UI. Never use it for the real demo.
import type { Content } from "@google/genai";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function findDate(line: string) {
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i.exec(line);
  if (!m) return undefined;
  return `2026-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
}

function to24(h: number, min: string, ampm?: string) {
  if (ampm?.toLowerCase() === "pm" && h < 12) h += 12;
  if (ampm?.toLowerCase() === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function findTimes(line: string) {
  const range = /(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*[–-]\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?/i.exec(line);
  if (range) return { start: to24(+range[1], range[2], range[3]), end: to24(+range[4], range[5], range[6]) };
  const single = /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i.exec(line) ?? /\b(\d{1,2})[:.](\d{2})\b/.exec(line);
  if (single) return { start: to24(+single[1], single[2] ?? "00", single[3]), end: undefined };
  return {};
}

function mockExtract(prompt: string) {
  const body = /<source name="[^"]*" kind="[^"]*">([\s\S]*?)<\/source>/.exec(prompt)?.[1] ?? "";
  const facts = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 8)
    .flatMap((line) => {
      const loc = /^\[([^\]]+)\]\s*/.exec(line);
      const text = line.replace(/^\[[^\]]+\]\s*/, "");
      return text
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .filter((t) => t.length > 8)
        .map((t) => {
          const date = findDate(t);
          const times = findTimes(t);
          const lower = t.toLowerCase();
          const type = /due|deadline|submit/.test(lower)
            ? "deadline"
            : /not |haven't|pending|todo/.test(lower)
              ? "status"
              : /must|required|bring/.test(lower)
                ? "requirement"
                : date
                  ? "event"
                  : "other";
          return {
            text: t,
            type,
            date,
            startTime: times.start,
            endTime: times.end,
            quote: t.slice(0, 80),
            location: loc?.[1] ?? "text",
            certainty: "stated",
          };
        });
    })
    .slice(0, 30);
  return JSON.stringify({ summary: `(mock) ${facts[0]?.text.slice(0, 80) ?? "source"}`, facts });
}

function mockAnalyze(prompt: string) {
  const facts = [...prompt.matchAll(/^(F\d+) \[([^\]]*)\] (.*)$/gm)].map((m) => ({ id: m[1], meta: m[2], text: m[3] }));
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const relationships: any[] = [];
  for (const f of facts.filter((f) => /moved|revised|rescheduled|postponed|shifted/i.test(f.text))) {
    const w = words(f.text);
    const target = facts.find((g) => g !== f && !/revised|moved/i.test(g.text) && [...words(g.text)].filter((x) => w.has(x)).length >= 2);
    if (target) relationships.push({ from: f.id, to: target.id, type: "updates", explanation: "(mock) newer notice replaces older one" });
  }
  const gaps = facts
    .filter((f) => /not |haven't|pending/i.test(f.text))
    .map((f) => ({
      question: `Is this still pending: "${f.text.slice(0, 60)}"?`,
      why: "(mock) your notes say this is not done yet",
      factIds: [f.id],
      resolveBy: "Finish it or confirm the requirement",
      impact: "high",
    }));
  const actions = facts
    .filter((f) => /deadline|requirement/.test(f.meta))
    .slice(0, 4)
    .map((f) => ({ text: `(mock) Plan for: ${f.text.slice(0, 70)}`, factIds: [f.id] }));
  return JSON.stringify({
    title: "Mock analysis",
    overview: `MOCK MODE: rule-based stand-in, not Gemma. Found ${facts.length} facts. Set GEMINI_API_KEY and MOCK_AI=0 for real analysis.`,
    relationships,
    gaps,
    actions,
    followups: ["What should I do first?", "Which deadlines are closest?", "What am I missing?"],
  });
}

export async function text(prompt: string) {
  await new Promise((r) => setTimeout(r, 300));
  if (prompt.includes("You extract facts")) return mockExtract(prompt);
  if (prompt.includes("situation analyst")) return mockAnalyze(prompt);
  if (prompt.includes("turns a situation into concrete actions")) return mockActions(prompt);
  return "{}";
}

export async function vision(n: number) {
  await new Promise((r) => setTimeout(r, 400));
  return `(mock) ${n} image(s) received. Image reading needs Gemma 4: set GEMINI_API_KEY and MOCK_AI=0.`;
}

export async function audio() {
  await new Promise((r) => setTimeout(r, 300));
  return "(mock transcript) audio transcription needs Gemma 4 or Whisper.";
}

export async function* streamChat(contents: Content[]) {
  const last = contents[contents.length - 1]?.parts?.map((p) => p.text).join(" ") ?? "";
  const reply = `**Mock mode** — this is a rule-based stand-in, not Gemma. You asked: "${last.slice(0, 120)}". With a real API key, Gemma 4 answers here from your sources, citing facts like [F1].\n\nFOLLOWUPS: What should I do first? | What am I missing? | Explain the conflicts`;
  for (const word of reply.split(/(?<= )/)) {
    await new Promise((r) => setTimeout(r, 15));
    yield word;
  }
}

function mockActions(prompt: string) {
  const today = new Date().toISOString().slice(0, 10);
  const facts = [...prompt.matchAll(/^(F\d+) \[(\w+)(?:, (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2})(?:–(\d{2}:\d{2}))?)?)?\] (.+)$/gm)].map((m) => ({
    label: m[1], type: m[2], date: m[3], start: m[4], end: m[5], text: m[6].replace(/ \(at [^)]*\)$/, ""),
  }));
  const calls: any[] = facts
    .filter((f) => f.date && f.date >= today)
    .slice(0, 4)
    .map((f) => ({
      name: "create_calendar_event",
      arguments: { title: f.text.slice(0, 60), date: f.date, startTime: f.start, endTime: f.end, factIds: [f.label] },
    }));
  if (/Conflicts:/.test(prompt))
    calls.push({
      name: "draft_message",
      arguments: { channel: "email", to: "Organiser", subject: "Clarifying a schedule clash", body: "Hello, two of my notices give different times for the same day. Could you confirm which one is correct? Thank you.", why: "Resolves the conflict in the briefing (mock).", factIds: [] },
    });
  calls.push({
    name: "create_checklist",
    arguments: { title: "Next steps (mock)", items: facts.slice(0, 4).map((f) => ({ text: f.text.slice(0, 80), due: f.date, factIds: [f.label] })) },
  });
  return JSON.stringify({ tool_calls: calls });
}
