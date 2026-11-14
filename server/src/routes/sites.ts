import { Router, type Request } from "express";
import multer from "multer";
import { PLAN_LIMITS, type Plan } from "../config.js";
import { getDb } from "../lib/supabase.js";
import { newSiteKey, type AuthedRequest } from "../lib/auth.js";
import { crawlSite } from "../lib/crawl.js";
import { chunkText } from "../lib/chunk.js";
import { embedTexts } from "../lib/ai.js";
import { assertPublicHttpUrl } from "../lib/ssrf.js";
import { clientIp, rateLimit } from "../lib/rateLimit.js";
import { countOwnerSites, countUploads, messageLimit, refreshPeriod, effectiveBranding } from "../lib/usage.js";
import { getTemplate } from "../lib/templates.js";
import { extractPdfText, isPdfFile } from "../lib/pdf.js";
import { importNotionPage } from "../lib/notion.js";
import { detectBookingProvider, normalizeCards } from "../lib/cards.js";
import { analyticsLevel, getOwnerPlan, maxCards } from "../lib/usage.js";
import type { Site, Theme } from "../types.js";

export const sitesRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5_000_000, files: 5 },
});

const DEFAULT_THEME: Theme = { mode: "dark", primary: "#a78bfa" };

function ownerId(req: Request): string {
  return (req as unknown as AuthedRequest).owner.id;
}

async function loadOwnedSite(req: Request, id: string): Promise<Site | null> {
  const { data, error } = await getDb()
    .from("ghostchat_sites")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId(req))
    .maybeSingle();
  if (error) throw error;
  return (data as Site) ?? null;
}

function publicSite(site: Site) {
  return {
    ...site,
    show_branding: effectiveBranding(site),
    message_limit: messageLimit(site),
  };
}

sitesRouter.get("/", async (req, res) => {
  const { data, error } = await getDb()
    .from("ghostchat_sites")
    .select("*")
    .eq("owner_id", ownerId(req))
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "Could not load sites." });
  res.json({ sites: (data as Site[]).map(publicSite) });
});

sitesRouter.post("/", async (req, res) => {
  const owner = (req as unknown as AuthedRequest).owner;
  const { count } = await getDb()
    .from("ghostchat_sites")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", owner.id);
  // New owners start on the free plan.
  const existing = await countOwnerSites(owner.id);
  if (existing >= PLAN_LIMITS.free.maxSites && (count ?? 0) >= PLAN_LIMITS.free.maxSites) {
    // If they already have a higher-plan site, use the highest plan they own.
  }
  const plan: Plan = await getOwnerPlan(owner.id);
  if (existing >= PLAN_LIMITS[plan].maxSites) {
    return res.status(402).json({ error: "You've reached the site limit for your plan." });
  }

  const urlRaw = String(req.body?.url || "").trim();
  const name = String(req.body?.name || "").trim() || undefined;
  if (!urlRaw) return res.status(400).json({ error: "A site URL is required." });
  let url: URL;
  try {
    url = await assertPublicHttpUrl(urlRaw.startsWith("http") ? urlRaw : `https://${urlRaw}`);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  const theme = { ...DEFAULT_THEME, ...(req.body?.theme && typeof req.body.theme === "object" ? req.body.theme : {}) };
  const tmpl = getTemplate(req.body?.template);
  const { data, error } = await getDb()
    .from("ghostchat_sites")
    .insert({
      owner_id: owner.id,
      name: name || url.hostname,
      url: url.href,
      site_key: newSiteKey(),
      theme,
      greeting: req.body?.greeting || tmpl?.greeting || `Hi — I'm the ${name || url.hostname} assistant. How can I help?`,
      persona: req.body?.persona || tmpl?.persona || null,
      tone: req.body?.tone || tmpl?.tone || "friendly",
      guardrails: req.body?.guardrails || tmpl?.guardrails || null,
      banned_topics: Array.isArray(req.body?.banned_topics) ? req.body.banned_topics : (tmpl?.banned_topics ?? []),
      starter_questions: Array.isArray(req.body?.starter_questions) ? req.body.starter_questions : (tmpl?.starter_questions ?? []),
      plan,
    })
    .select("*")
    .single();
  if (error) return res.status(500).json({ error: "Could not create the site." });
  res.status(201).json({ site: publicSite(data as Site) });
});

sitesRouter.get("/:id", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  res.json({ site: publicSite(await refreshPeriod(site)) });
});

