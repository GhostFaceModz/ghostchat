import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");

test("widget parses and stays dependency-free", () => {
  new vm.Script(src);
  assert.doesNotMatch(src, /\bimport\s|require\(/);
});

test("widget handles live lookup status and reset events", () => {
  assert.match(src, /ev\.type === "status" && ev\.status === "checking"/);
  assert.match(src, /ev\.type === "reset"/);
  assert.match(src, /checking: "Checking the site…"/);
});

test("widget translates UI strings for the main languages", () => {
  for (const l of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) assert.match(src, new RegExp(`\\n\\s+${l}: \\{ ph:`));
  assert.match(src, /lang: \(navigator\.language/);
});

test("widget memory: anonymous visitor id, opt-out and forget", () => {
  assert.match(src, /gc_vid_/);
  assert.match(src, /gc_mem_off_/);
  assert.match(src, /\/api\/chat\/forget/);
  assert.match(src, /memory: state\.memory && !state\.memoryOff/);
});

test("widget greetings, owner forms, CSAT and voice fallback", () => {
  assert.match(src, /gc_greet_/);
  assert.match(src, /card\.kind === "support"/);
  assert.match(src, /\/api\/chat\/csat/);
  assert.match(src, /micBlocked/);
  assert.match(src, /gc-listening/);
});

test("widget API_BASE comes from the script src, so either host works", () => {
  assert.match(src, /var API_BASE = \(function \(\) \{/);
  assert.match(src, /var u = new URL\(script\.src, window\.location\.href\)/);
  assert.match(src, /return u\.origin/);
});

test("widget has Assistant and Support tabs, end-chat, connecting popup and a review prompt", () => {
  assert.match(src, /class: "gc-tabs"/);
  assert.match(src, /tabAi: "Assistant"/);
  assert.match(src, /tabSupport: "Support"/);
  assert.match(src, /endChat: "End chat with agent"/);
  assert.match(src, /connecting: "Connecting you to a support agent…"/);
  assert.match(src, /joined: "\{name\} joined"/);
  assert.match(src, /openSupport: "Open Support"/);
  assert.match(src, /stayAi: "Stay with Assistant"/);
  assert.match(src, /cancelWait: "Cancel"/);
  assert.match(src, /function showConnect\(mode\)/);
  assert.match(src, /function endLiveChat\(reason\)/);
  assert.match(src, /\/api\/live\/" \+ encodeURIComponent\(SITE_KEY\) \+ "\/" \+ encodeURIComponent\(state\.sessionId\) \+ "\/end"/);
  assert.match(src, /thread: thread/);
  assert.match(src, /function showReviewPrompt\(/);
  assert.match(src, /csatComment/);
  assert.match(src, /gc-connect/);
  assert.doesNotMatch(src, /position:\s*fixed;[^"]*gc-connect/);
  assert.match(src, /function finishSupportChat\(/);
  assert.match(src, /function hideSupportTab\(/);
  assert.match(src, /function showBackAiOnce\(/);
  assert.match(src, /skipReview: "Skip review"/);
  assert.match(src, /closeSupport: "Close support chat"/);
  assert.match(src, /gc-tab-end/);
  assert.match(src, /gc-tab-close/);
  assert.match(src, /markSupportDone\(/);
  assert.match(src, /data-tab='support'\]\[data-live='true'\] \.gc-tab-end/);
  assert.match(src, /flex-shrink: 0/);
});

test("widget traps host-page swipes and announces open/close to the host page", () => {
  assert.match(src, /overscroll-behavior: contain; touch-action: manipulation/);
  assert.doesNotMatch(src, /function trapHostGestures\(e\) \{[^}]*preventDefault/);
  assert.match(src, /\.gc-msgs \{ flex: 1; overflow: auto; overscroll-behavior: contain;/);
  assert.match(src, /document\.documentElement\.classList\.toggle\("ghostchat-open", open\)/);
  assert.match(src, /CustomEvent\(open \? "ghostchat:open" : "ghostchat:close"/);
  assert.match(src, /function trapHostGestures\(e\) \{ e\.stopPropagation\(\); \}/);
  assert.match(src, /"touchstart", "touchmove", "touchend", "touchcancel"/);
  assert.match(src, /"pointerdown", "pointermove", "pointerup", "pointercancel"/);
  assert.match(src, /panel\.addEventListener\(type, trapHostGestures, \{ passive: true \}\)/);
});

test("widget opens the site's own links in the same tab and restores the chat", () => {
  assert.match(src, /function isSiteLink\(/);
  assert.match(src, /function openSiteUrl\(/);
  assert.match(src, /function linkTarget\(/);
  assert.match(src, /gc_restore_open_/);
  assert.match(src, /GhostChatNavigate/);
  assert.match(src, /location\.assign/);
  assert.match(src, /openSiteLinks/);
  assert.match(src, /siteHosts/);
  assert.match(src, /data-link/);
});
