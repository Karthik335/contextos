// Turn approved actions into real things: .ics calendar files, Google Calendar links, email and WhatsApp drafts.
import type { CalendarAction, ChecklistAction, MessageAction } from "../../shared/types";

const compact = (date: string) => date.replace(/-/g, "");
const compactTime = (t: string) => t.replace(":", "") + "00";

function addHour(date: string, time: string) {
  const d = new Date(`${date}T${time}:00`);
  d.setHours(d.getHours() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

function nextDay(date: string) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Start/end in calendar format. Timed events are "floating" (the viewer's local time). */
function span(e: Pick<CalendarAction, "date" | "startTime" | "endTime">) {
  if (!e.startTime) return { allDay: true, start: compact(e.date), end: compact(nextDay(e.date)) };
  const end = e.endTime && e.endTime > e.startTime ? { date: e.date, time: e.endTime } : addHour(e.date, e.startTime);
  return { allDay: false, start: `${compact(e.date)}T${compactTime(e.startTime)}`, end: `${compact(end.date)}T${compactTime(end.time)}` };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** RFC 5545 lines are folded at 75 octets. */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function icsFor(events: CalendarAction[]) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ContextOS//Act on it//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  events.forEach((e, i) => {
    const s = span(e);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}@contextos`,
      `DTSTAMP:${stamp}`,
      s.allDay ? `DTSTART;VALUE=DATE:${s.start}` : `DTSTART:${s.start}`,
      s.allDay ? `DTEND;VALUE=DATE:${s.end}` : `DTEND:${s.end}`,
      `SUMMARY:${esc(e.title)}`,
      ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
      `DESCRIPTION:${esc([e.notes, "Added by ContextOS (Gemma 4)"].filter(Boolean).join("\n"))}`,
      // Reminder the day before.
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(e.title)}`,
      "TRIGGER:-P1D",
      "END:VALARM",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "event";

export function downloadIcs(events: CalendarAction[]) {
  const name = events.length === 1 ? `${slug(events[0].title)}.ics` : "contextos-dates.ics";
  download(name, icsFor(events), "text/calendar;charset=utf-8");
}

export function googleCalendarUrl(e: CalendarAction) {
  const s = span(e);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${s.start}/${s.end}`,
    details: [e.notes, "Added by ContextOS (Gemma 4)"].filter(Boolean).join("\n"),
  });
  if (e.location) q.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function mailtoUrl(m: Pick<MessageAction, "subject" | "body">) {
  const q = [m.subject && `subject=${encodeURIComponent(m.subject)}`, `body=${encodeURIComponent(m.body)}`].filter(Boolean).join("&");
  return `mailto:?${q}`;
}

export const whatsappUrl = (body: string) => `https://wa.me/?text=${encodeURIComponent(body)}`;

export function checklistText(c: ChecklistAction) {
  return [c.title, ...c.items.map((i) => `${i.done ? "☑" : "☐"} ${i.text}${i.due ? ` (by ${i.due})` : ""}`)].join("\n");
}
