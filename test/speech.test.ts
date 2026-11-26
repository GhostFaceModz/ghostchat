import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
const dashHtml = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const dashJs = readFileSync(new URL("../dashboard/app.js", import.meta.url), "utf8");
const widgetRoute = readFileSync(new URL("../server/src/routes/widget.ts", import.meta.url), "utf8");
const sitesRoute = readFileSync(new URL("../server/src/routes/sites.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../server/src/types.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261115061000_ghostchat_read_aloud.sql", import.meta.url), "utf8");

function extractHelpers(src: string) {
  const start = src.indexOf("function cleanSpeechText(text)");
  const end = src.indexOf("function fallbackSpeechLang()");
  assert.ok(start >= 0 && end > start, "speech helpers should be a contiguous block in widget.js");
  const code = src.slice(start, end);
  const ctx: Record<string, unknown> = {};
  vm.runInNewContext(
    code +
      "; this.cleanSpeechText = cleanSpeechText;" +
      " this.normalizeSpeechLang = normalizeSpeechLang;" +
      " this.detectSpeechLang = detectSpeechLang;" +
      " this.scoreSpeechVoice = scoreSpeechVoice;" +
      " this.pickSpeechVoice = pickSpeechVoice;" +
      " this.splitSpeechChunks = splitSpeechChunks;",
    ctx,
  );
  return ctx as {
    cleanSpeechText: (text: string) => string;
    normalizeSpeechLang: (code: string) => string;
    detectSpeechLang: (text: string, fallback?: string) => string;
    scoreSpeechVoice: (voice: object, lang: string) => number;
    pickSpeechVoice: (voices: object[], lang: string) => object | null;
    splitSpeechChunks: (text: string, max?: number) => string[];
  };
}

const speech = extractHelpers(widget);

test("cleanSpeechText strips markdown, links and emoji", () => {
  const raw = [
    "Hello **world** and _friends_!",
    "See [GhostFlix](https://ghostflix.uk/title/123) and https://example.com/x.",
    "![poster](https://cdn.example/p.jpg) ```js\ncode();\n```",
    "A fun pick 😂🔥 and `inline`.",
    "## Heading",
  ].join(" ");
  const clean = speech.cleanSpeechText(raw);
  assert.equal(clean.includes("https://"), false);
  assert.equal(clean.includes("```"), false);
  assert.equal(clean.includes("**"), false);
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(clean), false);
  assert.match(clean, /Hello world and friends/);
  assert.match(clean, /See GhostFlix/);
  assert.match(clean, /A fun pick and inline/);
  assert.match(clean, /Heading/);
  assert.doesNotMatch(clean, /code\(\)/);
});

test("detectSpeechLang follows the reply language, not just the page", () => {
  assert.equal(speech.normalizeSpeechLang("en"), "en-GB");
  assert.equal(speech.normalizeSpeechLang("es-mx"), "es-MX");
  assert.equal(speech.detectSpeechLang("Thanks, here are a few comedies you might like.", "en-GB"), "en-GB");
  assert.equal(speech.detectSpeechLang("Claro, aquí tienes una película de comedia. Gracias, también está bien.", "en-GB"), "es-ES");
  assert.equal(speech.detectSpeechLang("Bien sûr, merci, voici un film avec une histoire très drôle.", "en-GB"), "fr-FR");
  assert.equal(speech.detectSpeechLang("Klar, danke. Ich kann dir auch eine Komödie nennen, vielleicht passt das.", "en-GB"), "de-DE");
  assert.equal(speech.detectSpeechLang("Это хороший фильм."), "ru-RU");
  assert.equal(speech.detectSpeechLang("これは面白い映画です。"), "ja-JP");
  assert.equal(speech.detectSpeechLang("这是一部很好看的电影。"), "zh-CN");
  assert.equal(speech.detectSpeechLang("هذا فيلم جيد."), "ar-SA");
});

test("pickSpeechVoice prefers Google UK English, Microsoft Natural, then Siri-quality voices", () => {
  const voices = [
    { name: "eSpeak", lang: "en-GB", localService: true },
    { name: "Fred", lang: "en-US", localService: true },
    { name: "Samantha", lang: "en-US", localService: true },
    { name: "Microsoft Sonia Online (Natural) - English (United Kingdom)", lang: "en-GB", localService: false },
    { name: "Google UK English Female", lang: "en-GB", localService: true },
    { name: "Google español", lang: "es-ES", localService: true },
    { name: "Siri Voice 1", lang: "en-GB", localService: true },
  ];
  const en = speech.pickSpeechVoice(voices, "en-GB") as { name: string };
  assert.equal(en.name, "Google UK English Female");
  const withoutGoogle = voices.filter((v) => !/Google UK/.test(v.name));
  const ms = speech.pickSpeechVoice(withoutGoogle, "en-GB") as { name: string };
  assert.match(ms.name, /Microsoft Sonia Online \(Natural\)/);
  const apple = speech.pickSpeechVoice(
    voices.filter((v) => /Siri|Samantha|eSpeak|Fred|español/.test(v.name)),
    "en-GB",
  ) as { name: string };
  assert.equal(apple.name, "Siri Voice 1");
  const es = speech.pickSpeechVoice(voices, "es-ES") as { name: string };
  assert.equal(es.name, "Google español");
  assert.ok(speech.scoreSpeechVoice({ name: "eSpeak", lang: "en-GB" }, "en-GB") < speech.scoreSpeechVoice({ name: "Daniel", lang: "en-GB" }, "en-GB"));
});

