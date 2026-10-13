// Deterministic logic that does not need an AI model.
import type { Analysis, Changes, Conflict, Fact, Gap } from "./types";

const toMinutes = (t?: string) => {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * Two facts conflict in time when they fall on the same date and their time
 * ranges overlap. A fact with only a start time is treated as a 60-minute slot.
 */
export function findTimeConflicts(facts: Fact[], superseded: Set<string>): Conflict[] {
  const timed = facts
    .filter((f) => f.date && toMinutes(f.startTime) !== null && !superseded.has(f.id))
    .map((f) => {
      const s = toMinutes(f.startTime)!;
      const e = toMinutes(f.endTime) ?? s + 60;
      return { f, s, e: e > s ? e : s + 60 };
    });

  const out: Conflict[] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const A = timed[i];
      const B = timed[j];
      if (A.f.date !== B.f.date) continue;
      // The same event reported by two sources (same date, same times, similar wording) is not a clash.
      if (A.s === B.s && A.e === B.e && similar(A.f.text, B.f.text)) continue;
      if (A.s < B.e && B.s < A.e) {
        out.push({
          a: A.f.id,
          b: B.f.id,
          verifiedByCode: true,
          explanation: `Both are on ${formatDate(A.f.date!)}: ${A.f.startTime}–${minutesToTime(A.e)} and ${B.f.startTime}–${minutesToTime(B.e)} overlap.`,
        });
      }
    }
  }
  return out;
}

const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{3,}/g) ?? []);
function similar(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size) >= 0.6;
}

const minutesToTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

const pairKey = (c: Conflict) => [c.a, c.b].sort().join("|");
const gapKey = (g: Gap) => g.question.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60);

/** Compare two analyses and describe what changed. Pure code, no AI. */
export function diffAnalyses(
  prev: Analysis | undefined,
  next: Analysis,
  prevFactIds: string[],
  nextFactIds: string[],
): Changes {
  const before = new Set(prevFactIds);
  const newFacts = nextFactIds.filter((id) => !before.has(id));
  const prevC = new Map((prev?.conflicts ?? []).map((c) => [pairKey(c), c]));
  const nextC = new Map(next.conflicts.map((c) => [pairKey(c), c]));
  const resolvedConflicts = [...prevC].filter(([k]) => !nextC.has(k)).map(([, c]) => c);
  const newConflicts = [...nextC].filter(([k]) => !prevC.has(k)).map(([, c]) => c);
  const prevG = new Set((prev?.gaps ?? []).map(gapKey));
  const nextG = new Set(next.gaps.map(gapKey));
  const newGaps = next.gaps.filter((g) => !prevG.has(gapKey(g)));
  const resolvedGaps = (prev?.gaps ?? []).filter((g) => !nextG.has(gapKey(g)));

  const parts: string[] = [];
  if (newFacts.length) parts.push(`${newFacts.length} new fact${newFacts.length > 1 ? "s" : ""}`);
  if (resolvedConflicts.length) parts.push(`${resolvedConflicts.length} conflict${resolvedConflicts.length > 1 ? "s" : ""} resolved`);
  if (newConflicts.length) parts.push(`${newConflicts.length} new conflict${newConflicts.length > 1 ? "s" : ""}`);
  if (newGaps.length) parts.push(`${newGaps.length} new gap${newGaps.length > 1 ? "s" : ""}`);
  if (resolvedGaps.length) parts.push(`${resolvedGaps.length} gap${resolvedGaps.length > 1 ? "s" : ""} closed`);

  return {
    newFacts,
    resolvedConflicts,
    newConflicts,
    newGaps,
    resolvedGaps,
    summary: parts.length ? parts.join(" · ") : "Nothing important changed.",
  };
}
