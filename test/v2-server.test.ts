import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { keywords, scoreLink, parseRobots, detectSearchUrl, fillSearch, getSameHost, needsLookup, liveLookup, lookupAllowed, _test as lk } from "../server/src/lib/liveLookup.js";
import { isDue, cronSecretOk } from "../server/src/lib/recrawl.js";
import { detectLanguage, languageRule } from "../server/src/lib/lang.js";
import { buildSystemPrompt, isUnsureAnswer } from "../server/src/lib/chat.js";
import { planChatChoice } from "../server/src/lib/models.js";
import { normalizeGreetings, greetingFor } from "../server/src/lib/greetings.js";
import { extractPrefs, mergePrefs, memoryPrompt } from "../server/src/lib/memory.js";
import { extractMetaMessages, verifyMetaSignature, verifyChallenge, channelActive, normalizeChannels } from "../server/src/lib/meta.js";
import type { Site } from "../server/src/types.js";

const site = (p: Partial<Site> = {}) => ({ id: "s1", name: "Ghost Bakery", url: "https://example.com/", plan: "free", banned_topics: [], tone: "friendly", ...p }) as Site;

test("live lookup: keywords and link scoring", () => {
  assert.deepEqual(keywords("What are your opening hours on Sunday?"), ["opening", "hours", "sunday"]);
  assert.ok(scoreLink("https://example.com/opening-hours", "", ["opening", "hours"]) >= 4);
  assert.equal(scoreLink("https://example.com/blog/cakes", "Cakes", ["opening", "hours"]), 0);
  assert.ok(scoreLink("https://example.com/p/123", "Delivery information", ["delivery"]) > 0, "anchor text counts");
});

test("live lookup: robots.txt rules (specific agent wins, longest match, allow overrides)", () => {
  const allowed = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/faq\n\nUser-agent: OtherBot\nDisallow: /");
  assert.equal(allowed("/private/x"), false);
  assert.equal(allowed("/private/faq"), true);
  assert.equal(allowed("/hours"), true);
  assert.equal(parseRobots("User-agent: GhostChatBot\nDisallow: /")("/anything"), false);
  assert.equal(parseRobots("")("/x"), true);
});

test("live lookup: detects the site's GET search form, same-domain only", () => {
  const html = `<form action="/search" method="get"><input type="search" name="q"></form><form action="https://evil.com/s"><input name="q"></form>`;
  assert.equal(detectSearchUrl(html, "https://example.com/"), "https://example.com/search?q={query}");
  assert.equal(detectSearchUrl(`<form action="https://evil.com/s"><input name="q"></form>`, "https://example.com/"), null);
  assert.equal(detectSearchUrl(`<form method="post" action="/s"><input name="q"></form>`, "https://example.com/"), null);
  assert.equal(fillSearch("https://example.com/search?q={query}", "opening hours"), "https://example.com/search?q=opening%20hours");
});

