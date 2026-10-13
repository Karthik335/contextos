#!/usr/bin/env node
// ContextOS skill CLI. Dependency-free (Node 20+). Talks to a running ContextOS server.
//
//   node contextos.mjs status
//   node contextos.mjs brief <file...> [--lang Hindi] [--private] [--instructions "..."] [--json]
//   node contextos.mjs ask "<question>" [--json]
//   node contextos.mjs actions [--ics out.ics] [--json]
//
// The session (sources, facts, briefing, chat history) is saved to .contextos-session.json
// in the current folder (override with CONTEXTOS_SESSION), so `ask` and `actions` reuse it.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.CONTEXTOS_URL || "http://localhost:3000").replace(/\/$/, "");
const SESSION = process.env.CONTEXTOS_SESSION || path.resolve(".contextos-session.json");

const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv",
  txt: "text/plain", md: "text/markdown", html: "text/html", htm: "text/html", json: "application/json",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac", opus: "audio/opus",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo",
};

/* ---------- small helpers ---------- */

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (["private", "json"].includes(key)) out.flags[key] = true;
      else {
        out.flags[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const log = (...m) => console.error(...m); // progress → stderr, results → stdout

function die(msg, code = 1) {
  console.error(`Error: ${msg}`);
  process.exit(code);
}

async function call(url, init) {
  let r;
  try {
    r = await fetch(BASE + url, init);
  } catch {
    die(`Can't reach ContextOS at ${BASE}. Start it with \`npm run dev\` in the contextos folder, or set CONTEXTOS_URL.`, 2);
  }
  if (!r.ok) {
    let msg = r.statusText;
    try {
      msg = (await r.json()).error ?? msg;
    } catch {}
    die(`${url} failed (${r.status}): ${msg}`);
  }
  return r;
}

const postJson = (url, body) => call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function loadSession() {
  if (!existsSync(SESSION)) die(`No session found at ${SESSION}. Run \`brief <files…>\` first.`);
  return JSON.parse(await readFile(SESSION, "utf8"));
}
const saveSession = (s) => writeFile(SESSION, JSON.stringify(s, null, 2));

/** F1, F2… in the same order the server uses. */
function labels(sources) {
  const toLabel = new Map();
  let n = 1;
  for (const s of sources) for (const f of s.facts) toLabel.set(f.id, `F${n++}`);
  return toLabel;
}

const payload = (sources, withText) => sources.map(({ text, ...s }) => (withText ? { ...s, text } : s));

/* ---------- commands ---------- */

async function status() {
  const s = await (await call("/api/status")).json();
  console.log(JSON.stringify(s, null, 2));
}

async function processFile(file, idx, isPrivate) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const name = path.basename(file);
  const sourceId = `s${Date.now().toString(36)}${idx}`;
  const fd = new FormData();
  fd.append("sourceId", sourceId);
  fd.append("private", isPrivate ? "1" : "0");
  fd.append("file", new Blob([await readFile(file)], { type: MIME[ext] || "application/octet-stream" }), name);
  const { jobId } = await (await call("/api/sources", { method: "POST", body: fd })).json();
  let last = "";
  for (;;) {
    const job = await (await call(`/api/jobs/${jobId}`)).json();
    const line = `  ${name}: ${job.step}`;
    if (line !== last) log((last = line));
    if (job.status === "error") {
      log(`  ${name}: FAILED: ${job.error}`);
      return null;
    }
    if (job.status === "done") {
      const r = job.result;
      return {
        id: sourceId,
        name,
        kind: kindOf(ext),
        summary: r.summary,
        facts: r.facts,
        text: (r.segments || []).map((g) => `[${g.location}] ${g.text}`).join("\n"),
        models: r.models,
      };
    }
    await new Promise((res) => setTimeout(res, 1200));
  }
}

function kindOf(ext) {
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["docx", "pptx"].includes(ext)) return "doc";
  if (["xlsx", "xls", "csv"].includes(ext)) return "sheet";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"].includes(ext)) return "audio";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
  return "text";
}