sitesRouter.patch("/:id", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });

  const body = req.body || {};
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") patch.name = body.name.trim() || site.name;
  if (typeof body.greeting === "string") patch.greeting = body.greeting;
  if (typeof body.persona === "string") patch.persona = body.persona;
  if (typeof body.tone === "string") patch.tone = body.tone;
  if (typeof body.guardrails === "string") patch.guardrails = body.guardrails;
  if (Array.isArray(body.banned_topics)) {
    patch.banned_topics = body.banned_topics.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 40);
  }
  if (Array.isArray(body.starter_questions)) {
    patch.starter_questions = body.starter_questions.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 8);
  }
  if (typeof body.proactive_delay_ms === "number") {
    patch.proactive_delay_ms = Math.min(60000, Math.max(0, Math.round(body.proactive_delay_ms)));
  }
  if (typeof body.sound_default === "boolean") patch.sound_default = body.sound_default;
  if (body.theme && typeof body.theme === "object") patch.theme = { ...site.theme, ...body.theme };
  if (typeof body.show_branding === "boolean") {
    const limits = PLAN_LIMITS[site.plan];
    patch.show_branding = limits.brandingRequired ? true : body.show_branding;
  }
  if (typeof body.voice_enabled === "boolean") patch.voice_enabled = body.voice_enabled;
  if (typeof body.booking_url === "string") {
    const booking = body.booking_url.trim();
    patch.booking_url = booking || null;
    patch.booking_provider = booking ? detectBookingProvider(booking) : null;
  }
  if (Array.isArray(body.conversion_cards)) {
    patch.conversion_cards = normalizeCards(body.conversion_cards, maxCards(site));
  }
  if (typeof body.chat_provider === "string") patch.chat_provider = body.chat_provider.trim() || null;
  if (typeof body.chat_model === "string") patch.chat_model = body.chat_model.trim() || null;
  if (typeof body.url === "string" && body.url.trim()) {
    try {
      const url = await assertPublicHttpUrl(body.url.trim().startsWith("http") ? body.url.trim() : `https://${body.url.trim()}`);
      patch.url = url.href;
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  const { data, error } = await getDb()
    .from("ghostchat_sites")
    .update(patch)
    .eq("id", site.id)
    .select("*")
    .single();
  if (error) return res.status(500).json({ error: "Could not update the site." });
  res.json({ site: publicSite(data as Site) });
});

async function storeChunks(opts: {
  site: Site;
  documentId: string;
  sourceType: string;
  chunks: Array<{ title: string; url: string | null; content: string; tokenCount: number }>;
}): Promise<number> {
  if (!opts.chunks.length) return 0;
  const vectors = await embedTexts(opts.chunks.map((c) => c.content));
  const rows = opts.chunks.map((chunk, i) => ({
    site_id: opts.site.id,
    document_id: opts.documentId,
    url: chunk.url,
    title: chunk.title,
    content: chunk.content,
    token_count: chunk.tokenCount,
    source_type: opts.sourceType,
    embedding: vectors[i],
  }));
  const batchSize = 80;
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await getDb().from("ghostchat_chunks").insert(rows.slice(i, i + batchSize));
    if (error) throw error;
  }
  return rows.length;
}

