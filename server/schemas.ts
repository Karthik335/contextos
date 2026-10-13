// Validation of model output. Lenient: coerce and drop bad items instead of failing everything.
import { z } from "zod";

const str = z.preprocess((v) => (v == null ? undefined : String(v)), z.string().optional());
const optDate = z.preprocess((v) => {
  if (typeof v !== "string") return undefined;
  const m = /\d{4}-\d{2}-\d{2}/.exec(v);
  return m ? m[0] : undefined;
}, z.string().optional());
const optTime = z.preprocess((v) => {
  if (typeof v !== "string") return undefined;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return undefined;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}, z.string().optional());

const FACT_TYPES = ["deadline", "event", "task", "requirement", "constraint", "status", "other"] as const;

export const ExtractedFact = z.object({
  text: z.string().min(1),
  type: z.preprocess((v) => (FACT_TYPES.includes(v as any) ? v : "other"), z.enum(FACT_TYPES)),
  date: optDate,
  startTime: optTime,
  endTime: optTime,
  quote: str,
  location: str,
  certainty: z.preprocess((v) => (v === "inferred" ? "inferred" : "stated"), z.enum(["stated", "inferred"])),
});

const lenientArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => item.safeParse(x).success) : []),
    z.array(item),
  );

export const Extraction = z.object({
  summary: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string()),
  facts: lenientArray(ExtractedFact),
});

const REL_TYPES = ["depends_on", "conflicts_with", "updates", "supports"] as const;
const labelList = z.preprocess((v) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []), z.array(z.string()));

export const AnalysisOut = z.object({
  title: z.preprocess((v) => (typeof v === "string" ? v : "Your situation"), z.string()),
  overview: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string()),
  relationships: lenientArray(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.enum(REL_TYPES),
      explanation: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string()),
    }),
  ),
  gaps: lenientArray(
    z.object({
      question: z.string(),
      why: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string()),
      factIds: labelList,
      resolveBy: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string()),
      impact: z.preprocess((v) => (["high", "medium", "low"].includes(v as string) ? v : "medium"), z.enum(["high", "medium", "low"])),
    }),
  ),
  actions: lenientArray(z.object({ text: z.string(), factIds: labelList })),
  followups: z.preprocess((v) => (Array.isArray(v) ? v.map(String).slice(0, 4) : []), z.array(z.string())),
});

/* "Act on it": tool calls chosen by Gemma. Each call is validated separately; bad ones are dropped. */
const s = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string().optional());
export const CalendarArgs = z.object({
  title: z.string().min(1),
  date: optDate.refine((v) => !!v, "date required"),
  startTime: optTime,
  endTime: optTime,
  location: s,
  notes: s,
  factIds: labelList,
});
export const MessageArgs = z.object({
  channel: z.preprocess((v) => (v === "whatsapp" ? "whatsapp" : "email"), z.enum(["email", "whatsapp"])),
  to: z.preprocess((v) => (typeof v === "string" && v.trim() ? v : "Recipient"), z.string()),
  subject: s,
  body: z.string().min(1),
  why: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string()),
  factIds: labelList,
});
export const ChecklistArgs = z.object({
  title: z.preprocess((v) => (typeof v === "string" && v ? v : "Checklist"), z.string()),
  items: lenientArray(z.object({ text: z.string().min(1), due: optDate, factIds: labelList.optional().default([]) })),
});
export const ToolCalls = z.object({ tool_calls: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.any())) });
