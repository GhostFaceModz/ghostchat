import { Router, type Request } from "express";
import multer from "multer";
import { PLAN_LIMITS, type Plan } from "../config.js";
import { getDb } from "../lib/supabase.js";
import { newSiteKey, type AuthedRequest } from "../lib/auth.js";
import { crawlSite, type CrawlScope } from "../lib/crawl.js";
import { normalizeTools, runTool, fillTemplate } from "../lib/siteTools.js";
import { classifyIntent } from "../lib/intent.js";
import { chunkText } from "../lib/chunk.js";
import { storeChunks, refreshCounts, indexPages } from "../lib/indexer.js";
import { assertPublicHttpUrl } from "../lib/ssrf.js";
import { clientIp, rateLimitAsync } from "../lib/rateLimit.js";
import { countOwnerSites, countUploads, messageLimit, refreshPeriod, effectiveBranding } from "../lib/usage.js";
import { getTemplate } from "../lib/templates.js";
import { extractPdfText, isPdfFile } from "../lib/pdf.js";
import { importNotionPage } from "../lib/notion.js";
import { detectBookingProvider, normalizeCards } from "../lib/cards.js";
import { analyticsLevel, getOwnerPlan, maxCards } from "../lib/usage.js";
import { computeAnalytics, type LogRow } from "../lib/analytics.js";
import { SCHEDULES } from "../lib/recrawl.js";
import { normalizeGreetings } from "../lib/greetings.js";
import { normalizeChatForm } from "../lib/forms.js";
import { BOT_MODES, normalizeSupport } from "../lib/modes.js";
import { normalizeChannels } from "../lib/meta.js";
import { saveCorrection } from "../lib/corrections.js";
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
  if (typeof body.read_aloud_enabled === "boolean") patch.read_aloud_enabled = body.read_aloud_enabled;
  if (typeof body.booking_url === "string") {
    const booking = body.booking_url.trim();
    patch.booking_url = booking || null;
    patch.booking_provider = booking ? detectBookingProvider(booking) : null;
  }
  if (Array.isArray(body.conversion_cards)) {
    patch.conversion_cards = normalizeCards(body.conversion_cards, maxCards(site));
  }
  if (typeof body.chat_provider === "string") patch.chat_provider = body.chat_provider.trim() || null;
  if (body.answer_mode === "helpful" || body.answer_mode === "strict") patch.answer_mode = body.answer_mode;
  if (body.open_site_links === "same_tab" || body.open_site_links === "new_tab") patch.open_site_links = body.open_site_links;
  if (typeof body.reveal_model === "boolean") patch.reveal_model = body.reveal_model;
  if ([0, 1, 3].includes(Number(body.max_sources)) && body.max_sources !== null && body.max_sources !== "") patch.max_sources = Number(body.max_sources);
  if (Number.isInteger(Number(body.max_suggestions)) && Number(body.max_suggestions) >= 0 && Number(body.max_suggestions) <= 3 && body.max_suggestions !== null && body.max_suggestions !== "") patch.max_suggestions = Number(body.max_suggestions);
  if (Array.isArray(body.search_tools)) {
    try {
      patch.search_tools = await normalizeTools(body.search_tools);
    } catch (err) {
      return res.status(400).json({ error: `Search tool: ${(err as Error).message}` });
    }
  }
  if (body.crawl_scope && typeof body.crawl_scope === "object") {
    try {
      patch.crawl_scope = await normalizeScope(body.crawl_scope, patch.url as string | undefined || site.url);
    } catch (err) {
      return res.status(400).json({ error: `Crawl scope: ${(err as Error).message}` });
    }
  }
  if (typeof body.chat_model === "string") patch.chat_model = body.chat_model.trim() || null;
  // ---- v2 settings ----
  if (SCHEDULES.includes(body.recrawl_schedule)) patch.recrawl_schedule = body.recrawl_schedule;
  if (typeof body.live_lookup === "boolean") patch.live_lookup = body.live_lookup;
  if (typeof body.lookup_search_url === "string") {
    const raw = body.lookup_search_url.trim();
    if (!raw) patch.lookup_search_url = null;
    else {
      try {
        const u = new URL(raw, patch.url as string || site.url);
        if (u.host !== new URL(patch.url as string || site.url).host) throw new Error("must be on your site's domain");
        if (!u.href.includes("%7Bquery%7D") && !raw.includes("{query}")) throw new Error("include {query} where the search words go");
        await assertPublicHttpUrl(u.href.replace(/%7Bquery%7D/g, "x"));
        patch.lookup_search_url = u.href.replace(/%7Bquery%7D/g, "{query}");
      } catch (err) {
        return res.status(400).json({ error: `Site search URL: ${(err as Error).message}` });
      }
    }
  }
  if (Array.isArray(body.greetings)) patch.greetings = normalizeGreetings(body.greetings);
  if (body.chat_form && typeof body.chat_form === "object") patch.chat_form = normalizeChatForm(body.chat_form);
  if (typeof body.memory_enabled === "boolean") patch.memory_enabled = body.memory_enabled;
  if (typeof body.multilingual === "boolean") patch.multilingual = body.multilingual;
  if (typeof body.custom_domain === "string") {
    const d = body.custom_domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (d && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) return res.status(400).json({ error: "Enter a domain like chat.yoursite.com" });
    if (d && PLAN_LIMITS[site.plan].brandingRequired) return res.status(402).json({ error: "Custom domains are a Pro feature." });
    patch.custom_domain = d || null;
  }
  if (BOT_MODES.includes(body.bot_mode)) patch.bot_mode = body.bot_mode;
  if (body.support && typeof body.support === "object") patch.support = normalizeSupport(body.support, site.support);
  if (body.channels && typeof body.channels === "object") patch.channels = normalizeChannels(body.channels, site.plan);
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