async function refreshCounts(siteId: string): Promise<void> {
  const db = getDb();
  const [{ count: chunks }, { count: docs }] = await Promise.all([
    db.from("ghostchat_chunks").select("id", { count: "exact", head: true }).eq("site_id", siteId),
    db.from("ghostchat_documents").select("id", { count: "exact", head: true }).eq("site_id", siteId).eq("source_type", "crawl"),
  ]);
  await db
    .from("ghostchat_sites")
    .update({
      chunk_count: chunks ?? 0,
      page_count: docs ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId);
}

sitesRouter.post("/:id/crawl", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const rl = rateLimit(`crawl:${site.id}`, 5, 60 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Crawl limit reached. Try again in a bit." });

  const db = getDb();
  await db
    .from("ghostchat_sites")
    .update({ crawl_status: "crawling", crawl_error: null, updated_at: new Date().toISOString() })
    .eq("id", site.id);

  // Respond after starting? For MVP we run inline so the dashboard can show the result.
  // Keep it synchronous but robust.
  try {
    const result = await crawlSite(site.url, site.plan);
    // Replace previous crawl documents + chunks, keep uploads.
    const { data: oldDocs } = await db
      .from("ghostchat_documents")
      .select("id")
      .eq("site_id", site.id)
      .eq("source_type", "crawl");
    const oldIds = (oldDocs ?? []).map((d: { id: string }) => d.id);
    if (oldIds.length) {
      await db.from("ghostchat_chunks").delete().in("document_id", oldIds);
      await db.from("ghostchat_documents").delete().in("id", oldIds);
    }

    let stored = 0;
    for (const page of result.pages) {
      const pageChunks = result.chunks.filter((c) => c.sourceUrl === page.url);
      const { data: doc, error } = await db
        .from("ghostchat_documents")
        .insert({
          site_id: site.id,
          filename: page.title,
          source_type: "crawl",
          source_url: page.url,
          byte_size: page.text.length,
          chunk_count: pageChunks.length,
        })
        .select("id")
        .single();
      if (error) throw error;
      stored += await storeChunks({
        site,
        documentId: doc.id,
        sourceType: "crawl",
        chunks: pageChunks,
      });
    }

    await db
      .from("ghostchat_sites")
      .update({
        crawl_status: stored ? "ready" : "error",
        crawl_error: stored ? null : "No usable text was found on the site.",
        last_crawled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", site.id);
    await refreshCounts(site.id);
    const fresh = await loadOwnedSite(req, site.id);
    res.json({
      site: fresh ? publicSite(fresh) : null,
      pages: result.pages.length,
      chunks: stored,
      errors: result.errors.slice(0, 10),
    });
  } catch (err) {
    await db
      .from("ghostchat_sites")
      .update({
        crawl_status: "error",
        crawl_error: (err as Error).message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", site.id);
    res.status(500).json({ error: (err as Error).message || "Crawl failed." });
  }
});

sitesRouter.get("/:id/documents", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const { data, error } = await getDb()
    .from("ghostchat_documents")
    .select("id, filename, source_type, source_url, byte_size, chunk_count, created_at")
    .eq("site_id", site.id)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "Could not load documents." });
  res.json({ documents: data ?? [] });
});

sitesRouter.post("/:id/documents", upload.array("files", 5), async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const ip = clientIp(req);
  const rl = rateLimit(`docs:${site.id}:${ip}`, 20, 60 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Upload limit reached. Try again later." });

  const existing = await countUploads(site.id);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const pastedTitle = String(req.body?.title || "").trim() || "Pasted document";
  const pastedText = String(req.body?.text || "").trim();
  const incoming = files.length + (pastedText ? 1 : 0);
  if (!incoming) return res.status(400).json({ error: "Attach a text file or paste some content." });
  if (existing + incoming > PLAN_LIMITS[site.plan].maxUploads) {
    return res.status(402).json({ error: "You've reached the upload limit for your plan." });
  }

  const created: unknown[] = [];
  const process = async (filename: string, text: string, sourceType: "upload" | "paste" | "pdf" | "notion", sourceUrl: string | null = null) => {
    const chunks = chunkText(text, { title: filename, url: null });
    if (!chunks.length) throw new Error(`No usable text in ${filename}`);
    const { data: doc, error } = await getDb()
      .from("ghostchat_documents")
      .insert({
        site_id: site.id,
        filename,
        source_type: sourceType,
        source_url: sourceUrl,
        byte_size: text.length,
        chunk_count: chunks.length,
      })
      .select("*")
      .single();
    if (error) throw error;
    await storeChunks({ site, documentId: doc.id, sourceType, chunks });
    created.push(doc);
  };

  try {
    for (const file of files) {
      const name = file.originalname || "upload.txt";
      if (isPdfFile(name, file.mimetype)) {
        const text = await extractPdfText(file.buffer, name);
        await process(name, text, "pdf");
        continue;
      }
      if (!/\.(txt|md|markdown|html?|csv)$/i.test(name) && !file.mimetype.startsWith("text/")) {
        return res.status(400).json({ error: `Unsupported file type: ${name}. Use .pdf, .txt, .md, .html or .csv.` });
      }
      await process(name, file.buffer.toString("utf8"), "upload");
    }
    if (pastedText) await process(pastedTitle, pastedText, "paste");
    await refreshCounts(site.id);
    res.status(201).json({ documents: created });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || "Could not train on that document." });
  }
});


