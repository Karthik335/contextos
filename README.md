# ContextOS

**Drop the scattered pieces of a situation (photos, screenshots, PDFs, voice notes, videos, documents) and ContextOS connects the dots: what clashes, what's missing, what changed, and what to do next. Then keep asking it questions.**

Built on **Gemma 4** (open weights, Apache 2.0) through the Google Gemini API: two Gemma models routed per task, plus open-source Whisper for audio.

---

## What it does

1. **Reads everything.** Images and screenshots go to Gemma 4 vision. PDFs, Word, PowerPoint, Excel/CSV and text are parsed. Audio is cut into 30-second chunks and transcribed. Videos are split into speech plus key frames that Gemma reads.
2. **Extracts facts** from each source: dates, times, deadlines, tasks, requirements, with the exact quote and where it came from (page, slide or timestamp).
3. **Builds a context briefing** across all sources:
   - **Conflicts**: time clashes are checked by plain code and marked *Verified by code*; Gemma finds other contradictions.
   - **What you might be missing**: gaps backed by evidence, e.g. "the assignment needs Unit 4, but your notes say you haven't started it".
   - **Key dates** on a timeline, coloured by urgency.
   - **What to do next**: actions with citations.
4. **Context Co-pilot.** A multi-turn chat that answers only from your sources. Every claim has a clickable citation that opens the evidence: the image, the PDF page, or the exact moment in the audio or video.
5. **What changed.** Add a new file later (e.g. a revised circular) and ContextOS shows which conflicts were resolved, which are new, and what facts were added.
6. **Context graph.** An interactive graph of sources, facts and relationships (conflicts, dependencies, updates).
7. **Contexts** (like Projects in ChatGPT/Claude). Shared files, instructions and a briefing, with many chats inside.
8. **Profiles** (Netflix-style "Who's analysing?"), with an optional PIN.
9. **Answer in your language**: pick English, Hindi, Kannada, Tamil, Telugu, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Urdu or others in the composer. Briefings and co-pilot answers come in that language, whatever language the sources are in (Gemma 4 understands 140+ languages).
10. **Private mode**: one switch runs everything on **Gemma 4 E4B on your own computer** through [Ollama](https://ollama.com): images, extraction, analysis and chat, with Whisper for audio. Nothing leaves the machine, it works offline, and there are no rate limits. Setup: install Ollama, then `ollama pull gemma4:e4b`.
11. **Act on it (Gemma 4 function calling)**: one button turns the briefing into actions. Gemma 4 is given three tools in the standard function-calling format (`create_calendar_event`, `draft_message`, `create_checklist`) and decides which to call and with what arguments. Nothing runs until you approve: dates become `.ics` files or Google Calendar events, message drafts are editable and open in email or WhatsApp, and the checklist becomes tickable. The server drops calls with past dates, dates that don't match the cited fact, or facts that are outdated. Click `</>` on any card to see the exact function call Gemma made. Each key date in the briefing also has a one-click calendar button.
12. **Snap with camera**: photograph a notice, page or whiteboard straight into the chat. Laptops get a live preview; phones open the native camera.
13. **Agent Skill**: ContextOS is packaged as an [Agent Skill](https://agentskills.io) in [`skills/contextos-briefing/`](skills/contextos-briefing/SKILL.md), so any skills-compatible agent can use it (see below).
14. **Light and dark mode**: pastel light theme or black dark theme, switched with the sun/moon button. Follows the system setting until you choose.

## How Gemma 4 is used: a multi-Gemma pipeline, 100% open models

| Step | Model | Why |
|---|---|---|
| Reading images, screenshots, scanned PDF pages, video frames | **Gemma 4 31B** (`GEMMA_MODEL`) | the Gemma 4 model with vision |
| Extracting facts from text, in small chunks | **Gemma 4 26B A4B** (`GEMMA_FAST_MODEL`) | mixture-of-experts: several times faster |
| Connecting facts across sources: relationships, gaps, actions | **Gemma 4 26B A4B** (`GEMMA_REASONING_MODEL` to change) | fast on the free API (~5 s vs ~40 s for 31B) |
| Co-pilot answers with citations (streaming, multi-turn) | **Gemma 4 26B A4B** | answers in seconds |
| "Act on it": choosing tools and arguments (function calling) | **Gemma 4 26B A4B** (31B as backup) | output validated per call; user approves each |
| Audio transcription | an audio-capable Gemma 4 model (`GEMMA_AUDIO_MODEL`, E4B/E2B) if available, else **Whisper** (open-source, runs locally) | |
| Time-conflict detection, date sorting, "what changed" diff | plain TypeScript (deterministic) | no AI needed |
| PDF / DOCX / PPTX / XLSX text, audio/video conversion | unpdf, mammoth, jszip, SheetJS, ffmpeg | |

Every result in the UI shows a small label with the model that produced it.

**Reliability on the free API**
- Gemma's thinking is set to minimal, so answers don't wait 30+ seconds.
- Requests are kept small (documents are read in ~9k-character parts).
- A failed call is retried on the same Gemma model.
- If the main model fails, the other Gemma model takes over for text steps.
- Successful answers are cached on disk (`.cache/`), so repeating a demo is instant. Set `AI_CACHE=0` to disable.
- Failed files get a **Retry** button.
- **Free-tier friendly:** the app paces requests under a tokens-per-minute budget (`GEMMA_TPM`, default 14000), waits the delay Google asks for on a rate limit, and the co-pilot sends only the passages relevant to each question (`CHAT_CONTEXT_CHARS`, default 12000), not whole documents.

A Gemini Flash backup exists in the code but is **off** unless you set `GEMINI_BACKUP=1`.

All model calls go through one file, [`server/ai.ts`](server/ai.ts). Run `npm run check` to test your key and both Gemma models.

## Quick start (local)

Requires **Node.js 20.12+**.

```bash
npm install
cp .env.example .env      # then put your key in .env
npm run dev               # http://localhost:3000
```

`.env`:

```
GEMINI_API_KEY=your-key-from-aistudio.google.com
GEMMA_MODEL=gemma-4-31b-it          # vision + reasoning
GEMMA_FAST_MODEL=gemma-4-26b-a4b-it  # fast text extraction
GEMMA_AUDIO_MODEL=                   # optional: an audio-capable Gemma 4 model (E4B / E2B)
```

No key yet? Set `MOCK_AI=1` to click through the UI with a rule-based stand-in. It is **not** AI and the app shows a red "Mock mode" badge.

### Audio without an audio-capable Gemma model

If `GEMMA_AUDIO_MODEL` is empty, ContextOS uses Whisper locally. Install it once:

```bash
npm install @huggingface/transformers
```

The first transcription downloads the Whisper model (`Xenova/whisper-base` by default; set `WHISPER_MODEL=Xenova/whisper-small` for better accuracy).

## Deploy

**Replit**
1. Import this repo from GitHub.
2. Add the secrets `GEMINI_API_KEY` and `GEMMA_MODEL` (plus `GEMMA_AUDIO_MODEL` if you have one).
3. Click Run to test, then Deploy. The `.replit` file already sets build = `npm run build`, run = `npm start`.
4. Use a **Reserved VM** deployment: upload jobs are kept in memory, so a single always-on instance is required.

**Render / Railway / any Node host**
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Add the same environment variables.
- Use one instance, for the same reason.

Serverless hosts such as Vercel functions are not a good fit, because media processing runs as a background job with ffmpeg.

## Supported files

| Type | Formats | Limit |
|---|---|---|
| Images | jpg, jpeg, png, webp, gif | 200 MB |
| Documents | pdf, docx, pptx, txt, md, html, json | 200 MB; scanned PDF pages read by vision (first 10) |
| Sheets | xlsx, xls, csv | first 300 rows per sheet |
| Audio | mp3, wav, m4a, aac, ogg | 15 minutes |
| Video | mp4, mov, webm, mkv | 15 minutes; up to 16 frames read |

## Agent Skill

[`skills/contextos-briefing/`](skills/contextos-briefing/) follows the [Agent Skill open standard](https://agentskills.io/specification): a `SKILL.md` with `name` and `description` frontmatter, a dependency-free script and reference docs. It passes the reference validator (`pip install skills-ref`, then `agentskills validate skills/contextos-briefing`).

To use it, copy the folder into your agent's skills directory (for example `~/.claude/skills/` or `.agents/skills/`), keep ContextOS running (`npm run dev`), and ask the agent about your files. Or run the script yourself (Node 20+):

```bash
cd skills/contextos-briefing
node scripts/contextos.mjs brief notice.jpg chat.png plan.pdf --lang Hindi   # briefing, cited
node scripts/contextos.mjs ask "What should I do first?"                      # multi-turn co-pilot
node scripts/contextos.mjs actions --ics deadlines.ics                        # Gemma 4 function calls
```

Add `--private` to keep everything on your computer with local Gemma 4. Set `CONTEXTOS_URL` if the server isn't on `http://localhost:3000`.

## Architecture

```
Browser (React + Vite + Tailwind)                     Server (Node + Express)
─────────────────────────────────                     ───────────────────────
Profiles, contexts, chats, files                      POST /api/sources  → background job
  stored in IndexedDB (this browser)                  GET  /api/jobs/:id → progress + result
Composer → upload ─────────────────────────────────▶  ingest: vision / parsers / ffmpeg+audio
Working block polls job status                         → Gemma 4 fact extraction (JSON, validated)
Briefing ◀──────────── POST /api/analyze ◀───────────  Gemma 4 relationships, gaps, actions
                                                        + code-verified conflicts
Co-pilot ◀──────────── POST /api/chat (stream) ◀─────  Gemma 4, full context + whole history
Act on it ◀─────────── POST /api/actions ◀───────────  Gemma 4 function calls → validated, grounded
  (approve → .ics / mail / WhatsApp / checklist)
Graph (React Flow + dagre), source viewer
```

- `server/ai.ts`: the only place that calls the model (retries, JSON parsing).
- `server/pipeline.ts`: background jobs and per-format conversion.
- `server/ingest/`: documents, images, audio and video.
- `server/analysis.ts`: situation model and chat prompt assembly.
- `shared/conflicts.ts`: deterministic time-conflict check and "what changed" diff.
- `server/actions.ts`: "Act on it" (tool declarations in `server/prompts.ts`, checks on each call).
- `skills/contextos-briefing/`: the Agent Skill (SKILL.md, CLI script, references).
- `src/lib/engine.ts`: front-end orchestration (upload → poll → analyse → answer).

## Demo script (90 seconds)

1. Choose a profile, then click **Try the demo**. It loads four real files from `public/demo` through the real pipeline: a phone photo of a notice board, a class group chat screenshot, a course plan PDF and personal notes.
2. Watch the working block read each file with Gemma.
3. The briefing shows a **red conflict**: the DBMS lab viva (chat screenshot) overlaps the Algorithms test (notice photo). It is marked *Verified by code*.
4. Gaps appear: the assignment needs Unit 4, which the notes say isn't started; experiments 7 and 8 aren't signed, and the course plan says signing only happens on Tue/Wed.
5. Ask: *"Why is this a problem and what should I do first?"* Click a citation to open the exact evidence.
6. Click **Act on it**. Gemma 4 proposes calendar events, a message to the lab instructor and a checklist. Click `</>` to show the raw function call, then **Approve & add** to download the `.ics`.
7. Click **Demo: add the revised circular**. The **What changed** card shows the conflict resolved, and the graph updates.

The demo files are fictional (a made-up college); regenerate or replace them freely.

## Limitations

- Profiles and data are stored in the browser (IndexedDB) on one device. There are no server accounts, and the PIN is a convenience lock, not real security.
- Jobs are held in server memory: restarting the server during processing loses the job, and the UI asks you to re-add the file.
- Audio needs either an audio-capable Gemma 4 model or the optional Whisper package.
- Answers are only as good as the sources. ContextOS says when evidence is insufficient, but always check the citations.
- Uploaded content is treated as untrusted: prompts tell the model never to follow instructions found inside files.

## License

[Apache-2.0](LICENSE). Gemma 4 is released by Google under Apache 2.0. Demo data is fictional.
