// Types shared by the server and the browser.

export type FactType =
  | "deadline"
  | "event"
  | "task"
  | "requirement"
  | "constraint"
  | "status"
  | "other";

export interface Fact {
  /** Stable id: `${sourceId}:${index}` */
  id: string;
  text: string;
  type: FactType;
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:MM (24h)
  endTime?: string; // HH:MM (24h)
  quote?: string;
  location?: string; // "p.3", "02:15", "image", "slide 2"
  certainty: "stated" | "inferred";
}

export type SourceKind = "image" | "pdf" | "doc" | "sheet" | "text" | "audio" | "video";

export interface Segment {
  location: string;
  text: string;
}

export interface SourceResult {
  summary: string;
  facts: Fact[];
  segments: Segment[];
  durationSec?: number;
  frames?: { t: number; dataUrl: string }[];
  notes?: string[]; // warnings such as "page 3 looks scanned"
  models?: string[]; // which AI models produced this result
}

export interface JobStatus {
  id: string;
  status: "queued" | "running" | "done" | "error";
  step: string;
  progress: number; // 0..1
  result?: SourceResult;
  error?: string;
}

/** A source as sent to /api/analyze and /api/chat. */
export interface SourcePayload {
  id: string;
  name: string;
  kind: SourceKind;
  summary: string;
  facts: Fact[];
  text?: string; // full extracted text, chat only
}

export type RelationType = "depends_on" | "conflicts_with" | "updates" | "supports";

export interface Relationship {
  from: string; // fact id
  to: string; // fact id
  type: RelationType;
  explanation: string;
}

export interface Conflict {
  a: string; // fact id
  b: string; // fact id
  explanation: string;
  verifiedByCode: boolean;
}

export interface Gap {
  question: string;
  why: string;
  factIds: string[];
  resolveBy: string;
  impact: "high" | "medium" | "low";
}

export interface Action {
  text: string;
  factIds: string[];
}

export interface KeyDate {
  factId: string;
  date: string;
  label: string;
}

export interface Analysis {
  title: string;
  overview: string;
  relationships: Relationship[];
  conflicts: Conflict[];
  gaps: Gap[];
  actions: Action[];
  keyDates: KeyDate[];
  superseded: string[]; // fact ids replaced by newer information
  followups: string[];
  models?: string[];
  createdAt: number;
}

export interface Changes {
  newFacts: string[];
  resolvedConflicts: Conflict[];
  newConflicts: Conflict[];
  newGaps: Gap[];
  resolvedGaps: Gap[];
  summary: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/* "Act on it": actions Gemma proposed through function calling. The user approves each one. */
export interface CalendarAction {
  tool: "create_calendar_event";
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
  factIds: string[];
}
export interface MessageAction {
  tool: "draft_message";
  channel: "email" | "whatsapp";
  to: string;
  subject?: string;
  body: string;
  why: string;
  factIds: string[];
}
export interface ChecklistAction {
  tool: "create_checklist";
  title: string;
  items: { text: string; due?: string; factIds: string[]; done?: boolean }[];
}
export type ProposedAction = (CalendarAction | MessageAction | ChecklistAction) & {
  /** Set in the app when the user approves or dismisses the call. */
  status?: "approved" | "dismissed";
};
export interface ActionPlan {
  actions: ProposedAction[];
  models?: string[];
  createdAt: number;
}
