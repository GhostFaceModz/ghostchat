export type TextChunk = {
  title: string;
  url: string | null;
  content: string;
  tokenCount: number;
};

const MAX_CHARS = 1800;
const OVERLAP = 250;

export function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function cleanText(input: string): string {
  return input
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkText(text: string, meta: { title: string; url?: string | null }): TextChunk[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  const paragraphs = cleaned.split(/\n{2,}/);
  const chunks: TextChunk[] = [];
  let current = "";

  const flush = () => {
    const content = current.trim();
    if (content.length < 40) {
      current = "";
      return;
    }
    chunks.push({
      title: meta.title,
      url: meta.url ?? null,
      content,
      tokenCount: approxTokens(content),
    });
    current = content.slice(-OVERLAP);
  };

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > MAX_CHARS) {
      if (current) flush();
      if (para.length > MAX_CHARS) {
        for (let i = 0; i < para.length; i += MAX_CHARS - OVERLAP) {
          current = para.slice(i, i + MAX_CHARS);
          flush();
        }
        current = "";
      } else {
        current = para;
      }
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) flush();
  return chunks;
}
