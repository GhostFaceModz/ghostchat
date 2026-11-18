/** Built-in product FAQ for the official ghostchat.pro dogfood bot. Never auto-seeded onto customer sites. */
import { chunkText } from "./chunk.js";
import { contentHash, storeChunks, refreshCounts } from "./indexer.js";
import { getDb } from "./supabase.js";
import type { Site } from "../types.js";

export const GHOSTCHAT_PACK_FILENAME = "GhostChat product guide";
/** Shown as a source URL — this is a real public page, not a 404. */
export const GHOSTCHAT_PACK_URL = "https://ghostchat.pro/guide";
export const GHOSTCHAT_PACK_HOME = "https://ghostchat.pro/";

export type PackSection = { heading: string; url: string; text: string };

/** Visitor-facing facts taken from the public landing page and setup guide (repo content). */
export const GHOSTCHAT_PACK_SECTIONS: PackSection[] = [
  {
    heading: "What can GhostChat do?",
    url: GHOSTCHAT_PACK_HOME,
    text: `What can GhostChat do? GhostChat is a premium AI assistant that learns your pages, docs and FAQs, then answers visitors in your brand's voice, shows its sources, and turns conversations into leads. You train it in three ways: crawl your website, upload files, or paste notes. Paste one line of widget code and you're live on any site (including Shopify, Wix, Squarespace, WordPress and Webflow). Answers can link back to the page they came from. A free plan is available to start, with no card required. Paid plans add higher limits, conversion cards, live human handoff (Discord or the dashboard inbox), and the option to remove the "Powered by GhostChat" badge.`,
  },
  {
    heading: "Features",
    url: GHOSTCHAT_PACK_HOME,
    text: `GhostChat features: an on-site chat widget trained on your own content; source links on answers; lead capture and analytics; conversion cards (Pro and Business); live human handoff through Discord or the dashboard inbox (Pro and Business); Helpful or Strict answer modes (Helpful may use general knowledge for small talk and will say when something isn't from your site; Strict answers only from your content); optional WhatsApp and Instagram replies on the Business plan (you bring your own Meta Business app); and white-label plus a custom domain on Pro and Business. Site-specific facts (prices, policies, how your product works) always come from the content you give it.`,
  },
  {
    heading: "Plans and prices",
    url: GHOSTCHAT_PACK_HOME,
    text: `GhostChat plans and prices (GBP, billed monthly or yearly through Whop; yearly is two months free). VAT is added where it applies (20% in the UK). Cancel any time from My account; you keep your plan until the end of the period you paid for.

Free (Starter): £0 forever. 200 messages / month, 2 sites, 30 trained pages, 5 uploads, 15 leads / month, basic analytics, and a "Powered by GhostChat" badge.

Pro: £9 / month + VAT, or £90 / year + VAT (that's £7.50 / month, billed yearly). 5,000 messages / month, 10 sites, 150 trained pages, 1,000 leads / month, full analytics, 50 uploads, 20 conversion cards, live human handoff (Discord or dashboard inbox), and you can remove the badge.

Business: £29 / month + VAT, or £290 / year + VAT (that's £24.17 / month, billed yearly). 25,000 messages / month, 50 sites, 400 trained pages, 10,000 leads / month, full analytics, 200 uploads, 50 conversion cards, live human handoff, and you can remove the badge.

Need more messages later? Top up from My account — £5 for 1,000 messages or £15 for 5,000. Credits sit on your account until you use them.`,
  },
  {
    heading: "How to upgrade",
    url: GHOSTCHAT_PACK_HOME,
    text: `How do I upgrade GhostChat? Open My account in your dashboard and pick Pro (£9/month or £90/year) or Business (£29/month or £290/year), plus VAT where it applies (20% in the UK). Yearly billing is two months free. Checkout is handled by Whop, which shows the full total before you pay, and your new limits apply automatically. You can cancel from the same page at any time. Use the same email as your GhostChat account. If the plan didn't update, refresh the dashboard after a minute and check the email on your Whop purchase matches.`,
  },
  {
    heading: "How to install the widget",
    url: GHOSTCHAT_PACK_URL,
    text: `How do I add the GhostChat widget or install it on my site? You don't need to code. Copy one line from your dashboard and paste it into your site's HTML, or into the "custom code" box on Shopify, Wix, Squarespace, WordPress or Webflow. The snippet looks like: <script src="https://ghostchat.pro/widget.js" data-id="YOUR_SITE_KEY"></script> Replace YOUR_SITE_KEY with the site key from your dashboard. Free plan, no card required. A step-by-step walkthrough is on the setup guide at https://ghostchat.pro/guide.`,
  },
  {
    heading: "How it gets answers",
    url: GHOSTCHAT_PACK_HOME,
    text: `Where does GhostChat get its answers? Site-specific facts (prices, policies, how your product works) always come from the content you give it: crawled pages, uploaded files and pasted notes. Answers can link back to the page they came from. In the default Helpful mode it may also use general knowledge for small talk or explanations, and will say when something isn't from your site. Switch a bot to Strict in the dashboard if it should only ever answer from your content. When it doesn't know, it tells the visitor it isn't sure and can offer to take their email so you can follow up, so nobody gets a made-up answer.`,
  },
  {
    heading: "Integrations and channels",
    url: GHOSTCHAT_PACK_URL,
    text: `GhostChat integrations: the widget works on any website, including Shopify, Wix, Squarespace, WordPress and Webflow via a custom-code snippet. Pro and Business can turn off the "Powered by GhostChat" badge and use a custom chat domain. The Business plan can also answer WhatsApp and Instagram DMs with the same knowledge — that is off until you set it up, and it needs your own Meta Business app (Meta may charge for WhatsApp conversations). Live human handoff is available on Pro and Business through Discord or the dashboard inbox.`,
  },
  {
    heading: "Limits and usage",
    url: GHOSTCHAT_PACK_HOME,
    text: `GhostChat limits depend on your plan. The Free plan includes 200 messages per month, 2 sites, 30 trained pages, 5 uploads and 15 leads per month. Pro includes 5,000 messages, 10 sites, 150 trained pages, 50 uploads, 20 conversion cards and 1,000 leads per month. Business includes 25,000 messages, 50 sites, 400 trained pages, 200 uploads, 50 conversion cards and 10,000 leads per month. You can buy extra message credits from My account (£5 for 1,000 or £15 for 5,000) without changing plan.`,
  },
];

