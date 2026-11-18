/** Extract text from documents linked on a crawled site (docx, rtf, plain text). Old binary .doc is skipped. */
import { inflateRawSync, inflateSync } from "node:zlib";

export function extractPlainText(buf: Buffer): string {
  return buf.toString("utf8").replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^/]*\/>/g, " ")
    .replace(/<w:br\b[^/]*\/>/g, "\n")
    .replace(/<w:p[ >]/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Minimal ZIP reader for word/document.xml inside a .docx (deflate or store). */
export function extractDocxText(buf: Buffer): string {
  if (buf.length < 30 || buf.toString("ascii", 0, 2) !== "PK") return "";
  let offset = 0;
  while (offset + 30 < buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const origSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.toString("utf8", nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) break;
    if (name === "word/document.xml") {
      const slice = buf.subarray(dataStart, dataEnd);
      let xml: Buffer;
      if (method === 0) xml = Buffer.from(slice);
      else if (method === 8) {
        try { xml = inflateRawSync(slice); } catch {
          try { xml = inflateSync(slice); } catch { return ""; }
        }
      } else return "";
      if (origSize && xml.length > origSize * 2) { /* ignore */ }
      return xmlToText(xml.toString("utf8"));
    }
    offset = dataEnd;
  }
  return "";
}

export function extractRtfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  if (!raw.startsWith("{\\rtf")) return "";
  return raw
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, " ")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function extractLinkedDocument(buf: Buffer, filename: string): Promise<string> {
  const name = filename.toLowerCase();
  if (name.endsWith(".docx")) return extractDocxText(buf);
  if (name.endsWith(".rtf")) return extractRtfText(buf);
  if (name.endsWith(".txt") || name.endsWith(".md")) return extractPlainText(buf);
  // Legacy .doc / OpenDocument would need a paid or heavy converter.
  return "";
}
