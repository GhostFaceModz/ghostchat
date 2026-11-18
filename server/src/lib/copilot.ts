import { completeChat } from "./ai.js";
import { retrieveChunks } from "./chat.js";
import { transcript } from "./live.js";
import type { Site } from "../types.js";

export type CopilotSuggestion = {
  summary: string;
  reply: string;
  sources: Array<{ title?: string | null; url?: string | null }>;
  model: string;
};

function cheapSite(site: Site): Site {
  return { ...site, chat_provider: "openrouter", chat_model: "deepseek/deepseek-v4-flash" } as Site;
}

function transcriptOf(rows: Array<{ role: string; message: string; agent_name?: string | null }>): string {
  return rows.slice(-16).map((r) => {
    const who = r.role === "user" ? "Visitor" : r.role === "agent" ? (r.agent_name || "Agent") : r.role === "system" ? "System" : "GhostChat";
    return `${who}: ${r.message}`;
  }).join("\n");
}

export async function suggestInboxReply(site: Site, sessionId: string, extra?: { question?: string }): Promise<CopilotSuggestion> {
  const messages = await transcript(site.id, sessionId);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.message || extra?.question || "";
  const chunks = lastUser ? await retrieveChunks(site.id, lastUser, messages.map((m) => ({ role: m.role, content: m.message }))) : [];
  const context = chunks.slice(0, 6).map((c, i) => `[${i + 1}] ${c.title || c.url || "Source"}: ${c.content}`).join("\n\n");
  const prompt = `You help a human support agent on ${site.name || "this site"}. Using the transcript and sources, write a short JSON object with keys "summary" (one sentence) and "reply" (the message the agent can send, in the visitor's language, no greeting unless the chat just started). Be accurate. If the sources don't cover it, say so in the reply and offer to follow up. Do not invent prices, policies or order status.\n\nTRANSCRIPT:\n${transcriptOf(messages) || lastUser || "(empty)"}\n\nSOURCES:\n${context || "(none)"}`;
  const usage = { provider: "openrouter", model: "deepseek/deepseek-v4-flash", credits: 1 };
  const raw = await completeChat(
    [
      { role: "system", content: "You are a concise support copilot. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
    { site: cheapSite(site), json: true, fast: true, primary: true, hard: false, maxTokens: 400, temperature: 0.2, usage },
  );
  let summary = "A short suggested reply is ready.";
  let reply = raw.trim();
  try {
    const parsed = JSON.parse(raw) as { summary?: string; reply?: string };
    if (parsed.summary) summary = String(parsed.summary).slice(0, 400);
    if (parsed.reply) reply = String(parsed.reply).slice(0, 2000);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]) as { summary?: string; reply?: string };
        if (parsed.summary) summary = String(parsed.summary).slice(0, 400);
        if (parsed.reply) reply = String(parsed.reply).slice(0, 2000);
      } catch { /* keep raw */ }
    }
  }
  return {
    summary,
    reply,
    sources: chunks.slice(0, 4).map((c) => ({ title: c.title, url: c.url })),
    model: usage.model || "deepseek/deepseek-v4-flash",
  };
}

export async function suggestEmailReply(site: Site, body: string, subject?: string): Promise<CopilotSuggestion> {
  const question = [subject, body].filter(Boolean).join("\n\n");
  const chunks = question ? await retrieveChunks(site.id, question) : [];
  const context = chunks.slice(0, 6).map((c, i) => `[${i + 1}] ${c.title || c.url || "Source"}: ${c.content}`).join("\n\n");
  const usage = { provider: "openrouter", model: "deepseek/deepseek-v4-flash", credits: 1 };
  const raw = await completeChat(
    [
      { role: "system", content: "You are a concise support copilot drafting an email reply. Return only valid JSON with keys summary and reply." },
      { role: "user", content: `Draft a polite email reply for ${site.name || "this site"} about:\nSubject: ${subject || "(none)"}\n\n${body}\n\nSOURCES:\n${context || "(none)"}\nDo not invent facts. Sign off as the ${site.name || "support"} team, not as GhostChat.` },
    ],
    { site: cheapSite(site), json: true, fast: true, primary: true, hard: false, maxTokens: 500, temperature: 0.2, usage },
  );
  let summary = "A draft email is ready.";
  let reply = raw.trim();
  try {
    const parsed = JSON.parse(raw) as { summary?: string; reply?: string };
    if (parsed.summary) summary = String(parsed.summary).slice(0, 400);
    if (parsed.reply) reply = String(parsed.reply).slice(0, 4000);
  } catch { /* keep raw */ }
  return {
    summary,
    reply,
    sources: chunks.slice(0, 4).map((c) => ({ title: c.title, url: c.url })),
    model: usage.model || "deepseek/deepseek-v4-flash",
  };
}

