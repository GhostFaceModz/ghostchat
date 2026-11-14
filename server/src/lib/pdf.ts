import { createRequire } from "node:module";
import { cleanText } from "./chunk.js";

const require = createRequire(import.meta.url);

export async function extractPdfText(buffer: Buffer, filename = "document.pdf"): Promise<string> {
  let pdfParse: (buf: Buffer) => Promise<{ text?: string }>;
  try {
    const mod = require("pdf-parse") as { default?: typeof pdfParse } | typeof pdfParse;
    pdfParse = (typeof mod === "function" ? mod : mod.default) as typeof pdfParse;
  } catch {
    throw new Error("PDF parsing is not available on this server.");
  }
  if (typeof pdfParse !== "function") {
    throw new Error("PDF parser failed to load.");
  }
  const result = await pdfParse(buffer);
  const text = cleanText(result?.text || "");
  if (text.length < 40) {
    throw new Error(`No usable text in ${filename}. It may be a scanned PDF (image-only).`);
  }
  return text;
}

export function isPdfFile(name: string, mime?: string): boolean {
  return /\.pdf$/i.test(name) || mime === "application/pdf";
}