function briefingMarkdown(session) {
  const { sources, analysis: a } = session;
  const L = labels(sources);
  const fact = new Map(sources.flatMap((s) => s.facts.map((f) => [f.id, { f, s }])));
  const cite = (ids = []) => ids.map((id) => `[${L.get(id) ?? "?"}]`).join("");
  const out = [`# ${a.title}`, "", a.overview, ""];
  if (a.conflicts?.length) {
    out.push("## Conflicts");
    for (const c of a.conflicts)
      out.push(`- ${fact.get(c.a)?.f.text ?? c.a} **vs** ${fact.get(c.b)?.f.text ?? c.b}: ${c.explanation}${c.verifiedByCode ? " _(verified by code)_" : ""} ${cite([c.a, c.b])}`);
    out.push("");
  }
  if (a.gaps?.length) {
    out.push("## Missing information");
    for (const g of a.gaps) out.push(`- (${g.impact}) ${g.question}: ${g.why}${g.resolveBy ? ` → ${g.resolveBy}` : ""} ${cite(g.factIds)}`);
    out.push("");
  }
  if (a.keyDates?.length) {
    out.push("## Key dates");
    for (const d of a.keyDates) out.push(`- ${d.date}${fact.get(d.factId)?.f.startTime ? " " + fact.get(d.factId).f.startTime : ""}: ${d.label} ${cite([d.factId])}`);
    out.push("");
  }
  if (a.actions?.length) {
    out.push("## What to do next");
    a.actions.forEach((x, i) => out.push(`${i + 1}. ${x.text} ${cite(x.factIds)}`));
    out.push("");
  }
  out.push("## Facts (citations)");
  for (const s of sources) {
    out.push(`### ${s.name} (${s.kind})`);
    for (const f of s.facts) out.push(`- ${L.get(f.id)}: ${f.text}${f.location ? ` _(at ${f.location})_` : ""}${a.superseded?.includes(f.id) ? " ~~outdated~~" : ""}`);
  }
  if (a.models?.length) out.push("", `_Analysed by: ${[...new Set(a.models)].join(", ")}_`);
  return out.join("\n");
}

async function brief(files, flags) {
  if (!files.length) die("Give at least one file: brief notice.jpg plan.pdf …");
  for (const f of files) if (!existsSync(f)) die(`File not found: ${f}`);
  const isPrivate = !!flags.private;
  log(`Reading ${files.length} file(s) with Gemma 4${isPrivate ? " on this computer (private mode)" : ""}…`);
  const sources = [];
  // Private mode runs one file at a time (one local GPU); online, two in parallel.
  const workers = isPrivate ? 1 : 2;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, files.length) }, async () => {
      while (next < files.length) {
        const i = next++;
        const r = await processFile(files[i], i, isPrivate);
        if (r) sources[i] = r;
      }
    }),
  );
  const ok = sources.filter(Boolean);
  if (!ok.length) die("No file could be read.");
  log("Connecting facts across sources…");
  const analysis = await (await postJson("/api/analyze", { sources: payload(ok, false), instructions: flags.instructions, language: flags.lang, private: isPrivate })).json();
  const session = { createdAt: new Date().toISOString(), language: flags.lang, private: isPrivate, instructions: flags.instructions, sources: ok, analysis, history: [] };
  await saveSession(session);
  log(`Session saved to ${SESSION}`);
  console.log(flags.json ? JSON.stringify({ analysis, sources: payload(ok, false) }, null, 2) : briefingMarkdown(session));
}

async function ask(question, flags) {
  if (!question) die('Give a question: ask "Which exam clashes with the lab?"');
  const s = await loadSession();
  const history = [...(s.history || []), { role: "user", text: question }];
  const r = await postJson("/api/chat", {
    sources: payload(s.sources, true),
    analysis: s.analysis,
    history,
    instructions: s.instructions,
    language: flags.lang ?? s.language,
    private: s.private,
  });
  const model = r.headers.get("X-Model");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = dec.decode(value, { stream: true });
    raw += piece;
    if (!flags.json) process.stdout.write(piece);
  }
  const m = /\n?\s*\**FOLLOWUPS:?\**:?\s*(.+)\s*$/i.exec(raw);
  const answer = m ? raw.slice(0, m.index).trim() : raw.trim();
  const followups = m ? m[1].split("|").map((x) => x.trim()).filter(Boolean) : [];
  s.history = [...history, { role: "assistant", text: answer }].slice(-24);
  await saveSession(s);
  if (flags.json) console.log(JSON.stringify({ answer, followups, model }, null, 2));
  else process.stdout.write("\n" + (model ? `\n_(answered by ${model})_\n` : ""));
}