test("live lookup: redirects that leave the domain are never followed", async () => {
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(url);
    if (url.endsWith("/go")) return new Response(null, { status: 302, headers: { location: "https://evil.com/steal" } });
    if (url.endsWith("/same")) return new Response(null, { status: 301, headers: { location: "/final" } });
    return new Response("<p>ok</p>", { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
  const ctrl = new AbortController();
  assert.equal(await getSameHost("https://example.com/go", "example.com", 2000, ctrl.signal, fake), null);
  assert.ok(!calls.some((c) => c.includes("evil.com")));
  const ok = await getSameHost("https://example.com/same", "example.com", 2000, ctrl.signal, fake);
  assert.equal(ok?.finalUrl.href, "https://example.com/final");
  assert.equal(await getSameHost("https://evil.com/x", "example.com", 2000, ctrl.signal, fake), null);
});

test("live lookup: only when the index has nothing confident, owner toggle and corrections respected", () => {
  process.env.EMBEDDING_PROVIDER = "local";
  delete process.env.SIMILARITY_THRESHOLD;
  const c = (similarity: number, id = "c") => ({ id, site_id: "s1", url: null, title: null, content: "x", similarity });
  assert.equal(needsLookup({}, []), true);
  assert.equal(needsLookup({}, [c(0.22)]), true);
  assert.equal(needsLookup({}, [c(0.6)]), false);
  assert.equal(needsLookup({ live_lookup: false }, []), false);
  assert.equal(needsLookup({}, [c(0.9, "correction:1")]), false);
});

test("live lookup: per-visitor rate limit", async () => {
  let ok = 0;
  for (let i = 0; i < 6; i++) if (await lookupAllowed("rl-site", "rl-visitor")) ok++;
  assert.equal(ok, 4);
});

test("live lookup end-to-end (mocked site): sitemap → best page → matching passage with its URL, within budget", async () => {
  process.env.EMBEDDING_PROVIDER = "local";
  lk.robotsCache.clear(); lk.sitemapCache.clear(); lk.searchCache.clear(); lk.missCache.clear();
  const real = globalThis.fetch;
  const hits: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    hits.push(url);
    const html = (b: string) => new Response(`<html><head><title>T</title></head><body>${b}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /admin", { status: 200, headers: { "content-type": "text/plain" } });
    if (url.endsWith("/sitemap.xml")) return new Response("<urlset><url><loc>https://example.com/opening-hours</loc></url><url><loc>https://example.com/admin/opening-hours</loc></url><url><loc>https://example.com/cakes</loc></url></urlset>", { status: 200, headers: { "content-type": "application/xml" } });
    if (url === "https://example.com/" ) return html(`<a href="/cakes">Cakes</a>`);
    if (url.endsWith("/opening-hours")) return html(`<h1>Opening hours</h1><p>Ghost Bakery opening hours: we are open Monday to Saturday from 8am to 6pm, and on Sunday from 9am to 1pm.</p>`);
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  try {
    const t0 = Date.now();
    const r = await liveLookup(site({ id: "e2e" }), "What are your opening hours on Sunday?", { budgetMs: 6000 });
    assert.ok(Date.now() - t0 < 6500);
    assert.ok(r, "found something");
    assert.equal(r!.chunks[0].url, "https://example.com/opening-hours");
    assert.match(r!.chunks[0].content, /Sunday from 9am/);
    assert.ok(!hits.some((h) => h.includes("/admin")), "robots.txt disallow respected");
    assert.ok(hits.every((h) => h.startsWith("https://example.com/")), "no off-domain fetches");
  } finally {
    globalThis.fetch = real;
  }
});

test("auto re-crawl: due rules and cron secret", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  assert.equal(isDue({ recrawl_schedule: "off", last_crawled_at: null } as Site, now), false);
  assert.equal(isDue({ recrawl_schedule: "daily", last_crawled_at: "2026-11-13T12:00:00Z" } as Site, now), true);
  assert.equal(isDue({ recrawl_schedule: "daily", last_crawled_at: "2026-11-14T06:00:00Z" } as Site, now), false);
  assert.equal(isDue({ recrawl_schedule: "weekly", last_crawled_at: "2026-11-10T12:00:00Z" } as Site, now), false);
  assert.equal(isDue({ recrawl_schedule: "weekly", last_crawled_at: "2026-11-06T12:00:00Z" } as Site, now), true);
  assert.equal(isDue({ recrawl_schedule: "daily", last_crawled_at: null, crawl_status: "crawling", updated_at: "2026-11-14T11:50:00Z" } as Site, now), false);
  assert.equal(cronSecretOk("abc", "abc"), true);
  assert.equal(cronSecretOk("abd", "abc"), false);
  assert.equal(cronSecretOk("abc", ""), false);
  assert.equal(cronSecretOk(undefined, "abc"), false);
});

test("multi-language: detection, reply rule and translated not-sure detection", () => {
  assert.equal(detectLanguage("¿Cuánto cuesta el plan pro?"), "es");
  assert.equal(detectLanguage("Bonjour, quels sont vos horaires ?"), "fr");
  assert.equal(detectLanguage("Hallo, wie viel kostet das?"), "de");
  assert.equal(detectLanguage("What time do you open?"), "en");
  assert.equal(detectLanguage("ok", "pt-BR"), "pt");
  assert.equal(detectLanguage("こんにちは"), "ja");
  assert.match(languageRule("es"), /Spanish/);
  const p = buildSystemPrompt(site(), [], { lang: "fr" });
  assert.match(p, /detected: French/);
  assert.doesNotMatch(buildSystemPrompt(site({ multilingual: false }), [], { lang: "fr" }), /detected: French/);
  assert.ok(isUnsureAnswer("No estoy seguro — no lo encontré en este sitio."));
  assert.ok(isUnsureAnswer("I'm not sure — I couldn't find that on this site."));
  assert.ok(!isUnsureAnswer("We open at 8am."));
});

test("white label: Pro sites with the badge hidden don't mention GhostChat", () => {
  assert.match(buildSystemPrompt(site(), []), /powered by GhostChat/);
  assert.doesNotMatch(buildSystemPrompt(site({ plan: "pro", show_branding: false }), []), /powered by GhostChat/);
  assert.match(buildSystemPrompt(site({ plan: "free", show_branding: false }), []), /powered by GhostChat/, "free can't white-label");
});

test("per-plan model: Pro uses PRO_CHAT_MODEL for the main answer only; Free and owner picks unchanged", () => {
  delete process.env.PRO_CHAT_MODEL;
  const pro = { plan: "pro", chat_provider: null, chat_model: null };
  assert.deepEqual(planChatChoice(pro, true), pro, "unset env = no change");
  process.env.PRO_CHAT_MODEL = "openai/gpt-4o-mini";
  assert.equal(planChatChoice(pro, true)?.chat_model, "openai/gpt-4o-mini");
  assert.equal(planChatChoice(pro, false)?.chat_model, null, "helper calls stay cheap");
  assert.equal(planChatChoice({ plan: "free", chat_model: null }, true)?.chat_model, null);
  assert.equal(planChatChoice({ plan: "pro", chat_model: "x/y" }, true)?.chat_model, "x/y", "owner's pick wins");
  delete process.env.PRO_CHAT_MODEL;
});

test("proactive greetings: normalised and matched by path", () => {
  const g = normalizeGreetings([{ pattern: "pricing*", message: "  Questions about plans? ", delay_s: 1 }, { pattern: "*", message: "Hi!", delay_s: 999 }, { message: "" }]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], { pattern: "/pricing*", message: "Questions about plans?", delay_s: 3 });
  assert.equal(g[1].delay_s, 300);
  assert.equal(greetingFor(g, "/pricing/pro")?.message, "Questions about plans?");
  assert.equal(greetingFor(g, "/about")?.message, "Hi!");
  assert.equal(greetingFor([{ pattern: "/faq", message: "x", delay_s: 5 }], "/faq/")?.message, "x");
  assert.equal(greetingFor([{ pattern: "/faq", message: "x", delay_s: 5 }], "/faq/more"), null);
});

test("smarter memory: stated likes are remembered without PII, prompt only for returning visitors", () => {
  const p = extractPrefs("I love horror films and I'm into slow-burn thrillers. My email is a@b.com");
  assert.deepEqual(p.likes, ["horror films and i'm into slow-burn thrillers", "slow-burn thrillers"].slice(0, p.likes!.length));
  assert.ok(!JSON.stringify(p).includes("a@b.com"));
  const merged = mergePrefs({ likes: ["comedy"] }, { likes: ["horror"], topics: ["prices"] });
  assert.deepEqual(merged.likes, ["horror", "comedy"]);
  assert.equal(memoryPrompt({ visitor_id: "v_x", visits: 1, last_session_id: null, prefs: merged, last_seen: new Date().toISOString() }), "");
  assert.match(memoryPrompt({ visitor_id: "v_x", visits: 3, last_session_id: null, prefs: merged, last_seen: new Date().toISOString() }), /RETURNING VISITOR \(visit 3/);
});

test("WhatsApp/Instagram scaffolding: off by default, Business-only, signature + challenge checks", () => {
  delete process.env.META_CHANNELS_ENABLED;
  const wa = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "123" }, messages: [{ from: "447700", id: "m1", type: "text", text: { body: "hi" } }] } }] }] };
  const ig = { object: "instagram", entry: [{ id: "999", messaging: [{ sender: { id: "u1" }, recipient: { id: "999" }, message: { mid: "x", text: "hey" } }, { sender: { id: "999" }, message: { text: "echo", is_echo: true } }] }] };
  assert.deepEqual(extractMetaMessages(wa), [{ channel: "whatsapp", accountId: "123", from: "447700", text: "hi", id: "m1" }]);
  assert.equal(extractMetaMessages(ig).length, 1);
  const s = { plan: "business", channels: { whatsapp: { enabled: true, phone_number_id: "123" } } } as unknown as Site;
  assert.equal(channelActive(s, "whatsapp"), false, "global switch is off");
  process.env.META_CHANNELS_ENABLED = "true";
  assert.equal(channelActive(s, "whatsapp"), true);
  assert.equal(channelActive({ ...s, plan: "pro" } as Site, "whatsapp"), false, "Business tier only");
  delete process.env.META_CHANNELS_ENABLED;
  assert.equal(normalizeChannels({ whatsapp: { enabled: true, phone_number_id: "12a3" } }, "pro").whatsapp?.enabled, false);
  const body = JSON.stringify(wa);
  const sig = "sha256=" + crypto.createHmac("sha256", "sec").update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, sig, "sec"), true);
  assert.equal(verifyMetaSignature(body, sig, "other"), false);
  assert.equal(verifyMetaSignature(body, sig, ""), false);
  assert.equal(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "t", "hub.challenge": "42" }, "t"), "42");
  assert.equal(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "42" }, "t"), null);
  assert.equal(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "42" }, ""), null);
});