/** Try a search tool from the builder before saving it: returns the first mapped results. */
sitesRouter.post("/:id/tools/test", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const rl = await rateLimitAsync(`tooltest:${site.id}`, 20, 60_000);
  if (!rl.ok) return res.status(429).json({ error: "Too many tests. Try again in a minute." });
  try {
    const [tool] = await normalizeTools([req.body?.tool]);
    if (!tool) return res.status(400).json({ error: "Add a URL first." });
    const sample = String(req.body?.message || "").trim().slice(0, 300);
    const intent = sample ? await classifyIntent(sample) : { filters: { query: "test" } };
    const items = await runTool(tool, intent.filters);
    res.json({ url: tool.kind === "feed" ? tool.url_template : fillTemplate(tool.url_template, intent.filters), filters: intent.filters, intent: "intent" in intent ? intent.intent : null, items: items.slice(0, 8) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

async function normalizeScope(raw: Record<string, unknown>, siteUrl: string): Promise<CrawlScope> {
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]+/) : []).map((x) => String(x).trim()).filter((x) => x.startsWith("/")).slice(0, 20).map((x) => x.slice(0, 120));
  const scope: CrawlScope = { include: list(raw.include), exclude: list(raw.exclude), page_chunks: raw.page_chunks === true };
  const sm = typeof raw.sitemap_url === "string" ? raw.sitemap_url.trim() : "";
  if (sm) {
    const u = await assertPublicHttpUrl(new URL(sm, siteUrl).href);
    if (u.host !== new URL(siteUrl).host) throw new Error("The sitemap must be on your site's domain");
    scope.sitemap_url = u.href;
  }
  return scope;
}

sitesRouter.post("/:id/crawl", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const rl = await rateLimitAsync(`crawl:${site.id}`, 5, 60 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Crawl limit reached. Try again in a bit." });

  const db = getDb();
  await db
    .from("ghostchat_sites")
    .update({ crawl_status: "crawling", crawl_error: null, updated_at: new Date().toISOString() })
    .eq("id", site.id);

  // Respond after starting? For MVP we run inline so the dashboard can show the result.
  // Keep it synchronous but robust.
  try {
    const scope = (site.crawl_scope as CrawlScope | undefined) || undefined;
    const result = await crawlSite(site.url, site.plan, scope);
    // Incremental: only new or changed pages are re-embedded; pages that disappeared are removed. Uploads stay.
    const summary = await indexPages(site, result.pages, { sourceType: "crawl", removeMissing: true, scope });
    const { count: storedCount } = await db.from("ghostchat_chunks").select("id", { count: "exact", head: true }).eq("site_id", site.id).eq("source_type", "crawl");
    const stored = storedCount ?? summary.chunks;
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
      changes: summary,
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
  const rl = await rateLimitAsync(`docs:${site.id}:${ip}`, 20, 60 * 60 * 1000);
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
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: logs, error }, { data: leads }, { data: csat }, { data: tickets }] = await Promise.all([
    db.from("ghostchat_logs").select("id, session_id, role, message, was_unsure, feedback, page_url, created_at, lang")
      .eq("site_id", site.id).gte("created_at", since).order("created_at", { ascending: false }).limit(3000),
    db.from("ghostchat_leads").select("session_id").eq("site_id", site.id).gte("created_at", since).limit(2000),
    db.from("ghostchat_csat").select("rating").eq("site_id", site.id).gte("created_at", since).limit(2000),
    db.from("ghostchat_tickets").select("status").eq("site_id", site.id).limit(2000),
  ]);
  if (error) return res.status(500).json({ error: "Could not load analytics." });
  const tz = typeof req.query.tz === "string" && /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(req.query.tz) ? req.query.tz : "Europe/London";
  const a = computeAnalytics({
    logs: (logs ?? []) as LogRow[], leads: (leads ?? []).length,
    leadSessions: (leads ?? []).map((l: { session_id: string | null }) => l.session_id || ""),
    csat: (csat ?? []).map((c: { rating: number }) => c.rating), tickets: (tickets ?? []) as Array<{ status: string }>, timeZone: tz,
  });
  const pages = new Map<string, number>();
  for (const row of (logs ?? []) as LogRow[]) if (row.role === "user" && row.page_url) pages.set(row.page_url, (pages.get(row.page_url) ?? 0) + 1);
  const fresh = await refreshPeriod(site);
  const level = analyticsLevel(fresh);
  const full = level === "full";
  res.json({
    analytics: {
      ...a,
      questionsByPage: full ? [...pages.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15).map(([url, count]) => ({ url, count })) : [],
      lowConfidence: full ? a.lowConfidence : a.lowConfidence.slice(0, 3),
      unanswered: a.lowConfidence.filter((x) => x.reason === "unsure").slice(0, 25).map((x) => ({ id: x.logId, message: x.question || x.answer, created_at: x.created_at })),
      totals: { ...a.totals, leads: fresh.leads_this_period, messagesThisPeriod: fresh.messages_this_period, messageLimit: messageLimit(fresh), plan: fresh.plan },
      level,
      upgradeHint: full ? null : "Upgrade to Pro for the full low-confidence list, pages driving questions and longer history.",
    },
  });
});

