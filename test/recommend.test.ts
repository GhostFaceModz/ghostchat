import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIntent, ruleIntent, parseJsonObject } from "../server/src/lib/intent.js";
import { fillTemplate, getPath, mapItems, filterFeed, runTool, runSearch, normalizeTools, pickTool, relaxFilters, type SearchTool } from "../server/src/lib/siteTools.js";
import { composePicks, logText, toolTurn } from "../server/src/lib/recommend.js";
import { inScope, pageChunk } from "../server/src/lib/crawl.js";
import type { Site } from "../server/src/types.js";

const ghostflix: SearchTool = {
  id: "gf", name: "GhostFlix picks", kind: "json",
  url_template: "https://ghostflix.example/api/public/picks?q={query}&similar={similar_to}&genre={genre}&mood={mood}&type={type}&yf={year_from}&yt={year_to}&lang={language}",
  items_path: "results", fields: { title: "title", url: "url", image: "poster", rating: "rating", year: "year", subtitle: "genres.0", description: "overview" },
  intents: ["recommend", "find"], button_label: "Watch on GhostFlix", enabled: true,
};
const body = { results: [
  { title: "Midsommar", year: 2019, rating: 7.1, poster: "https://img.example/m.jpg", url: "https://ghostflix.example/title/movie/530385", genres: ["Horror"], overview: "A couple travels to Sweden…" },
  { title: "The Witch", year: 2015, rating: 6.9, poster: "/w.jpg", url: "/title/movie/310131", genres: ["Horror"], overview: "New England, 1630." },
  { title: "", url: "https://ghostflix.example/x" },
  { title: "Bad link", url: "javascript:alert(1)" },
] };

test("intent JSON is validated and clipped; vague recommend asks one question", () => {
  const i = normalizeIntent({ intent: "recommend", filters: { genre: "horror", similar_to: "Hereditary", year_from: "2010", type: "film", language: "Korean", actors: "Toni Collette", evil: "x" } });
  assert.deepEqual(i.filters, { genre: "horror", similar_to: "Hereditary", year_from: 2010, actors: ["Toni Collette"], language: "ko" });
  assert.equal(i.clarify, null, "no question when the visitor gave details");
  const vague = normalizeIntent({ intent: "recommend", filters: {}, clarify: "What are you in the mood for?", options: ["Scary", "Funny", "x".repeat(99)] });
  assert.equal(vague.clarify, "What are you in the mood for?");
  assert.equal(vague.options.length, 3);
  assert.equal(normalizeIntent({ intent: "hack" }).intent, "other");
  assert.deepEqual(parseJsonObject('Sure! {"intent":"find"} done'), { intent: "find" });
});

test("rule fallback understands 'a horror film like Hereditary' and decades", () => {
  const i = ruleIntent("recommend me a horror film like Hereditary");
  assert.equal(i.intent, "recommend");
  assert.equal(i.filters.similar_to, "Hereditary");
  assert.equal(i.filters.genre, "horror");
  assert.equal(i.filters.type, "movie");
  const d = ruleIntent("any good 90s comedy series?");
  assert.equal(d.filters.year_from, 1990);
  assert.equal(d.filters.type, "tv");
  assert.equal(ruleIntent("how do I reset my password").intent, "howto");
});

test("URL templates encode values and drop empty params", () => {
  assert.equal(fillTemplate(ghostflix.url_template, { similar_to: "Hereditary", genre: "horror & gore" }), "https://ghostflix.example/api/public/picks?similar=Hereditary&genre=horror%20%26%20gore");
  assert.equal(fillTemplate("https://x.com/s?q={query}", {}), "https://x.com/s");
  assert.equal(fillTemplate("https://x.com/{secret}?q={query}", { query: "a" }), "https://x.com/?q=a", "unknown placeholders are blanked");
});

test("field mapping: dot paths, relative links resolved, unsafe or empty items dropped", () => {
  assert.equal(getPath({ a: { b: [{ c: 5 }] } }, "a.b.0.c"), 5);
  assert.equal(getPath({ a: { b: [{ c: 5 }] } }, "a.b[0].c"), 5);
  const items = mapItems(body, ghostflix, "https://ghostflix.example/api/public/picks");
  assert.deepEqual(items.map((i) => i.title), ["Midsommar", "The Witch"]);
  assert.equal(items[1].url, "https://ghostflix.example/title/movie/310131");
  assert.equal(items[1].image, "https://ghostflix.example/w.jpg");
  assert.equal(items[0].subtitle, "Horror");
});

