// Self-test: `npm run check`. Runs the SAME code paths the app uses (thinking control, retries,
// model routing), with the cache off, and reports time + which Gemma model answered.
process.env.AI_CACHE = "0";
await import("../server/env.js");
const { promises: fs } = await import("node:fs");
const sharp = (await import("sharp")).default;
const ai = await import("../server/ai.js");
const { modelLabel } = await import("../shared/labels.js");

if (!process.env.GEMINI_API_KEY) {
  console.log("❌ GEMINI_API_KEY is missing in .env");
  process.exit(1);
}
console.log(`Vision: ${ai.MODEL} · Extraction: ${ai.FAST_MODEL || ai.MODEL} · Reasoning + chat: ${ai.REASONING_MODEL}\n`);
const img = await sharp(await fs.readFile("public/demo/class_group_chat.png")).resize({ width: 1024 }).jpeg({ quality: 80 }).toBuffer();

async function test(label: string, fn: () => Promise<string>) {
  const used = new Set<string>();
  const t = Date.now();
  try {
    const out = await ai.modelUsage.run(used, fn);
    console.log(`✅ ${label} · ${[...used].map(modelLabel).join(", ")} · ${((Date.now() - t) / 1000).toFixed(1)}s → ${out.slice(0, 80).replace(/\n/g, " ")}`);
  } catch (e: any) {
    console.log(`❌ ${label} · ${((Date.now() - t) / 1000).toFixed(1)}s → ${String(e?.message ?? e).slice(0, 220)}`);
  }
}

await test("fast text (extraction)", () => ai.text("Reply with exactly: Gemma fast model is working.", 200, "fast"));
await test("deep text (reasoning)", () => ai.text("Reply with exactly: Gemma reasoning model is working.", 200, "deep"));
await test("image (vision)", () => ai.vision([{ mimeType: "image/jpeg", base64: img.toString("base64") }], "What does the first message in this chat screenshot say? One line."));
export {};
