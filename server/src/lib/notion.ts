import { config } from "../config.js";
import { cleanText } from "./chunk.js";

const NOTION_VERSION = "2022-06-28";

export function parseNotionPageId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const compact = raw.match(/[0-9a-fA-F]{32}/);
  const dashed = raw.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  const hex = (dashed?.[0] || compact?.[0] || "").replace(/-/g, "").toLowerCase();
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

function richText(block: NotionBlock): string {
  const node = block[block.type];
  if (!node || typeof node !== "object") return "";
  const rich = (node as { rich_text?: Array<{ plain_text?: string }> }).rich_text;
  if (!Array.isArray(rich)) return "";
  return rich.map((t) => t.plain_text || "").join("");
}

export async function importNotionPage(pageUrlOrId: string): Promise<{ title: string; url: string | null; text: string; pageId: string }> {
  if (!config.notionApiKey) {
    throw new Error("Notion import is not configured. Set NOTION_API_KEY (an internal integration token) and share the page with that integration.");
  }
  const pageId = parseNotionPageId(pageUrlOrId);
  if (!pageId) throw new Error("That does not look like a Notion page URL or ID.");

  const headers = {
    authorization: `Bearer ${config.notionApiKey}`,
    "notion-version": NOTION_VERSION,
    "content-type": "application/json",
  };

  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
  if (pageRes.status === 401 || pageRes.status === 403) {
    throw new Error("Notion denied access. Share the page with your GhostChat integration.");
  }
  if (!pageRes.ok) {
    throw new Error(`Notion page could not be loaded (${pageRes.status}).`);
  }
  const page = (await pageRes.json()) as {
    url?: string;
    properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
  };
  const titleProp = Object.values(page.properties || {}).find((p) => p.type === "title");
  const title = titleProp?.title?.map((t) => t.plain_text || "").join("") || "Notion page";

  const parts: string[] = [title];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);
    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?${qs}`, { headers });
    if (!res.ok) break;
    const json = (await res.json()) as { results?: NotionBlock[]; next_cursor?: string | null; has_more?: boolean };
    for (const block of json.results || []) {
      const text = richText(block).trim();
      if (text) parts.push(text);
    }
    cursor = json.has_more ? json.next_cursor || undefined : undefined;
  } while (cursor);

  const text = cleanText(parts.join("\n\n"));
  if (text.length < 40) throw new Error("That Notion page did not contain enough text to train on.");
  return { title, url: page.url || null, text, pageId };
}
