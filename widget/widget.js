/* GhostChat embeddable widget — dependency-free.
 * Host pages can position it with CSS custom properties on #ghostchat-host:
 *   --gc-offset-bottom, --gc-offset-right (default 22px) and --gc-z (default 2147483000). */
(function () {
  "use strict";

  if (window.__GHOSTCHAT_LOADED) return;
  window.__GHOSTCHAT_LOADED = true;

  var script = document.currentScript || (function () {
    var list = document.getElementsByTagName("script");
    return list[list.length - 1];
  })();

  var SITE_KEY = (script && script.getAttribute("data-id")) || "";
  var API_BASE = (function () {
    if (script && script.src) {
      try {
        var u = new URL(script.src, window.location.href);
        return u.origin;
      } catch (e) {}
    }
    return window.location.origin;
  })();

  var attr = function (name, fallback) {
    var v = script && script.getAttribute(name);
    return v == null || v === "" ? fallback : v;
  };

  var state = {
    open: attr("data-open", "") === "true",
    sound: attr("data-sound", "") === "true",
    themeMode: attr("data-theme", "dark"),
    voiceAttr: attr("data-voice", ""),
    primary: attr("data-primary", "#a78bfa"),
    greeting: attr("data-greeting", ""),
    delay: parseInt(attr("data-delay", ""), 10),
    name: "GhostChat",
    starters: [],
    showBranding: true,
    sessionId: null,
    sending: false,
    lastLogId: null,
    greeted: false,
    thinking: false,
    voice: false,
    voiceOutput: false,
    bookingUrl: "",
    bookingProvider: ""
  };

  try {
    state.sessionId = localStorage.getItem("gc_session_" + SITE_KEY) || "";
    if (!state.sessionId) {
      state.sessionId = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("gc_session_" + SITE_KEY, state.sessionId);
    }
    var soundPref = localStorage.getItem("gc_sound_" + SITE_KEY);
    if (soundPref === "1") state.sound = true;
    if (soundPref === "0") state.sound = false;
  } catch (e) {
    state.sessionId = "s_" + Date.now();
  }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function renderMarkdown(raw) {
    // Internal grounding tags like [#1] are hidden; sources render as chips below the answer.
    var text = String(raw || "").replace(/\s*\[#\d+(?:\s*,\s*#?\d+)*\]/g, "");
    var blocks = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      var i = blocks.length;
      blocks.push('<pre class="gc-code"><code data-lang="' + escapeHtml(lang) + '">' + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>");
      return "\u0000B" + i + "\u0000";
    });
    var html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/^(?:- |\* )(.+)$/gm, "<li>$1</li>");
    html = html.replace(/(?:<li>.*<\/li>\n?)+/g, function (m) { return "<ul>" + m + "</ul>"; });
    html = html.replace(/\n/g, "<br>");
    html = html.replace(/\u0000B(\d+)\u0000/g, function (_, i) { return blocks[Number(i)]; });
    return html;
  }

  var css = [
    ":host, .gc-root { all: initial; }",
    ".gc-root { font-family: 'Instrument Sans', 'Segoe UI', system-ui, sans-serif; color: var(--gc-text); }",
    ".gc-root { --gc-primary: #a78bfa; --gc-bg: rgba(16,10,28,.78); --gc-text: #f5f3ff; --gc-muted: #c4b5fd; --gc-line: rgba(196,181,253,.18); --gc-user: #2a1848; --gc-bubble: #110818; --gc-panel: rgba(12,8,20,.78); }",
    ".gc-root[data-mode='light'] { --gc-bg: rgba(255,255,255,.86); --gc-text: #1e1133; --gc-muted: #6b528c; --gc-line: rgba(88,40,140,.14); --gc-user: #efe7ff; --gc-bubble: #f7f2ff; --gc-panel: rgba(255,255,255,.8); }",
    ".gc-root { --gc-size: 52px; --gc-ease: cubic-bezier(.2,.8,.2,1); --gc-spring: cubic-bezier(.34,1.4,.5,1); }",
    "@media (max-width: 600px) { .gc-root { --gc-size: 48px; } }",
    ".gc-root svg { display: block; }",
    ".gc-root button:focus-visible, .gc-root a:focus-visible, .gc-root textarea:focus-visible, .gc-root input:focus-visible { outline: 2px solid var(--gc-primary); outline-offset: 2px; }",
    ".gc-launcher { position: fixed; right: var(--gc-offset-right, 22px); bottom: var(--gc-offset-bottom, 22px); z-index: var(--gc-z, 2147483000); width: var(--gc-size); height: var(--gc-size); padding: 0; border: 0; border-radius: 50%; cursor: pointer; color: #fff; background: radial-gradient(120% 120% at 30% 15%, color-mix(in srgb, var(--gc-primary) 92%, #fff) 0%, var(--gc-primary) 38%, var(--gc-accent, #7c3aed) 100%); box-shadow: 0 10px 24px -6px color-mix(in srgb, var(--gc-accent, #7c3aed) 55%, transparent), 0 2px 6px rgba(8,4,20,.35), inset 0 1px 0 rgba(255,255,255,.35), inset 0 -2px 6px rgba(0,0,0,.18); display: grid; place-items: center; -webkit-tap-highlight-color: transparent; transition: transform .28s var(--gc-spring), box-shadow .28s var(--gc-ease); isolation: isolate; }",
    ".gc-launcher::before { content: ''; position: absolute; inset: 1px; border-radius: inherit; background: linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,0) 52%); pointer-events: none; }",
    ".gc-launcher::after { content: ''; position: absolute; inset: -6px; border-radius: inherit; z-index: -1; background: radial-gradient(closest-side, color-mix(in srgb, var(--gc-primary) 45%, transparent), transparent); filter: blur(6px); opacity: .55; animation: gc-breathe 3.6s ease-in-out infinite; pointer-events: none; }",
    ".gc-launcher:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 16px 32px -8px color-mix(in srgb, var(--gc-accent, #7c3aed) 65%, transparent), 0 3px 8px rgba(8,4,20,.35), inset 0 1px 0 rgba(255,255,255,.4), inset 0 -2px 6px rgba(0,0,0,.18); }",
    ".gc-launcher:active { transform: scale(.92); transition-duration: .12s; }",
    ".gc-launcher .gc-li { position: absolute; inset: 0; display: grid; place-items: center; transition: transform .38s var(--gc-spring), opacity .22s var(--gc-ease); }",
    ".gc-launcher .gc-li svg { width: 50%; height: 50%; filter: drop-shadow(0 1px 1.5px rgba(20,8,40,.35)); }",
    ".gc-launcher .gc-li-close svg { width: 38%; height: 38%; }",
    ".gc-li-close { opacity: 0; transform: rotate(-90deg) scale(.5); }",
    ".gc-root[data-open='true'] .gc-li-ghost { opacity: 0; transform: rotate(90deg) scale(.5); }",
    ".gc-root[data-open='true'] .gc-li-close { opacity: 1; transform: none; }",
    ".gc-root[data-open='true'] .gc-launcher::after { animation: none; opacity: .3; }",
    ".gc-li-ghost svg { animation: gc-bob 3.6s ease-in-out infinite; }",
    ".gc-root[data-thinking='true'] .gc-li-ghost svg { animation: gc-bob .9s ease-in-out infinite; }",
    ".gc-dot { position: absolute; top: 1px; right: 1px; width: 11px; height: 11px; border-radius: 50%; background: #ff4d6d; box-shadow: 0 0 0 2px #fff, 0 2px 6px rgba(255,77,109,.6); transform: scale(0); transition: transform .3s var(--gc-spring); pointer-events: none; }",
    ".gc-root[data-unread='true'] .gc-dot { transform: scale(1); }",
    ".gc-root[data-open='true'] .gc-dot { transform: scale(0); }",
    "@keyframes gc-breathe { 0%,100% { transform: scale(.92); opacity: .35; } 50% { transform: scale(1.08); opacity: .7; } }",
    "@keyframes gc-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }",
    "@keyframes gc-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }",
    ".gc-panel { position: fixed; right: max(12px, var(--gc-offset-right, 22px)); bottom: calc(var(--gc-offset-bottom, 22px) + var(--gc-size) + 14px); z-index: var(--gc-z, 2147483000); width: min(400px, calc(100vw - 24px)); height: min(640px, calc(100vh - var(--gc-offset-bottom, 22px) - var(--gc-size) - 40px)); height: min(640px, calc(100dvh - var(--gc-offset-bottom, 22px) - var(--gc-size) - 40px)); display: flex; flex-direction: column; border-radius: 24px; overflow: hidden; background: var(--gc-panel); border: 1px solid var(--gc-line); box-shadow: 0 28px 70px -12px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.03) inset; backdrop-filter: blur(22px) saturate(1.3); -webkit-backdrop-filter: blur(22px) saturate(1.3); opacity: 0; pointer-events: none; visibility: hidden; transform-origin: calc(100% - var(--gc-size) / 2) calc(100% + 14px); transform: translateY(10px) scale(.94); transition: opacity .24s var(--gc-ease), transform .34s var(--gc-spring), visibility 0s linear .34s; }",
    ".gc-root[data-open='true'] .gc-panel { opacity: 1; pointer-events: auto; visibility: visible; transform: none; transition: opacity .24s var(--gc-ease), transform .34s var(--gc-spring), visibility 0s; }",
    ".gc-head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; border-bottom: 1px solid var(--gc-line); background: linear-gradient(180deg, color-mix(in srgb, var(--gc-primary) 10%, transparent), transparent); }",
    ".gc-avatar { position: relative; flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: radial-gradient(120% 120% at 30% 15%, color-mix(in srgb, var(--gc-primary) 90%, #fff), var(--gc-primary) 40%, var(--gc-accent, #7c3aed)); box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 4px 12px -4px color-mix(in srgb, var(--gc-accent, #7c3aed) 60%, transparent); }",
    ".gc-avatar svg { width: 18px; height: 18px; }",
    ".gc-avatar::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 2px var(--gc-bubble); }",
    ".gc-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }",
    ".gc-head h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -.02em; color: var(--gc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".gc-sub { font-size: 11.5px; color: var(--gc-muted); opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".gc-iconbtn { flex: none; width: 32px; height: 32px; padding: 0; border: 0; background: transparent; color: var(--gc-muted); cursor: pointer; border-radius: 10px; display: grid; place-items: center; transition: background .18s, color .18s, transform .18s var(--gc-spring); }",
    ".gc-iconbtn svg { width: 18px; height: 18px; }",
    ".gc-iconbtn:hover { background: var(--gc-line); color: var(--gc-text); }",
    ".gc-iconbtn:active { transform: scale(.9); }",
    ".gc-iconbtn[aria-pressed='true'] { color: var(--gc-primary); }",
    ".gc-row { animation: gc-in .28s var(--gc-ease) both; }",
    ".gc-msgs { flex: 1; overflow: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; }",
    ".gc-row { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; max-width: 92%; }",
    ".gc-row.user { align-self: flex-end; align-items: flex-end; }",
    ".gc-bubble { padding: 10px 12px; border-radius: 16px; background: var(--gc-bubble); border: 1px solid var(--gc-line); line-height: 1.5; font-size: 14px; color: var(--gc-text); word-wrap: break-word; }",
    ".gc-row.user .gc-bubble { background: var(--gc-user); }",
    ".gc-row.agent .gc-bubble { border-color: color-mix(in srgb, #34d399 45%, var(--gc-line)); box-shadow: inset 3px 0 0 #34d399; }",
    ".gc-agent-name { font-size: 11px; font-weight: 700; color: #34d399; display: inline-flex; align-items: center; gap: 5px; padding-left: 2px; }",
    ".gc-agent-name svg { width: 12px; height: 12px; }",
    ".gc-row.system { align-self: center; align-items: center; max-width: 100%; }",
    ".gc-row.system .gc-bubble { background: transparent; border: 1px dashed var(--gc-line); color: var(--gc-muted); font-size: 12px; padding: 6px 12px; border-radius: 999px; text-align: center; }",
    ".gc-root[data-live='true'] .gc-avatar { background: radial-gradient(120% 120% at 30% 15%, #6ee7b7, #10b981 45%, #047857); }",
    ".gc-root[data-live='true'] .gc-sub { color: #34d399; opacity: 1; }",
    ".gc-root[data-live='waiting'] .gc-avatar::after { background: #fbbf24; animation: gc-breathe 1.6s ease-in-out infinite; }",
    ".gc-bubble a { color: var(--gc-primary); }",
    ".gc-bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: rgba(0,0,0,.25); padding: 1px 5px; border-radius: 6px; }",
    ".gc-code { margin: 8px 0 0; padding: 10px; overflow: auto; border-radius: 12px; background: #0b0612; color: #f5f3ff; font-size: 12px; }",
    ".gc-root[data-mode='light'] .gc-code { background: #1e1133; }",
    ".gc-sources, .gc-suggest, .gc-actions { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".gc-chip, .gc-src { border: 1px solid var(--gc-line); background: transparent; color: var(--gc-muted); border-radius: 999px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer; text-decoration: none; transition: border-color .18s, color .18s, background .18s; }",
    ".gc-sources { width: 100%; }",
    ".gc-src { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; box-sizing: border-box; min-width: 0; }",
    ".gc-src svg { width: 12px; height: 12px; flex: none; opacity: .8; }",
    ".gc-src span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".gc-chip:hover, .gc-src:hover { border-color: var(--gc-primary); color: var(--gc-text); }",
    ".gc-lead { width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--gc-line); border-radius: 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--gc-primary) 10%, var(--gc-bubble)), var(--gc-bubble)); font-size: 13px; color: var(--gc-text); }",
    ".gc-lead-t { display: flex; align-items: center; gap: 8px; font-weight: 650; }",
    ".gc-lead-t svg { width: 16px; height: 16px; color: var(--gc-primary); flex: none; }",
    ".gc-lead-t small { display: block; font-weight: 400; color: var(--gc-muted); font-size: 12px; margin-top: 1px; }",
    ".gc-lead-r { display: flex; gap: 6px; }",
    ".gc-lead input { flex: 1; min-width: 0; border: 1px solid var(--gc-line); background: rgba(0,0,0,.12); color: var(--gc-text); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; }",
    ".gc-lead button { flex: none; border: 0; border-radius: 10px; padding: 8px 12px; background: linear-gradient(135deg, var(--gc-primary), var(--gc-accent, #7c3aed)); color: #fff; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }",
    ".gc-lead-done { color: var(--gc-muted); }",
    ".gc-composer { display: flex; align-items: flex-end; gap: 6px; margin: 10px 12px 10px; padding: 5px 5px 5px 4px; border: 1px solid var(--gc-line); border-radius: 18px; background: rgba(0,0,0,.14); transition: border-color .18s, box-shadow .18s; }",
    ".gc-root[data-mode='light'] .gc-composer { background: rgba(255,255,255,.6); }",
    ".gc-composer:focus-within { border-color: color-mix(in srgb, var(--gc-primary) 60%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gc-primary) 18%, transparent); }",
    ".gc-composer textarea { flex: 1; resize: none; min-height: 36px; max-height: 120px; box-sizing: border-box; border: 0; outline: none; background: transparent; color: var(--gc-text); padding: 8px 8px; font: inherit; font-size: 14px; line-height: 1.4; }",
    ".gc-composer textarea:focus-visible { outline: none; }",
    ".gc-composer .gc-iconbtn { width: 36px; height: 36px; }",
    ".gc-send { flex: none; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center; color: #fff; cursor: pointer; background: linear-gradient(135deg, var(--gc-primary), var(--gc-accent, #7c3aed)); box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--gc-accent, #7c3aed) 70%, transparent), inset 0 1px 0 rgba(255,255,255,.3); transition: transform .2s var(--gc-spring), opacity .2s, filter .2s; }",
    ".gc-send svg { width: 17px; height: 17px; transform: translateX(-1px); }",
    ".gc-send:hover { transform: translateY(-1px) scale(1.05); }",
    ".gc-send:active { transform: scale(.9); }",
    ".gc-send:disabled { opacity: .45; cursor: default; transform: none; filter: saturate(.6); }",
    ".gc-notice { align-self: center; font-size: 12px; color: var(--gc-muted); padding: 6px 12px; border: 1px solid var(--gc-line); border-radius: 999px; background: var(--gc-bubble); }",
    ".gc-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 14px 11px; font-size: 11px; line-height: 1; letter-spacing: .01em; }",
    ".gc-brand a { color: var(--gc-muted); text-decoration: none; opacity: .72; display: inline-flex; align-items: center; gap: 5px; transition: opacity .18s, color .18s; white-space: nowrap; }",
    ".gc-brand a:hover, .gc-brand a:focus-visible { opacity: 1; color: var(--gc-text); outline: none; }",
    ".gc-brand b { font-weight: 700; color: var(--gc-text); }",
    ".gc-brand svg { width: 12px; height: 12px; }",
    ".gc-brand .gc-add { opacity: .9; padding: 5px 9px; border-radius: 999px; border: 1px solid var(--gc-line); background: linear-gradient(135deg, color-mix(in srgb, var(--gc-primary) 14%, transparent), transparent); }",
    ".gc-brand .gc-add:hover { border-color: var(--gc-primary); }",
    ".gc-typing { display: flex; gap: 4px; padding: 8px 4px; }",
    ".gc-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--gc-muted); animation: gc-dots 1s infinite; }",
    ".gc-typing i:nth-child(2) { animation-delay: .15s; }",
    ".gc-typing i:nth-child(3) { animation-delay: .3s; }",
    "@keyframes gc-dots { 0%,80%,100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }",
    ".gc-fb { display: flex; gap: 2px; margin-left: 2px; }",
    ".gc-fb button { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; cursor: pointer; color: var(--gc-muted); opacity: .7; display: grid; place-items: center; transition: opacity .18s, background .18s, color .18s, transform .18s var(--gc-spring); }",
    ".gc-fb button svg { width: 15px; height: 15px; }",
    ".gc-fb button:hover { opacity: 1; background: var(--gc-line); }",
    ".gc-fb button:active { transform: scale(.88); }",
    ".gc-fb button.on { color: var(--gc-primary); opacity: 1; }",
    ".gc-cards { display: flex; flex-direction: column; gap: 8px; width: 100%; }",
    ".gc-card { width: 100%; border: 1px solid var(--gc-line); border-radius: 16px; padding: 10px; background: var(--gc-bubble); display: flex; gap: 10px; align-items: flex-start; }",
    ".gc-card img { width: 56px; height: 56px; object-fit: cover; border-radius: 10px; }",
    ".gc-card h4 { margin: 0 0 2px; font-size: 13px; }",
    ".gc-card p { margin: 0 0 8px; font-size: 12px; color: var(--gc-muted); }",
    ".gc-card .gc-cta, .gc-copy { border: 0; border-radius: 10px; padding: 6px 10px; background: var(--gc-primary); color: #160b27; font-weight: 700; cursor: pointer; font-size: 12px; text-decoration: none; display: inline-block; }",
    ".gc-codechip { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; padding: 4px 8px; border: 1px dashed var(--gc-line); border-radius: 8px; margin-right: 6px; }",
    ".gc-modal { position: fixed; inset: 0; z-index: calc(var(--gc-z, 2147483000) + 1); background: rgba(5,2,12,.72); display: none; place-items: center; padding: 16px; }",
    ".gc-modal.on { display: grid; }",
    ".gc-modal-box { width: min(440px, 100%); height: min(640px, 90vh); background: var(--gc-panel); border: 1px solid var(--gc-line); border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; }",
    ".gc-modal-box header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--gc-line); color: var(--gc-text); font-weight: 700; }",
    ".gc-modal-box iframe { flex: 1; width: 100%; border: 0; background: #fff; }",
    "@media (prefers-reduced-motion: reduce) { .gc-root *, .gc-root *::before, .gc-root *::after { animation: none !important; transition-duration: .01ms !important; } .gc-launcher::after { opacity: .45; } }"
  ].join("\n");

  var host = el("div", { class: "gc-host", id: "ghostchat-host" });
  // Own top-level stacking context at the maximum z-index so site overlays can't cover the chat.
  host.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;z-index:var(--gc-z, 2147483646);";
  var shadow = host.attachShadow({ mode: "open" });
  // Load the widget font only when the panel first opens, so the host page's load isn't slowed.
  var fontLoaded = false;
  function loadFont() {
    if (fontLoaded) return;
    fontLoaded = true;
    document.head.appendChild(el("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" }));
  }

  // One icon set: 24px grid, 1.75 stroke, round caps and joins. currentColor everywhere so brand colours apply.
  function icon(body, fill) {
    return '<svg viewBox="0 0 24 24" width="24" height="24" fill="' + (fill ? "currentColor" : "none") + '" stroke="' + (fill ? "none" : "currentColor") + '" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + "</svg>";
  }
  // The GhostChat mark: a soft ghost with a scalloped hem and cut-out eyes (evenodd).
  var GHOST_PATH = "M12 2.6c-4.3 0-7.4 3.2-7.4 7.5v9.6c0 .9 1 1.4 1.7.8l1.5-1.2 1.6 1.4c.5.4 1.2.4 1.7 0L12 19.3l1.9 1.4c.5.4 1.2.4 1.7 0l1.6-1.4 1.5 1.2c.7.6 1.7.1 1.7-.8v-9.6c0-4.3-3.1-7.5-7.4-7.5ZM9.3 9.4a1.35 1.6 0 1 0 0 3.2 1.35 1.6 0 0 0 0-3.2Zm5.4 0a1.35 1.6 0 1 0 0 3.2 1.35 1.6 0 0 0 0-3.2Z";
  var ICONS = {
    ghost: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="' + GHOST_PATH + '"/></svg>',
    send: icon('<path d="M4.5 12h11"/><path d="M4.2 4.6 20 12 4.2 19.4c-.5.2-1-.3-.8-.8L6.1 12 3.4 5.4c-.2-.5.3-1 .8-.8Z"/>'),
    close: icon('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    minimize: icon('<path d="M6.5 9.5 12 15l5.5-5.5"/>'),
    mic: icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
    attach: icon('<path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>'),
    link: icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    up: icon('<path d="M7.5 10.5v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h2.5Zm0 0 3.6-6.3a1.6 1.6 0 0 1 2.9 1.2l-.8 3.6h4.9a2 2 0 0 1 2 2.4l-1.3 6a2 2 0 0 1-2 1.6H7.5"/>'),
    down: icon('<path d="M16.5 13.5v-9H19a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2.5Zm0 0-3.6 6.3a1.6 1.6 0 0 1-2.9-1.2l.8-3.6H5.9a2 2 0 0 1-2-2.4l1.3-6a2 2 0 0 1 2-1.6h9.3"/>'),
    copy: icon('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
    check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    speaker: icon('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    sound: icon('<path d="M6 16.5V8l11-2.5v8.5"/><circle cx="4.5" cy="16.5" r="2"/><circle cx="15.5" cy="14" r="2"/>'),
    person: icon('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>')
  };

  var root = el("div", { class: "gc-root", "data-mode": state.themeMode === "light" ? "light" : "dark" });
  root.style.setProperty("--gc-primary", state.primary);

  var launcher = el("button", {
    class: "gc-launcher", type: "button", "aria-label": "Open chat", "aria-expanded": "false",
    html: '<span class="gc-li gc-li-ghost">' + ICONS.ghost + '</span><span class="gc-li gc-li-close">' + ICONS.close + '</span><span class="gc-dot"></span>'
  });
  var panel = el("div", { class: "gc-panel", role: "dialog", "aria-label": "Chat" });
  var title = el("h2", { text: state.name });
  var soundBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Sound", "aria-label": "Message sound", "aria-pressed": "false", html: ICONS.sound });
  var voiceBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Read replies aloud", "aria-label": "Read replies aloud", "aria-pressed": "false", html: ICONS.speaker, hidden: "hidden" });
  var micBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Speak", "aria-label": "Ask by voice", html: ICONS.mic, hidden: "hidden" });
  var closeBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Minimise", "aria-label": "Minimise chat", html: ICONS.minimize });
  var avatar = el("div", { class: "gc-avatar", html: ICONS.ghost });
  var sub = el("span", { class: "gc-sub", text: "AI assistant · Online" });
  var head = el("div", { class: "gc-head" }, [
    avatar,
    el("div", { class: "gc-title" }, [title, sub]),
    voiceBtn, soundBtn, closeBtn
  ]);
  var msgs = el("div", { class: "gc-msgs", role: "log", "aria-live": "polite" });
  var input = el("textarea", { rows: "1", placeholder: "Ask a question…", "aria-label": "Your message" });
  var sendBtn = el("button", { class: "gc-send", type: "button", title: "Send", "aria-label": "Send message", html: ICONS.send });
  var composer = el("div", { class: "gc-composer" }, [input, micBtn, sendBtn]);
  var brand = el("div", { class: "gc-brand" });
  panel.appendChild(head);
  panel.appendChild(msgs);
  panel.appendChild(composer);
  panel.appendChild(brand);
  var modal = el("div", { class: "gc-modal" });
  var modalBox = el("div", { class: "gc-modal-box" });
  var modalTitle = el("div", { text: "Book a time" });
  var modalClose = el("button", { class: "gc-iconbtn", type: "button", "aria-label": "Close", html: ICONS.close });
  var modalHead = el("header", {}, [modalTitle, modalClose]);
  var modalFrame = el("iframe", { title: "Booking calendar", allow: "payment; fullscreen" });
  modalBox.appendChild(modalHead);
  modalBox.appendChild(modalFrame);
  modal.appendChild(modalBox);
  modalClose.addEventListener("click", function () { modal.classList.remove("on"); modalFrame.src = "about:blank"; });
  modal.addEventListener("click", function (ev) { if (ev.target === modal) modalClose.click(); });
  function openBooking(url) {
    if (!url) return;
    try {
      var parsed = new URL(url, window.location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      modalFrame.src = parsed.href;
      modal.classList.add("on");
    } catch (e) {}
  }

  root.appendChild(panel);
  root.appendChild(launcher);
  root.appendChild(modal);
  shadow.appendChild(el("style", { text: css }));
  shadow.appendChild(root);
  document.documentElement.appendChild(host);

  function setUnread(on) {
    state.unread = !!on;
    root.setAttribute("data-unread", on ? "true" : "false");
    launcher.setAttribute("aria-label", state.open ? "Close chat" : on ? "Open chat (new message)" : "Open chat");
  }
  var announced = null;
  function announce(open) {
    // Let the host page react (e.g. hide its own floating buttons) while the chat is open.
    if (announced === open) return;
    announced = open;
    try { document.documentElement.classList.toggle("ghostchat-open", open); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent(open ? "ghostchat:open" : "ghostchat:close", { detail: { siteKey: SITE_KEY } })); } catch (e) {}
  }
  function setOpen(open) {
    state.open = open;
    announce(!!open);
    root.setAttribute("data-open", open ? "true" : "false");
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    setUnread(open ? false : state.unread);
    if (open) {
      try { sessionStorage.setItem("gc_seen_" + SITE_KEY, "1"); } catch (e) {}
      loadFont();
      input.focus();
      maybeGreet();
    }
  }
  function setThinking(on) {
    state.thinking = on;
    root.setAttribute("data-thinking", on ? "true" : "false");
  }
  function setBranding() {
    if (state.showBranding) {
      var ref = "?utm_source=widget&utm_medium=referral&utm_campaign=" + encodeURIComponent(window.location.hostname || "embed");
      brand.innerHTML =
        '<a class="gc-pb" href="' + API_BASE + '/' + ref + '" target="_blank" rel="noopener">' +
        ICONS.ghost +
        'Powered by <b>GhostChat</b></a>' +
        '<a class="gc-add" href="' + API_BASE + '/signup' + ref + '" target="_blank" rel="noopener">Add to your website →</a>';
      brand.style.display = "";
    } else {
      brand.style.display = "none";
    }
  }
  function playPop() {
    if (!state.sound) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 660;
      g.gain.value = 0.04;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.stop(ctx.currentTime + 0.13);
    } catch (e) {}
  }
  function scrollDown() { msgs.scrollTop = msgs.scrollHeight; }

  function addBubble(role, html) {
    var row = el("div", { class: "gc-row " + role });
    var bubble = el("div", { class: "gc-bubble" });
    bubble.innerHTML = html;
    row.appendChild(bubble);
    msgs.appendChild(row);
    scrollDown();
    return row;
  }

  function addSources(row, sources) {
    if (!sources || !sources.length) return;
    var wrap = el("div", { class: "gc-sources" });
    sources.slice(0, 3).forEach(function (s) {
      var label = s.title || s.url || "Source";
      var inner = ICONS.link + "<span>" + escapeHtml(label) + "</span>";
      if (s.url) wrap.appendChild(el("a", { class: "gc-src", href: s.url, target: "_blank", rel: "noopener noreferrer", title: label, html: inner }));
      else wrap.appendChild(el("span", { class: "gc-src", title: label, html: inner }));
    });
    row.appendChild(wrap);
  }

  function addSuggestions(list) {
    if (!list || !list.length) return;
    var existing = msgs.querySelectorAll(".gc-suggest");
    existing.forEach(function (n) { n.remove(); });
    var wrap = el("div", { class: "gc-suggest" });
    list.forEach(function (q) {
      var chip = el("button", { class: "gc-chip", type: "button", text: q });
      chip.addEventListener("click", function () { sendMessage(q); });
      wrap.appendChild(chip);
    });
    msgs.appendChild(wrap);
    scrollDown();
  }

  function addLeadForm(row, card) {
    if (msgs.querySelector(".gc-lead")) return; // one follow-up box per conversation
    var form = el("form", { class: "gc-lead", "aria-label": "Ask a human to follow up" });
    var t = el("div", { class: "gc-lead-t", html: ICONS.person });
    var tx = el("div");
    tx.appendChild(document.createTextNode((card && card.title) || "Want a human to follow up?"));
    tx.appendChild(el("small", { text: (card && card.subtitle) || "Leave your email and the team will get back to you." }));
    t.appendChild(tx);
    var email = el("input", { type: "email", required: "required", placeholder: "you@email.com", "aria-label": "Your email", autocomplete: "email" });
    var btn = el("button", { type: "submit", text: (card && card.cta) || "Send" });
    form.appendChild(t);
    form.appendChild(el("div", { class: "gc-lead-r" }, [email, btn]));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      btn.disabled = true;
      fetch(API_BASE + "/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteKey: SITE_KEY, sessionId: state.sessionId, email: email.value })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          form.innerHTML = "";
          form.appendChild(el("div", { class: "gc-lead-t gc-lead-done", html: ICONS.check + "<span>" + escapeHtml(res.ok ? "Thanks! The team will follow up by email." : (res.j.error || "Could not send just now.")) + "</span>" }));
        })
        .catch(function () { btn.disabled = false; });
    });
    row.appendChild(form);
    scrollDown();
  }


  function addCards(row, cards) {
    if (!cards || !cards.length) return;
    var wrap = el("div", { class: "gc-cards" });
    cards.forEach(function (card) {
      if (card.type === "form") { addLeadForm(wrap, card); return; }
      var box = el("div", { class: "gc-card" });
      if (card.image && card.type === "product") box.appendChild(el("img", { src: card.image, alt: "" }));
      var body = el("div");
      body.appendChild(el("h4", { text: card.title || "Card" }));
      if (card.subtitle || card.price) body.appendChild(el("p", { text: [card.price, card.subtitle].filter(Boolean).join(" · ") }));
      if (card.type === "discount" && card.code) {
        var code = el("span", { class: "gc-codechip", text: card.code });
        var copy = el("button", { class: "gc-copy", type: "button", text: "Copy code" });
        copy.addEventListener("click", function () {
          if (navigator.clipboard) navigator.clipboard.writeText(card.code);
          copy.textContent = "Copied";
        });
        body.appendChild(code);
        body.appendChild(copy);
      } else if (card.type === "booking" || card.url) {
        var cta = el(card.type === "booking" ? "button" : "a", {
          class: "gc-cta",
          type: card.type === "booking" ? "button" : undefined,
          href: card.type === "booking" ? undefined : card.url,
          target: card.type === "booking" ? undefined : "_blank",
          rel: "noopener noreferrer",
          text: card.cta || (card.type === "booking" ? "Open calendar" : "View")
        });
        if (card.type === "booking") cta.addEventListener("click", function () { openBooking(card.url || state.bookingUrl); });
        body.appendChild(cta);
      }
      box.appendChild(body);
      wrap.appendChild(box);
    });
    if (wrap.childNodes.length) row.appendChild(wrap);
  }

  function speak(text) {
    if (!state.voiceOutput || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      var clean = String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/[`*_#]/g, " ").trim();
      if (!clean) return;
      var u = new SpeechSynthesisUtterance(clean.slice(0, 800));
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function canListen() {
    return state.voice && (window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function startListening() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    var rec = new Ctor();
    rec.lang = document.documentElement.lang || "en-GB";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (ev) {
      var said = ev.results && ev.results[0] && ev.results[0][0] && ev.results[0][0].transcript;
      if (said) sendMessage(said);
    };
    rec.onerror = function () { micBtn.style.color = ""; };
    rec.onend = function () { micBtn.style.color = ""; };
    micBtn.style.color = "var(--gc-primary)";
    rec.start();
  }

  function addFeedback(row, logId, text) {
    if (!logId) return;
    var wrap = el("div", { class: "gc-fb" });
    var copyBtn = el("button", { type: "button", title: "Copy", "aria-label": "Copy reply", html: ICONS.copy });
    copyBtn.addEventListener("click", function () {
      try { if (navigator.clipboard) navigator.clipboard.writeText(text || ""); } catch (e) {}
      copyBtn.innerHTML = ICONS.check; copyBtn.classList.add("on");
      setTimeout(function () { copyBtn.innerHTML = ICONS.copy; copyBtn.classList.remove("on"); }, 1400);
    });
    wrap.appendChild(copyBtn);
    ["up", "down"].forEach(function (rating) {
      var b = el("button", { type: "button", html: rating === "up" ? ICONS.up : ICONS.down, title: rating === "up" ? "Helpful" : "Not helpful", "aria-label": rating === "up" ? "Helpful" : "Not helpful", "aria-pressed": "false" });
      b.addEventListener("click", function () {
        wrap.querySelectorAll("button[aria-pressed]").forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("on"); b.setAttribute("aria-pressed", "true");
        fetch(API_BASE + "/api/chat/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ siteKey: SITE_KEY, logId: logId, rating: rating })
        }).catch(function () {});
      });
      wrap.appendChild(b);
    });
    row.appendChild(wrap);
  }

  // ---- live human takeover ----
  var live = { status: "bot", agent: "", after: "", timer: null, typingRow: null, lastTyping: 0, seen: {} };
  function setLiveUi() {
    var on = live.status === "human" || live.status === "waiting";
    root.setAttribute("data-live", live.status === "human" ? "true" : live.status === "waiting" ? "waiting" : "false");
    avatar.innerHTML = on ? ICONS.person : ICONS.ghost;
    sub.textContent = live.status === "human" ? "You're chatting with " + (live.agent || "the team")
      : live.status === "waiting" ? "Connecting you to " + (live.agent || "the team") + "…"
      : "AI assistant · Online";
    input.placeholder = on ? "Message " + (live.agent || "the team") + "…" : "Ask a question…";
  }
  function addSystem(text) { return addBubble("system", escapeHtml(text)); }
  function addAgent(text, name) {
    var row = addBubble("agent", renderMarkdown(text));
    row.insertBefore(el("span", { class: "gc-agent-name", html: ICONS.person + escapeHtml(name || live.agent || "Team") }), row.firstChild);
    return row;
  }
  function showAgentTyping(on) {
    if (on && !live.typingRow) {
      live.typingRow = el("div", { class: "gc-row agent" }, [el("div", { class: "gc-bubble" }, [el("div", { class: "gc-typing" }, [el("i"), el("i"), el("i")])])]);
      msgs.appendChild(live.typingRow);
      scrollDown();
    } else if (!on && live.typingRow) { live.typingRow.remove(); live.typingRow = null; }
  }
  function schedulePoll() {
    clearTimeout(live.timer);
    if (live.status !== "human" && live.status !== "waiting") return;
    live.timer = setTimeout(pollLive, state.open && !document.hidden ? 2500 : 9000);
  }
  function pollLive() {
    var q = live.after ? "?after=" + encodeURIComponent(live.after) : "";
    fetch(API_BASE + "/api/live/" + encodeURIComponent(SITE_KEY) + "/" + encodeURIComponent(state.sessionId) + q, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        if (j.agentName) live.agent = j.agentName;
        var fresh = false;
        (j.messages || []).forEach(function (m) {
          if (live.seen[m.id]) return;
          live.seen[m.id] = 1;
          live.after = m.created_at;
          showAgentTyping(false);
          if (m.role === "agent") { addAgent(m.message, m.agent_name); fresh = true; }
          else addSystem(m.message);
        });
        var prev = live.status;
        live.status = j.status === "human" || j.status === "waiting" ? j.status : "bot";
        showAgentTyping(live.status === "human" || live.status === "waiting" ? !!j.typing : false);
        if (prev !== live.status) setLiveUi();
        if (fresh) { playPop(); if (!state.open) setUnread(true); }
      })
      .catch(function () {})
      .then(schedulePoll);
  }
  function enterLive(ev) {
    var was = live.status;
    live.status = ev.status === "human" ? "human" : "waiting";
    if (ev.agentName) live.agent = ev.agentName;
    if (ev.note) addSystem(ev.note);
    setLiveUi();
    if (was !== "human" && was !== "waiting") schedulePoll();
  }
  function visitorTyping() {
    if (live.status !== "human" && live.status !== "waiting") return;
    var now = Date.now();
    if (now - live.lastTyping < 3000) return;
    live.lastTyping = now;
    fetch(API_BASE + "/api/live/" + encodeURIComponent(SITE_KEY) + "/" + encodeURIComponent(state.sessionId) + "/typing", { method: "POST" }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && live.timer) { clearTimeout(live.timer); pollLive(); } });

  function maybeGreet() {
    if (state.greeted) return;
    state.greeted = true;
    var text = state.greeting || "Hi — how can I help?";
    var row = addBubble("assistant", renderMarkdown(text));
    var starters = (state.starters || []).slice();
    if (state.bookingUrl && starters.indexOf("Book a time") === -1) starters.push("Book a time");
    addSuggestions(starters);
    void row;
  }

  function sendMessage(text) {
    var message = (text || input.value || "").trim();
    if (!message || state.sending) return;
    input.value = "";
    state.sending = true;
    sendBtn.disabled = true;
    addBubble("user", escapeHtml(message));
    setThinking(true);
    var typing = el("div", { class: "gc-row assistant" });
    typing.appendChild(el("div", { class: "gc-bubble" }, [
      el("div", { class: "gc-typing" }, [el("i"), el("i"), el("i")])
    ]));
    msgs.appendChild(typing);
    scrollDown();

    var row = null;
    var bubble = null;
    var acc = "";
    var gotLive = false;
    var finished = false;

    function ensureRow() {
      if (row) return;
      typing.remove();
      row = addBubble("assistant", "");
      bubble = row.querySelector(".gc-bubble");
    }

    fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        siteKey: SITE_KEY,
        message: message,
        sessionId: state.sessionId,
        pageUrl: window.location.href,
        stream: true
      })
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          ensureRow();
          acc = (j && j.error) || "I couldn't reply just now. Please try again in a moment.";
          bubble.innerHTML = renderMarkdown(acc);
          finish(null);
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (part) {
          if (part.done) return finish(null);
          buf += decoder.decode(part.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          lines.forEach(function (line) {
            var t = line.trim();
            if (t.indexOf("data:") !== 0) return;
            var data = t.slice(5).trim();
            if (!data) return;
            try {
              var ev = JSON.parse(data);
              if (ev.type === "token" && ev.text) {
                ensureRow();
                acc += ev.text;
                bubble.innerHTML = renderMarkdown(acc);
                scrollDown();
              } else if (ev.type === "live") {
                gotLive = true;
                enterLive(ev);
              } else if (ev.type === "done") {
                finish(ev);
              } else if (ev.type === "error") {
                ensureRow();
                acc = ev.error || "I couldn't reply just now.";
                bubble.innerHTML = renderMarkdown(acc);
              }
            } catch (e) {}
          });
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      ensureRow();
      bubble.innerHTML = "I couldn't reach the assistant just now. Please try again.";
      finish(null);
    });

    function finish(ev) {
      if (finished) return;
      if (!ev && gotLive && !acc) {
        // A human has the chat: no AI bubble.
        finished = true;
        typing.remove();
        setThinking(false);
        state.sending = false;
        sendBtn.disabled = false;
        return;
      }
      finished = true;
      ensureRow();
      setThinking(false);
      state.sending = false;
      sendBtn.disabled = false;
      if (ev && ev.answer && !acc) {
        acc = ev.answer;
        bubble.innerHTML = renderMarkdown(acc);
      }
      if (ev && ev.sources) addSources(row, ev.sources);
      if (ev && ev.suggestions) addSuggestions(ev.suggestions);
      if (ev && ev.cards) addCards(row, ev.cards);
      speak(acc || (ev && ev.answer) || "");
      if (ev && ev.assistantLogId) {
        state.lastLogId = ev.assistantLogId;
        addFeedback(row, ev.assistantLogId, acc || ev.answer);
      }
      playPop();
      if (!state.open) setUnread(true);
      scrollDown();
    }
  }

  launcher.addEventListener("click", function () { setOpen(!state.open); });
  closeBtn.addEventListener("click", function () { setOpen(false); launcher.focus(); });
  panel.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { setOpen(false); launcher.focus(); } });
  soundBtn.addEventListener("click", function () {
    state.sound = !state.sound;
    try { localStorage.setItem("gc_sound_" + SITE_KEY, state.sound ? "1" : "0"); } catch (e) {}
    soundBtn.setAttribute("aria-pressed", state.sound ? "true" : "false");
  });
  voiceBtn.addEventListener("click", function () {
    state.voiceOutput = !state.voiceOutput;
    voiceBtn.setAttribute("aria-pressed", state.voiceOutput ? "true" : "false");
    if (!state.voiceOutput && window.speechSynthesis) window.speechSynthesis.cancel();
  });
  micBtn.addEventListener("click", function () { startListening(); });
  sendBtn.addEventListener("click", function () { sendMessage(); });
  input.addEventListener("input", visitorTyping);
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendMessage();
    }
  });

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.name) { state.name = cfg.name; title.textContent = cfg.name; }
    if (cfg.greeting) state.greeting = cfg.greeting;
    if (cfg.starterQuestions) state.starters = cfg.starterQuestions;
    if (typeof cfg.proactiveDelayMs === "number" && !isNaN(state.delay)) { /* attr wins if set */ }
    if (typeof cfg.proactiveDelayMs === "number" && isNaN(state.delay)) state.delay = cfg.proactiveDelayMs;
    if (typeof cfg.soundDefault === "boolean" && localStorage.getItem("gc_sound_" + SITE_KEY) == null) state.sound = cfg.soundDefault;
    if (cfg.theme) {
      if (cfg.theme.mode) state.themeMode = cfg.theme.mode;
      if (cfg.theme.primary) state.primary = cfg.theme.primary;
      if (cfg.theme.accent && /^#[0-9a-f]{3,8}$/i.test(cfg.theme.accent)) root.style.setProperty("--gc-accent", cfg.theme.accent);
    }
    if (typeof cfg.showBranding === "boolean") state.showBranding = cfg.showBranding;
    if (typeof cfg.voiceEnabled === "boolean") state.voice = cfg.voiceEnabled;
    if (cfg.bookingUrl) state.bookingUrl = cfg.bookingUrl;
    if (cfg.bookingProvider) state.bookingProvider = cfg.bookingProvider;
    voiceBtn.hidden = !(state.voice && window.speechSynthesis);
    micBtn.hidden = !canListen();
    root.setAttribute("data-mode", state.themeMode === "light" ? "light" : "dark");
    root.style.setProperty("--gc-primary", state.primary);
    soundBtn.setAttribute("aria-pressed", state.sound ? "true" : "false");
    setBranding();
  }

  applyConfig({ greeting: state.greeting, showBranding: true });
  setOpen(state.open);
  try { if (!state.open && !sessionStorage.getItem("gc_seen_" + SITE_KEY)) setTimeout(function () { if (!state.open) setUnread(true); }, 1500); } catch (e) {}
  soundBtn.setAttribute("aria-pressed", state.sound ? "true" : "false");

  // Proactive open: data-delay wins, then the site's setting, then 4s. 0 turns it off.
  function scheduleProactive() {
    var delay = isNaN(state.delay) ? 4000 : state.delay;
    if (!state.open && delay > 0) {
      setTimeout(function () {
        if (!state.open) setOpen(true);
      }, delay);
    }
  }

  if (SITE_KEY && state.sessionId) {
    fetch(API_BASE + "/api/live/" + encodeURIComponent(SITE_KEY) + "/" + encodeURIComponent(state.sessionId), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && (j.status === "human" || j.status === "waiting")) { live.agent = j.agentName || ""; enterLive({ status: j.status }); pollLive(); } })
      .catch(function () {});
  }

  if (SITE_KEY) {
    fetch(API_BASE + "/api/widget/config/" + encodeURIComponent(SITE_KEY))
      .then(function (r) { return r.json(); })
      .then(function (j) { applyConfig(j.config); if (state.open) maybeGreet(); })
      .catch(function () {})
      .then(scheduleProactive);
  } else {
    scheduleProactive();
  }
})();