// ---- "Fix this answer": owner corrections ----
sitesRouter.get("/:id/corrections", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const { data, error } = await getDb().from("ghostchat_corrections").select("id, question, answer, log_id, created_at, updated_at")
    .eq("site_id", site.id).order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: "Could not load corrections." });
  res.json({ corrections: data ?? [] });
});

sitesRouter.post("/:id/corrections", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const rl = await rateLimitAsync(`fix:${site.id}`, 60, 60 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many corrections at once. Try again shortly." });
  let question = String(req.body?.question || "");
  const logId = typeof req.body?.logId === "string" ? req.body.logId : null;
  if (!question.trim() && logId) {
    // Find the visitor question that led to this reply.
    const { data: log } = await getDb().from("ghostchat_logs").select("session_id, created_at").eq("id", logId).eq("site_id", site.id).maybeSingle();
    if (log) {
      const { data: prev } = await getDb().from("ghostchat_logs").select("message").eq("site_id", site.id).eq("session_id", log.session_id)
        .eq("role", "user").lte("created_at", log.created_at).order("created_at", { ascending: false }).limit(1).maybeSingle();
      question = prev?.message || "";
    }
  }
  try {
    const correction = await saveCorrection(site.id, { question, answer: String(req.body?.answer || ""), logId, id: req.body?.id || null });
    res.status(201).json({ correction });
  } catch (err) {
    res.status((err as Error & { status?: number }).status ?? 500).json({ error: (err as Error).message || "Could not save the correction." });
  }
});

sitesRouter.delete("/:id/corrections/:cid", async (req, res) => {
  const site = await loadOwnedSite(req, req.params.id);
  if (!site) return res.status(404).json({ error: "Site not found." });
  const { error } = await getDb().from("ghostchat_corrections").delete().eq("id", req.params.cid).eq("site_id", site.id);
  if (error) return res.status(500).json({ error: "Could not delete the correction." });
  res.json({ ok: true });
});