test("runTool calls the filled URL and returns mapped items; feeds are filtered locally", async () => {
  let called = "";
  const fetcher = (async (url: string) => { called = url; return new Response(JSON.stringify(body)); }) as unknown as typeof fetch;
  const out = await runTool(ghostflix, { similar_to: "Hereditary", genre: "horror" }, fetcher);
  assert.match(called, /similar=Hereditary&genre=horror$/);
  assert.equal(out.length, 2);
  const feed = filterFeed(mapItems(body, ghostflix, "https://ghostflix.example/"), { query: "witch" });
  assert.deepEqual(feed.map((i) => i.title), ["The Witch"]);
  assert.deepEqual(filterFeed(mapItems(body, ghostflix, "https://ghostflix.example/"), { similar_to: "Midsommar", genre: "horror" }).map((i) => i.title), ["The Witch"], "never the compared title");
});

test("tools from the dashboard are validated (https, public host only)", async () => {
  await assert.rejects(normalizeTools([{ url_template: "http://127.0.0.1/api?q={query}" }]));
  await assert.rejects(normalizeTools([{ url_template: "http://example.com/api?q={query}" }]), /https/);
  const [t] = await normalizeTools([{ url_template: "https://example.com/api?q={query}", fields: { title: "name", url: "link<script>" }, intents: ["recommend", "evil"] }]);
  assert.equal(t.fields.url, "linkscript");
  assert.deepEqual(t.intents, ["recommend"]);
  assert.equal(pickTool([t], "find"), null);
});

test("the model only picks result numbers; titles always come from the tool", async () => {
  const site = { name: "GhostFlix" } as Site;
  const items = mapItems(body, ghostflix, "https://ghostflix.example/");
  const ask = (async () => JSON.stringify({ intro: "Try these unsettling slow-burns.", picks: [{ n: 2, why: "Folk horror dread" }, { n: 9, why: "made up" }, { n: 2, why: "dup" }, { n: 1, why: "Daylight horror" }] })) as never;
  const { intro, cards } = await composePicks(site, "horror like Hereditary", items, ghostflix, ask);
  assert.equal(intro, "Try these unsettling slow-burns.");
  assert.deepEqual(cards.map((c) => [c.title, c.why, c.cta]), [["The Witch", "Folk horror dread", "Watch on GhostFlix"], ["Midsommar", "Daylight horror", "Watch on GhostFlix"]]);
  const sneaky = (async () => JSON.stringify({ intro: 'You will love "Hereditary 2"!', picks: [] })) as never;
  const r2 = await composePicks(site, "x", items, ghostflix, sneaky);
  assert.equal(r2.intro, "Here are some picks from GhostFlix:", "an intro naming a title we don't have is replaced");
  assert.equal(r2.cards.length, 2, "falls back to the tool's order");
  const broken = (async () => { throw new Error("down"); }) as never;
  assert.equal((await composePicks(site, "x", items, ghostflix, broken)).cards[0].title, "Midsommar");
  assert.match(logText("Hi", cards), /- \[The Witch \(2015\)\]\(https:\/\/ghostflix\.example\/title\/movie\/310131\)/);
});

test("crawl scope: include/exclude path prefixes and one chunk per page", () => {
  const u = (p: string) => new URL(`https://x.com${p}`);
  assert.equal(inScope(u("/title/movie/1"), { include: ["/title/"] }), true);
  assert.equal(inScope(u("/account"), { include: ["/title/"] }), false);
  assert.equal(inScope(u("/title/admin"), { include: ["/title/"], exclude: ["/title/admin"] }), false);
  assert.equal(inScope(u("/anything"), {}), true);
  const c = pageChunk({ url: "https://x.com/title/movie/1", title: "Alien (1979)", text: "In space no one can hear you scream. ".repeat(200) });
  assert.match(c.content, /^Alien \(1979\)\nPage: https:\/\/x\.com\/title\/movie\/1\n/);
  assert.ok(c.content.length < 2600);
});

test("link fields can be templates built from item fields", () => {
  const items = mapItems({ results: [{ id: 42, media_type: "movie", title: "Alien" }] }, { items_path: "results", fields: { title: "title", url: "/title/{media_type}/{id}" } }, "https://ghostflix.uk/api/discover/movie/27");
  assert.equal(items[0].url, "https://ghostflix.uk/title/movie/42");
});