test("splitSpeechChunks keeps sentences together under the cap", () => {
  const text = "First sentence is short. Second sentence is also fairly short! Third one ends here? And a final clause.";
  const parts = speech.splitSpeechChunks(text, 40);
  assert.ok(parts.length >= 3);
  assert.equal(parts.join(" ").replace(/\s+/g, " ").trim(), text);
  assert.ok(parts.every((p) => p.length <= 50));
});

test("widget shows a same-size speaker button next to thumbs, with play/stop and a single active reply", () => {
  assert.match(widget, /class: "gc-speak"/);
  assert.match(widget, /html: ICONS\.speaker/);
  assert.match(widget, /startSpeak\(text, speakBtn\)/);
  assert.match(widget, /speakingBtn === btn && \(speechSynthesis\.speaking || speechSynthesis\.pending\)/);
  assert.match(widget, /function stopSpeak\(\)/);
  assert.match(widget, /btn\.classList\.add\("gc-speaking"\)/);
  assert.match(widget, /animation: gc-speak-wave/);
  assert.match(widget, /\.gc-fb button \{ width: 24px; height: 24px;/);
  assert.match(widget, /class="gc-wave gc-wave-1"/);
  assert.match(widget, /listen: "Listen"/);
  assert.match(widget, /stopReading: "Stop reading"/);
  assert.match(widget, /if \(typeof cfg\.readAloudEnabled === "boolean"\) state\.readAloud = cfg\.readAloudEnabled/);
  assert.match(widget, /state\.readAloud && typeof window !== "undefined" && window\.speechSynthesis/);
  assert.match(widget, /querySelectorAll\("button\.gc-rate"\)/, "thumbs must not toggle the speaker's pressed state");
  assert.doesNotMatch(widget, /wrap\.querySelectorAll\("button\[aria-pressed\]"\)/);
  assert.match(widget, /readAloud: true/);
  assert.match(widget, /Piper or Kokoro-82M were considered but not shipped/);
});

test("read-aloud is a separate owner setting, default on, and does not change voice mode", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS read_aloud_enabled boolean NOT NULL DEFAULT true/);
  assert.match(types, /read_aloud_enabled\?: boolean;/);
  assert.match(widgetRoute, /site\.voice_enabled/);
  assert.match(widgetRoute, /site\.read_aloud_enabled/);
  assert.match(widgetRoute, /site\.greetings/);
  assert.match(widgetRoute, /readAloudEnabled: site\.read_aloud_enabled !== false/);
  assert.match(widgetRoute, /voiceEnabled: Boolean\(config\.voiceEnabled && site\.voice_enabled && site\.plan !== "free"\)/);
  assert.match(sitesRoute, /if \(typeof body\.read_aloud_enabled === "boolean"\) patch\.read_aloud_enabled = body\.read_aloud_enabled;/);
  assert.match(dashHtml, /name="read_aloud_enabled"/);
  assert.match(dashHtml, /name="voice_enabled"/);
  assert.match(dashJs, /theme\.read_aloud_enabled\.checked = s\.read_aloud_enabled !== false/);
  assert.match(dashJs, /read_aloud_enabled: \$\("#theme-form"\)\.read_aloud_enabled/);
  assert.match(dashJs, /voice_enabled: \$\("#theme-form"\)\.voice_enabled/);
});

test("cleanSpeechText turns symbols and line breaks into natural speech", () => {
  const clean = speech.cleanSpeechText("Plans:\n- Free\n- Pro for £19 & Business $49\nSave 20% today – limited.");
  assert.match(clean, /Plans:/);
  assert.match(clean, /Free\. Pro for 19 pounds and Business 49 dollars\. Save 20 percent today, limited\./);
  assert.equal(clean.includes("£"), false);
  assert.equal(clean.includes("&"), false);
});

test("pickSpeechVoice prefers Android network voices over local ones", () => {
  const voices = [
    { name: "English United Kingdom", lang: "en-GB", voiceURI: "en-gb-x-gba-local", localService: true },
    { name: "English United Kingdom", lang: "en-GB", voiceURI: "en-gb-x-gbd-network", localService: false },
  ];
  const v = speech.pickSpeechVoice(voices, "en-GB") as { voiceURI: string };
  assert.equal(v.voiceURI, "en-gb-x-gbd-network");
});

test("voice input is a state machine that always releases the mic", () => {
  assert.match(widget, /continuous = false/);
  assert.match(widget, /function endListening\(sess, send, message\)/);
  assert.match(widget, /rec\.abort\(\)/);
  assert.match(widget, /window\.addEventListener\("pagehide", teardownVoice\)/);
  assert.match(widget, /document\.addEventListener\("visibilitychange", function \(\) \{ if \(document\.hidden\) teardownVoice\(\); \}\)/);
  assert.match(widget, /teardownVoice\(\);\s*\n\s*var back = lastFocus/);
  assert.match(widget, /micUnsupported:/);
  assert.match(widget, /micDenied:/);
  assert.match(widget, /micNoSpeech:/);
  assert.match(widget, /whenVoicesReady/);
  assert.doesNotMatch(widget, /getUserMedia/);
});
