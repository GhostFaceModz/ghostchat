/** Import FAQ rows from a CSV (question, answer). */
import { chunkText } from "./chunk.js";
import { storeChunks, refreshCounts } from "./indexer.js";
import { getDb } from "./supabase.js";
import type { Site } from "../types.js";

export type FaqRow = { question: string; answer: string };

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseFaqCsv(raw: string): FaqRow[] {
  const text = String(raw || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "\n" && !inQuotes) { lines.push(buf); buf = ""; }
    else buf += ch;
  }
  if (buf.trim()) lines.push(buf);
  const rows: FaqRow[] = [];
  let start = 0;
  if (lines.length) {
    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
    const qIdx = header.findIndex((h) => ["question", "q", "prompt"].includes(h));
    const aIdx = header.findIndex((h) => ["answer", "a", "response", "reply"].includes(h));
    if (qIdx >= 0 && aIdx >= 0) start = 1;
    const qi = start ? qIdx : 0;
    const ai = start ? aIdx : 1;
    for (const line of lines.slice(start)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const cols = parseCsvLine(line);
      const question = String(cols[qi] || "").replace(/\s+/g, " ").trim().slice(0, 500);
      const answer = String(cols[ai] || "").trim().slice(0, 4000);
      if (question.length >= 8 && answer.length >= 2) rows.push({ question, answer });
      if (rows.length >= 200) break;
    }
  }
  return rows;
}

export async function importFaqRows(site: Pick<Site, "id">, rows: FaqRow[]) {
  if (!rows.length) throw Object.assign(new Error("The CSV did not contain any question and answer rows."), { status: 400 });
  const created = [];
  for (const row of rows) {
    const title = row.question.slice(0, 200);
    const text = `Q: ${row.question}\nA: ${row.answer}`;
    const chunks = chunkText(text, { title, heading: row.question });
    const { data: doc, error } = await getDb()
      .from("ghostchat_documents")
      .insert({
        site_id: site.id,
        filename: title,
        source_type: "faq",
        byte_size: text.length,
        chunk_count: chunks.length,
      })
      .select("id, filename, source_type, chunk_count, created_at")
      .single();
    if (error) throw error;
    await storeChunks({ site, documentId: doc.id, sourceType: "faq", chunks });
    created.push(doc);
  }
  await refreshCounts(site.id);
  return { imported: created.length, documents: created };
}