test("a reply cut off mid-JSON still yields the complete picks", async () => {
  const { salvage } = await import("../server/src/lib/recommend.js");
  const r = salvage('{"intro": "Try these.", "picks": [{"n": 2, "why": "Folk \\"horror\\""}, {"n": 1, "why": "Day');
  assert.deepEqual(r, { intro: "Try these.", picks: [{ n: 2, why: 'Folk "horror"' }] });
});

test("rules understand a 2025 stoner comedy and don't treat 'like a stoner movie' as a title", () => {
  const i = ruleIntent("Find me a good comedy made in 2025 like a stoner movie");
  assert.equal(i.intent, "recommend");
  assert.equal(i.filters.genre, "comedy");
  assert.equal(i.filters.mood, "stoner");
  assert.equal(i.filters.year_from, 2025);
  assert.equal(i.filters.year_to, 2025);
  assert.equal(i.filters.type, "movie");
  assert.equal(i.filters.similar_to, undefined);
});

test("between 2024 and 2025 is a year range, and Hereditary is still a title", () => {
  const i = ruleIntent("Recommend me a few good stoner movies on here made between 2024 and 2025");
  assert.equal(i.intent, "recommend");
  assert.equal(i.filters.mood, "stoner");
  assert.equal(i.filters.year_from, 2024);
  assert.equal(i.filters.year_to, 2025);
  const h = ruleIntent("recommend me a horror film like Hereditary");
  assert.equal(h.filters.similar_to, "Hereditary");
});

test("relaxFilters widens the year then drops the mood", () => {
  const steps = relaxFilters({ genre: "comedy", mood: "stoner", year_from: 2025, year_to: 2025, type: "movie" });
  assert.equal(steps[0].kind, "exact");
  assert.ok(steps.some((s) => s.kind === "wider_year" && s.filters.year_from === 2023 && s.filters.year_to === 2026 && s.filters.mood === "stoner"));
  assert.ok(steps.some((s) => s.kind === "drop_mood" && !s.filters.mood && s.filters.year_from === 2025));
});

test("runSearch surfaces the catalogue's relaxed note", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ match: "relaxed", note: "Nearby years.", results: body.results }))) as unknown as typeof fetch;
  const out = await runSearch(ghostflix, { genre: "comedy", mood: "stoner", year_from: 2025, year_to: 2025 }, fetcher);
  assert.equal(out.match, "relaxed");
  assert.equal(out.note, "Nearby years.");
  assert.equal(out.items[0].title, "Midsommar");
});

test("toolTurn retries a wider search and tells the visitor it relaxed, instead of giving up", async () => {
  let calls = 0;
  const fetcher = (async (url: string) => {
    calls += 1;
    const exact = /yf=2025/.test(url) && /yt=2025/.test(url) && /mood=stoner/.test(url);
    if (exact) return new Response(JSON.stringify({ match: "exact", results: [] }));
    return new Response(JSON.stringify({ match: "relaxed", note: "No exact 2025 stoner comedy, so here are nearby years.", results: body.results.slice(0, 2) }));
  }) as unknown as typeof fetch;
  const site = { id: "site-1", name: "GhostFlix", search_tools: [ghostflix] } as Site;
  const out = await toolTurn(site, "s1", "Find me a good comedy made in 2025 like a stoner movie", {
    classify: async (msg) => ruleIntent(msg),
    fetcher,
    ask: (async () => JSON.stringify({ intro: "I couldn't find a 2025 stoner comedy, so here are close matches.", picks: [{ n: 1, why: "A recent comedy" }] })) as never,
  });
  assert.ok(out);
  assert.ok(calls >= 2);
  assert.match(out!.answer, /close matches|nearby years/i);
  assert.equal(out!.results[0].title, "Midsommar");
  assert.ok(out!.results[0].url.startsWith("https://ghostflix.example/"));
});

test("toolTurn does not invent titles when the catalogue is empty; it asks to widen the search", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ results: [] }))) as unknown as typeof fetch;
  const site = { id: "site-1", name: "GhostFlix", search_tools: [ghostflix] } as Site;
  const out = await toolTurn(site, "s1", "Find me a good comedy made in 2025 like a stoner movie", {
    classify: async (msg) => ruleIntent(msg),
    fetcher,
    ask: (async () => { throw new Error("should not compose picks"); }) as never,
  });
  assert.ok(out);
  assert.equal(out!.results.length, 0);
  assert.match(out!.answer, /couldn't find a close match/i);
});
