/** Official ~30-question eval set for the ghostchat.pro dogfood bot. */
import { getDb } from "./supabase.js";

export type EvalSeed = { question: string; expect: string };

/** Keyword checks against retrieved sources (and later, live answers). */
export const GHOSTCHAT_EVAL_QUESTIONS: EvalSeed[] = [
  { question: "What can ghostchat do", expect: "AI assistant; pages; leads; widget" },
  { question: "What is GhostChat?", expect: "AI assistant" },
  { question: "Tell me about this product", expect: "GhostChat; assistant" },
  { question: "What features does it have?", expect: "sources; widget" },
  { question: "How does GhostChat work?", expect: "crawl; widget" },
  { question: "How much does GhostChat cost?", expect: "£9; Pro" },
  { question: "What is the monthly price of GhostChat Pro?", expect: "£9" },
  { question: "How much is the Business plan?", expect: "£29" },
  { question: "Is there a free plan?", expect: "£0; 200" },
  { question: "What does the Pro plan include?", expect: "10 sites; 150 trained" },
  { question: "Do you have yearly billing?", expect: "£90; two months free" },
  { question: "How much is Pro if I pay yearly?", expect: "£90" },
  { question: "Is VAT included in the prices?", expect: "VAT; 20%" },
  { question: "Can I buy extra messages?", expect: "£5; credits" },
  { question: "How do I add the widget to my site?", expect: "widget.js; data-id" },
  { question: "Do I need to code?", expect: "copy; paste" },
  { question: "Does it work on Shopify?", expect: "Shopify" },
  { question: "Can I use it on WordPress or Wix?", expect: "WordPress; Wix" },
  { question: "How do I upgrade to Pro?", expect: "My account; Whop" },
  { question: "Can I cancel any time?", expect: "cancel" },
  { question: "Where does it get its answers?", expect: "crawled; content" },
  { question: "What happens when it doesn't know?", expect: "sure" },
  { question: "Does it show sources?", expect: "source" },
  { question: "Can it hand off to a human?", expect: "handoff; Discord" },
  { question: "Do you support WhatsApp or Instagram?", expect: "WhatsApp; Instagram" },
  { question: "Can I remove the Powered by GhostChat badge?", expect: "badge" },
  { question: "How many messages do I get on the free plan?", expect: "200" },
  { question: "What's the difference between Pro and Business?", expect: "10 sites; 50 sites" },
  { question: "how much does it cost", expect: "£9" },
  { question: "what can it do?", expect: "assistant; visitors" },
  { question: "is there a yearly discount?", expect: "two months free; £90" },
  { question: "How do I get started?", expect: "widget; free" },
];

export async function ensureGhostChatEvalQuestions(siteId: string): Promise<{ added: number; total: number }> {
  const db = getDb();
  const { data: existing, error } = await db
    .from("ghostchat_eval_questions")
    .select("id, question")
    .eq("site_id", siteId);
  if (error) throw error;
  const have = new Set((existing ?? []).map((r: { question: string }) => r.question.trim().toLowerCase()));
  const toAdd = GHOSTCHAT_EVAL_QUESTIONS.filter((q) => !have.has(q.question.trim().toLowerCase()));
  let sort = (existing ?? []).length;
  for (const row of toAdd) {
    if (sort >= 40) break;
    const { error: insErr } = await db.from("ghostchat_eval_questions").insert({
      site_id: siteId,
      question: row.question,
      expect: row.expect,
      sort,
    });
    if (insErr) throw insErr;
    sort++;
  }
  const { count } = await db.from("ghostchat_eval_questions").select("id", { count: "exact", head: true }).eq("site_id", siteId);
  return { added: toAdd.length, total: count ?? have.size + toAdd.length };
}
