import { FileText, Image, Music, Video, FileSpreadsheet, File as FileIcon, Presentation } from "lucide-react";
import type { SourceKind } from "../../shared/types";

export const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.html,.json,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.mov,.webm,.mkv";
export const MAX_BYTES = 200 * 1024 * 1024;

export function kindOf(name: string, mime: string): SourceKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext) || mime.startsWith("image/")) return "image";
  if (ext === "pdf") return "pdf";
  if (["docx", "pptx"].includes(ext)) return "doc";
  if (["xlsx", "xls", "csv"].includes(ext)) return "sheet";
  if (["txt", "md", "markdown", "html", "htm", "json"].includes(ext) || mime.startsWith("text/")) return "text";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"].includes(ext) || mime.startsWith("audio/")) return "audio";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext) || mime.startsWith("video/")) return "video";
  return null;
}

/** Kind colour mixed toward the theme's text colour: darker in light mode, lighter in dark mode. */
const fg = (c: string) => `color-mix(in srgb, ${c} 62%, var(--t-ink))`;

export const KIND_STYLE: Record<SourceKind, { color: string; bg: string; label: string }> = {
  pdf: { color: fg("#C2415B"), bg: "#C2415B2E", label: "PDF" },
  image: { color: fg("#7A62A0"), bg: "#7A62A02E", label: "Image" },
  audio: { color: fg("#6E4A7E"), bg: "#6E4A7E2E", label: "Audio" },
  video: { color: fg("#C0703F"), bg: "#C0703F2E", label: "Video" },
  doc: { color: fg("#4F7A4A"), bg: "#4F7A4A2E", label: "Doc" },
  sheet: { color: fg("#4F7A4A"), bg: "#4F7A4A2E", label: "Sheet" },
  text: { color: fg("#5E6B5A"), bg: "#5E6B5A2E", label: "Text" },
};

export function kindIcon(kind: SourceKind, name = "") {
  if (kind === "image") return Image;
  if (kind === "audio") return Music;
  if (kind === "video") return Video;
  if (kind === "sheet") return FileSpreadsheet;
  if (kind === "doc" && name.toLowerCase().endsWith(".pptx")) return Presentation;
  if (kind === "pdf" || kind === "doc" || kind === "text") return FileText;
  return FileIcon;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#CFC6D8,#B5546B)",
  "linear-gradient(135deg,#B8C9B1,#6E8F68)",
  "linear-gradient(135deg,#F2B6BB,#C2415B)",
  "linear-gradient(135deg,#F2CDBF,#C0703F)",
  "linear-gradient(135deg,#CFC6D8,#6E4A7E)",
  "linear-gradient(135deg,#B8C9B1,#F2B6BB)",
];

export const CONTEXT_COLORS = ["#B5546B", "#6E4A7E", "#6E8F68", "#C0703F", "#7A62A0", "#C2415B"];

/** "02:15" or "p.3" → seconds / page */
export function parseLocation(loc?: string): { seconds?: number; page?: number } {
  if (!loc) return {};
  const t = /(\d{1,2}):(\d{2})/.exec(loc);
  if (t) return { seconds: Number(t[1]) * 60 + Number(t[2]) };
  const p = /p(?:age)?\.?\s*(\d+)/i.exec(loc);
  if (p) return { page: Number(p[1]) };
  return {};
}