export function ghostchatKnowledgePackText(): string {
  return GHOSTCHAT_PACK_SECTIONS.map((s) => `${s.heading}\n\n${s.text}`).join("\n\n");
}

export function packChunks() {
  return GHOSTCHAT_PACK_SECTIONS.flatMap((s) =>
    chunkText(s.text, { title: "GhostChat", url: s.url, heading: s.heading }),
  );
}

type ExistingPack = { id: string; content_hash: string | null; chunk_count: number | null };

/** Upsert the official product FAQ for a site (the ghostchat.pro dogfood bot). */
export async function ensureGhostChatKnowledgePack(site: Pick<Site, "id">): Promise<{ seeded: boolean; chunks: number; reason: string }> {
  const text = ghostchatKnowledgePackText();
  const hash = contentHash(text);
  const chunks = packChunks();
  if (!chunks.length) return { seeded: false, chunks: 0, reason: "empty pack" };

  const db = getDb();
  const { data: existing, error: findErr } = await db
    .from("ghostchat_documents")
    .select("id, content_hash, chunk_count")
    .eq("site_id", site.id)
    .eq("source_type", "faq")
    .eq("filename", GHOSTCHAT_PACK_FILENAME)
    .is("deleted_at", null)
    .maybeSingle();
  if (findErr) throw findErr;
  const doc = existing as ExistingPack | null;
  if (doc && doc.content_hash === hash && Number(doc.chunk_count || 0) > 0) {
    return { seeded: false, chunks: Number(doc.chunk_count), reason: "up to date" };
  }

  let documentId = doc?.id;
  if (doc) {
    await db.from("ghostchat_chunks").delete().eq("document_id", doc.id);
    const { error } = await db.from("ghostchat_documents").update({
      filename: GHOSTCHAT_PACK_FILENAME,
      source_url: GHOSTCHAT_PACK_URL,
      source_type: "faq",
      content_hash: hash,
      byte_size: text.length,
      chunk_count: chunks.length,
    }).eq("id", doc.id);
    if (error) throw error;
  } else {
    const { data: created, error } = await db.from("ghostchat_documents").insert({
      site_id: site.id,
      filename: GHOSTCHAT_PACK_FILENAME,
      source_url: GHOSTCHAT_PACK_URL,
      source_type: "faq",
      content_hash: hash,
      byte_size: text.length,
      chunk_count: chunks.length,
    }).select("id").single();
    if (error) throw error;
    documentId = created.id;
  }
  const stored = await storeChunks({ site, documentId: documentId!, sourceType: "faq", chunks });
  await refreshCounts(site.id);
  return { seeded: true, chunks: stored, reason: doc ? "updated" : "created" };
}