function icsFor(events) {
  const c = (d) => d.replace(/-/g, "");
  const t = (x) => x.replace(":", "") + "00";
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ContextOS//skill//EN"];
  events.forEach((e, i) => {
    let start, end;
    if (e.startTime) {
      const d = new Date(`${e.date}T${e.startTime}:00`);
      const endT = e.endTime && e.endTime > e.startTime ? e.endTime : `${String(d.getHours() + 1).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      start = `DTSTART:${c(e.date)}T${t(e.startTime)}`;
      end = `DTEND:${c(e.date)}T${t(endT > "23:59" ? "23:59" : endT)}`;
    } else {
      const n = new Date(`${e.date}T12:00:00`);
      n.setDate(n.getDate() + 1);
      start = `DTSTART;VALUE=DATE:${c(e.date)}`;
      end = `DTEND;VALUE=DATE:${c(n.toISOString().slice(0, 10))}`;
    }
    lines.push("BEGIN:VEVENT", `UID:${stamp}-${i}@contextos`, `DTSTAMP:${stamp}`, start, end, `SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

async function actions(flags) {
  const s = await loadSession();
  log("Gemma 4 is choosing which tools to call…");
  const plan = await (await postJson("/api/actions", { sources: payload(s.sources, false), analysis: s.analysis, instructions: s.instructions, language: flags.lang ?? s.language, private: s.private })).json();
  const L = labels(s.sources);
  const cite = (ids = []) => ids.map((id) => `[${L.get(id) ?? "?"}]`).join("");
  if (flags.ics) {
    const events = plan.actions.filter((a) => a.tool === "create_calendar_event");
    if (events.length) {
      await writeFile(flags.ics, icsFor(events));
      log(`Wrote ${events.length} event(s) to ${flags.ics}`);
    } else log("No calendar events proposed; no .ics written.");
  }
  if (flags.json) return console.log(JSON.stringify(plan, null, 2));
  console.log("# Proposed actions (approve before acting)\n");
  for (const a of plan.actions) {
    if (a.tool === "create_calendar_event")
      console.log(`- 📅 **${a.title}**: ${a.date}${a.startTime ? ` ${a.startTime}${a.endTime ? "–" + a.endTime : ""}` : " (all day)"}${a.location ? `, ${a.location}` : ""} ${cite(a.factIds)}`);
    else if (a.tool === "draft_message")
      console.log(`- ✉️ **Draft ${a.channel} to ${a.to}**: ${a.why} ${cite(a.factIds)}\n${a.subject ? `  Subject: ${a.subject}\n` : ""}  > ${a.body.replace(/\n/g, "\n  > ")}`);
    else if (a.tool === "create_checklist") console.log(`- ✅ **${a.title}**\n${a.items.map((i) => `  - [ ] ${i.text}${i.due ? ` (by ${i.due})` : ""} ${cite(i.factIds)}`).join("\n")}`);
  }
}

/* ---------- main ---------- */

const [cmd, ...rest] = process.argv.slice(2);
const { _, flags } = parseArgs(rest);
const HELP = `ContextOS skill CLI (server: ${BASE})
  status                                   check the server and models
  brief <file...> [--lang L] [--private] [--instructions "..."] [--json]
                                           read files with Gemma 4 and print the context briefing
  ask "<question>" [--json]                ask the co-pilot about the last briefing (multi-turn)
  actions [--ics out.ics] [--json]         Gemma 4 proposes calendar events, messages and a checklist`;

switch (cmd) {
  case "status":
    await status();
    break;
  case "brief":
    await brief(_, flags);
    break;
  case "ask":
    await ask(_.join(" "), flags);
    break;
  case "actions":
    await actions(flags);
    break;
  default:
    console.log(HELP);
    process.exit(cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0);
}