sitesRouter.post("/:id/documents/notion", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const existing = await countUploads(site.id);
  if (existing + 1 > PLAN_LIMITS[site.plan].maxUploads) {
    return res.status(402).json({ error: "You've reached the upload limit for your plan." });
  }
  const page = String(req.body?.url || req.body?.pageId || req.body?.page_id || "").trim();
  if (!page) return res.status(400).json({ error: "Paste a Notion page URL or ID." });
  try {
    const imported = await importNotionPage(page);
    const chunks = chunkText(imported.text, { title: imported.title, url: imported.url });
    if (!chunks.length) throw new Error("No usable text in that Notion page.");
    const { data: doc, error } = await getDb()
      .from("ghostchat_documents")
      .insert({
        site_id: site.id,
        filename: imported.title,
        source_type: "notion",
        source_url: imported.url,
        byte_size: imported.text.length,
        chunk_count: chunks.length,
      })
      .select("*")
      .single();
    if (error) throw error;
    await storeChunks({ site, documentId: doc.id, sourceType: "notion", chunks });
    await refreshCounts(site.id);
    res.status(201).json({ document: doc });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message || "Could not import that Notion page." });
  }
});

sitesRouter.delete("/:id/documents/:docId", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const { error } = await getDb()
    .from("ghostchat_documents")
    .delete()
    .eq("id", req.params.docId)
    .eq("site_id", site.id);
  if (error) return res.status(500).json({ error: "Could not delete the document." });
  await refreshCounts(site.id);
  res.json({ ok: true });
});

sitesRouter.get("/:id/logs", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const { data, error } = await getDb()
    .from("ghostchat_logs")
    .select("id, session_id, role, message, sources, was_unsure, feedback, created_at")
    .eq("site_id", site.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: "Could not load transcripts." });
  res.json({ logs: data ?? [] });
});

sitesRouter.get("/:id/leads", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const { data, error } = await getDb()
    .from("ghostchat_leads")
    .select("id, session_id, email, name, notes, transcript, created_at")
    .eq("site_id", site.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: "Could not load leads." });
  res.json({ leads: data ?? [] });
});

sitesRouter.get("/:id/analytics", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const db = getDb();
  const { data: logs, error } = await db
    .from("ghostchat_logs")
    .select("id, role, message, was_unsure, feedback, page_url, created_at")
    .eq("site_id", site.id)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return res.status(500).json({ error: "Could not load analytics." });

  const rows = logs ?? [];
  const questions = new Map<string, number>();
  const unanswered: Array<{ id: string; message: string; created_at: string }> = [];
  let up = 0;
  let down = 0;
  let assistant = 0;
  for (const row of rows) {
    if (row.role === "user") {
      const key = String(row.message || "").trim().toLowerCase();
      if (key) questions.set(key, (questions.get(key) ?? 0) + 1);
    }
    if (row.role === "assistant") {
      assistant += 1;
      if (row.was_unsure) unanswered.push({ id: row.id, message: row.message, created_at: row.created_at });
      if (row.feedback === "up") up += 1;
      if (row.feedback === "down") down += 1;
    }
  }
  const pages = new Map<string, number>();
  for (const row of rows) {
    if (row.role === "user" && row.page_url) {
      pages.set(row.page_url, (pages.get(row.page_url) ?? 0) + 1);
    }
  }
  const topQuestions = [...questions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));
  const questionsByPage = [...pages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([url, count]) => ({ url, count }));

  const fresh = await refreshPeriod(site);
  const level = analyticsLevel(fresh);
  res.json({
    analytics: {
      topQuestions,
      questionsByPage: level === "full" ? questionsByPage : [],
      unanswered: level === "full" ? unanswered.slice(0, 25) : [],
      satisfaction: level === "full" ? {
        up,
        down,
        rated: up + down,
        score: up + down ? Math.round((up / (up + down)) * 100) : null,
      } : { up: 0, down: 0, rated: 0, score: null },
      totals: {
        messages: rows.length,
        assistant,
        leads: fresh.leads_this_period,
        messagesThisPeriod: fresh.messages_this_period,
        messageLimit: messageLimit(fresh),
        plan: fresh.plan,
      },
      level,
      upgradeHint: level === "basic" ? "Upgrade to Pro to see pages driving questions, unanswered gaps, and satisfaction scores." : null,
    },
  });
});
