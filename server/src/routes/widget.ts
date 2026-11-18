import { Router } from "express";
import QRCode from "qrcode";
import { getDb } from "../lib/supabase.js";
import { effectiveBranding, effectiveDisclosure } from "../lib/usage.js";
import { sanitizeLauncher } from "../lib/launcher.js";
import { sanitizeHeader } from "../lib/widgetHeader.js";
import { sanitizeGa4Id, sanitizePlausibleDomain } from "../lib/widgetAnalytics.js";
import { config } from "../config.js";
import { BOT_TEMPLATES } from "../lib/templates.js";
import { botMode, supportSettings } from "../lib/modes.js";
import { suggestionLimit } from "../lib/chat.js";
import type { Site } from "../types.js";
import { siteHostsFrom, openSiteLinksMode } from "../lib/siteLinks.js";
import { clipPageUrl, recordWidgetSeen } from "../lib/widgetHealth.js";
import { loadSiteByPublicKey } from "../lib/staging.js";

export const widgetRouter = Router();

widgetRouter.get("/templates", (_req, res) => {
  res.json({ templates: BOT_TEMPLATES });
});

widgetRouter.get("/config/:siteKey", async (req, res) => {
  const siteKey = String(req.params.siteKey || "");
  let site: Site;
  try {
    const found = await loadSiteByPublicKey(siteKey);
    if (!found) return res.status(404).json({ error: "Unknown site key." });
    site = found;
  } catch {
    return res.status(500).json({ error: "Could not load widget config." });
  }
  const page = clipPageUrl(String(req.query.page || req.get("referer") || ""));
  if (!site.staging) {
    recordWidgetSeen(site.id, page, { last_widget_seen_at: site.last_widget_seen_at, last_widget_page: site.last_widget_page }).catch(() => {});
  }
  res.json({
    config: {
      name: site.name,
      greeting: site.greeting,
      theme: { ...site.theme, launcher: sanitizeLauncher(site.theme && site.theme.launcher, site.plan), header: sanitizeHeader(site.theme && site.theme.header, site.plan, site.name) },
      header: sanitizeHeader(site.theme && site.theme.header, site.plan, site.name),
      starterQuestions: site.starter_questions ?? [],
      proactiveDelayMs: site.proactive_delay_ms,
      soundDefault: site.sound_default,
      showBranding: effectiveBranding(site),
      aiDisclosure: effectiveDisclosure(site),
      plausibleDomain: sanitizePlausibleDomain(site.plausible_domain || ""),
      ga4Id: sanitizeGa4Id(site.ga4_id || ""),
      bookingUrl: site.booking_url || null,
      bookingProvider: site.booking_provider || null,
      // Voice mode is a Pro feature (browser speech APIs; the widget falls back gracefully).
      voiceEnabled: Boolean(config.voiceEnabled && site.voice_enabled && site.plan !== "free"),
      // Per-reply listen button; separate from Pro voice mode (mic + auto-speak). Default on.
      readAloudEnabled: site.read_aloud_enabled !== false,
      greetings: Array.isArray(site.greetings) ? site.greetings : [],
      memory: site.memory_enabled !== false,
      multilingual: site.multilingual !== false,
      liveLookup: site.live_lookup !== false,
      mode: botMode(site),
      // Support quick replies respect the chip limit (2 by default, owner can raise it to 3).
      quickReplies: botMode(site) === "support" ? supportSettings(site).quick_replies.slice(0, suggestionLimit(site)) : [],
      csat: botMode(site) === "support" ? supportSettings(site).csat : null,
      supportGreeting: botMode(site) === "support" ? supportSettings(site).greeting : null,
      openSiteLinks: openSiteLinksMode((site as Site).open_site_links),
      siteUrl: site.url || null,
      siteHosts: siteHostsFrom(site.url, (site as Site).custom_domain),
      staging: Boolean(site.staging),
    },
  });
});

widgetRouter.get("/qr/:siteKey", async (req, res) => {
  const siteKey = String(req.params.siteKey || "");
  const { data } = await getDb().from("ghostchat_sites").select("site_key").eq("site_key", siteKey).maybeSingle();
  if (!data) return res.status(404).json({ error: "Unknown site key." });
  const shareUrl = `${config.publicUrl}/c/${encodeURIComponent(siteKey)}`;
  const format = String(req.query.format || "svg");
  try {
    if (format === "png") {
      const buf = await QRCode.toBuffer(shareUrl, { type: "png", width: 480, margin: 1, color: { dark: "#12081f", light: "#ffffff" } });
      res.setHeader("content-type", "image/png");
      res.setHeader("cache-control", "public, max-age=3600");
      res.send(buf);
      return;
    }
    const svg = await QRCode.toString(shareUrl, { type: "svg", margin: 1, color: { dark: "#12081f", light: "#ffffff" } });
    res.setHeader("content-type", "image/svg+xml");
    res.setHeader("cache-control", "public, max-age=3600");
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: "Could not create the QR code." });
  }
});
