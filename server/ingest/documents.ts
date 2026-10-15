// Images, PDFs, Word, PowerPoint, Excel/CSV and plain text → text segments.
import { promises as fs } from "node:fs";
import sharp from "sharp";
import mammoth from "mammoth";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import * as ai from "../ai.js";
import { VISION_READ } from "../prompts.js";
import type { Segment } from "../../shared/types.js";

type Progress = (step: string, progress: number) => void;

/** Longest side at most 1280 px, re-encoded as JPEG quality 85: small requests, text stays readable. */
async function prepareImage(buf: Buffer) {
  const out = await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { mimeType: "image/jpeg", base64: out.toString("base64") };
}

export async function readImage(file: string, onProgress: Progress): Promise<Segment[]> {
  onProgress("Reading image with Gemma vision", 0.3);
  const img = await prepareImage(await fs.readFile(file));
  const text = await ai.vision([img], VISION_READ);
  return [{ location: "image", text }];
}

export async function readPdf(file: string, onProgress: Progress): Promise<{ segments: Segment[]; notes: string[] }> {
  const data = new Uint8Array(await fs.readFile(file));
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = text as string[];
  const segments: Segment[] = [];
  const notes: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const t = (pages[i] ?? "").trim();
    onProgress(`Reading page ${i + 1} of ${pages.length}`, 0.1 + 0.4 * ((i + 1) / pages.length));
    if (t.length > 40) {
      segments.push({ location: `p.${i + 1}`, text: t });
      continue;
    }
    // Scanned page: render it and let Gemma vision read it.
    if (i >= 10) {
      notes.push(`Page ${i + 1} looks scanned and was skipped (only the first 10 scanned pages are read).`);
      continue;
    }
    try {
      const png = await renderPageAsImage(new Uint8Array(await fs.readFile(file)), i + 1, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: 1.6,
      });
      const img = await prepareImage(Buffer.from(png));
      onProgress(`Page ${i + 1} is scanned, reading it with Gemma vision`, 0.1 + 0.4 * ((i + 1) / pages.length));
      segments.push({ location: `p.${i + 1}`, text: await ai.vision([img], VISION_READ) });
    } catch (err) {
      notes.push(`Page ${i + 1} looks scanned and could not be rendered (${String(err).slice(0, 80)}).`);
    }
  }
  return { segments, notes };
}

export async function readDocx(file: string): Promise<Segment[]> {
  const { value } = await mammoth.extractRawText({ path: file });
  return splitText(value, "section");
}

export async function readPptx(file: string): Promise<Segment[]> {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
  const segments: Segment[] = [];
  for (const [i, name] of slides.entries()) {
    const xml = await zip.files[name].async("string");
    const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(" ").trim();
    if (text) segments.push({ location: `slide ${i + 1}`, text });
  }
  return segments;
}

export async function readSheet(file: string): Promise<Segment[]> {
  const wb = XLSX.read(await fs.readFile(file), { type: "buffer", cellDates: true });
  return wb.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
    const rows = csv.split("\n").slice(0, 300); // keep big sheets manageable
    return { location: `sheet ${name}`, text: rows.join("\n") };
  }).filter((s) => s.text.trim());
}

export async function readText(file: string, isHtml: boolean): Promise<Segment[]> {
  let t = await fs.readFile(file, "utf8");
  if (isHtml) t = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return splitText(t, "section");
}

/** Split long text into labelled sections so citations stay useful. */
function splitText(text: string, label: string): Segment[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n\s*\n/);
  const out: Segment[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + p).length > 3000 && buf) {
      out.push({ location: `${label} ${out.length + 1}`, text: buf.trim() });
      buf = "";
    }
    buf += p + "\n\n";
  }
  if (buf.trim()) out.push({ location: out.length ? `${label} ${out.length + 1}` : "text", text: buf.trim() });
  return out;
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
