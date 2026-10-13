import type { ActionPlan, Analysis, Changes, SourceKind, SourceResult } from "../../shared/types";

export interface Profile {
  id: string;
  name: string;
  emoji: string;
  hue: number; // index into AVATAR_GRADIENTS
  pin?: string;
}

export interface SourceRec {
  id: string;
  name: string;
  kind: SourceKind;
  mime: string;
  size: number;
  status: "uploading" | "processing" | "done" | "error";
  step: string;
  progress: number;
  result?: SourceResult;
  error?: string;
  createdAt: number;
}

export type MessageKind = "text" | "working" | "briefing" | "changes" | "actions" | "error";

export interface Message {
  id: string;
  role: "user" | "assistant";
  kind: MessageKind;
  text?: string;
  sourceIds?: string[];
  analysis?: Analysis; // snapshot for briefing/changes messages
  changes?: Changes;
  actions?: ActionPlan; // "Act on it": tool calls proposed by Gemma
  pending?: string; // label shown while waiting
  followups?: string[];
  streaming?: boolean;
  model?: string; // which AI model wrote this answer
  done?: boolean; // for working blocks
  createdAt: number;
}

export interface Chat {
  id: string;
  contextId: string | null;
  title: string;
  messages: Message[];
  sourceIds: string[];
  analysis?: Analysis;
  analysisFactIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Ctx {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  instructions: string;
  sourceIds: string[];
  analysis?: Analysis;
  analysisFactIds?: string[];
  lastChanges?: Changes;
  analyzing?: boolean;
  createdAt: number;
}

export interface ProfileData {
  contexts: Ctx[];
  chats: Chat[];
  sources: Record<string, SourceRec>;
}

export type View =
  | { type: "home"; contextId?: string }
  | { type: "chat"; chatId: string }
  | { type: "context"; contextId: string };

export interface Panel {
  open: boolean;
  mode: "graph" | "source";
  sourceId?: string;
  location?: string;
  focusFactId?: string;
  scope?: { chatId?: string; contextId?: string };
}
