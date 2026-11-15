import { Router } from "express";
import QRCode from "qrcode";
import { getDb } from "../lib/supabase.js";
import { effectiveBranding } from "../lib/usage.js";
import { config } from "../config.js";
import { BOT_TEMPLATES } from "../lib/templates.js";
import { botMode, supportSettings } from "../lib/modes.js";
import { suggestionLimit } from "../lib/chat.js";
import type { Site } from "../types.js";
import { siteHostsFrom, openSiteLinksMode } from "../lib/siteLinks.js";

export const widgetRouter = Router();

widgetRouter.get("/templates", (_req, res) => {
  res.json({ templates: BOT_TEMPLATES });
});

widgetRouter.get("/config/:siteKey", async (req, res) => {
  const siteKey = String(req.params.siteKey || "");
  const { data, error } = await getDb()
    .from("ghostchat_sites")
    .select(
      "name, url, theme, greeting, starter_questions, proactive_delay_ms, sound_default, show_branding, plan, site_key, booking_url, booking_provider, voice_enabled, greetings, memory_enabled, multilingual, bot_mode, support, live_lookup, max_suggestions, open_site_links, custom_domain",
    )
    .eq("site_key", siteKey)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Could not load widget config." });
  if (!data) return res.status(404).json({ error: "Unknown site key." });
  const site = data as Site;
  res.json({
    config: {
      name: site.name,
      greeting: site.greeting,
      theme: site.theme,
      starterQuestions: site.starter_questions ?? [],
      proactiveDelayMs: site.proactive_delay_ms,
      soundDefault: site.sound_default,
      showBranding: effectiveBranding(site),
      bookingUrl: site.booking_url || null,
      bookingProvider: site.booking_provider || null,
      // Voice mode is a Pro feature (browser speech APIs; the widget falls back gracefully).
      voiceEnabled: Boolean(config.voiceEnabled && site.voice_enabled && site.plan !== "free"),
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
