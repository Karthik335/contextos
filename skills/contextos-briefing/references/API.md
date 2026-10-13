# ContextOS HTTP API

Base URL: `CONTEXTOS_URL` (default `http://localhost:3000`). All bodies are JSON unless noted.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | Models in use, whether a key is set, mock mode, local (Ollama) status |
| POST | `/api/sources` | Upload one file (multipart: `file`, `sourceId`, `private` = `"1"`/`"0"`). Returns `{ jobId }` |
| GET | `/api/jobs/:id` | Poll a job: `{ status: queued/running/done/error, step, progress, result?, error? }` |
| POST | `/api/analyze` | `{ sources, instructions?, language?, private? }` → `Analysis` |
| POST | `/api/chat` | `{ sources, analysis?, history, instructions?, language?, private? }` → streamed plain text; header `X-Model` names the model |
| POST | `/api/actions` | `{ sources, analysis?, instructions?, language?, private? }` → `{ actions: ProposedAction[], models }` |

## Shapes

`SourcePayload`: `{ id, name, kind, summary, facts: Fact[], text? }` (send `text`, the joined transcript, to `/api/chat` only).

`Fact`: `{ id, text, type: deadline|event|task|requirement|constraint|status|other, date?, startTime?, endTime?, quote?, location?, certainty: stated|inferred }`.

`Analysis`: `{ title, overview, conflicts[{a,b,explanation,verifiedByCode}], gaps[{question,why,impact,resolveBy,factIds}], keyDates[{factId,date,label}], actions[{text,factIds}], relationships[], superseded[], followups[], models[] }`.

`ProposedAction` (one of):
- `{ tool: "create_calendar_event", title, date, startTime?, endTime?, location?, notes?, factIds }`
- `{ tool: "draft_message", channel: "email"|"whatsapp", to, subject?, body, why, factIds }`
- `{ tool: "create_checklist", title, items: [{ text, due?, factIds }] }`

Calendar events are checked by the server: dates in the past, dates that don't match the cited fact, and events based only on outdated facts are dropped.

## Citations

Facts are labelled `F1, F2, …` in source order, then fact order. The chat answer cites them as `[F3]`. The CLI prints the label → fact table after each briefing.
