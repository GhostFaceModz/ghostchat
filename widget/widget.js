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
    ".gc-launcher { position: fixed; right: var(--gc-offset-right, 22px); bottom: var(--gc-offset-bottom, 22px); z-index: var(--gc-z, 2147483000); width: 64px; height: 64px; border: 0; border-radius: 20px; cursor: pointer; background: linear-gradient(160deg, var(--gc-primary), var(--gc-accent, #7c3aed)); box-shadow: 0 16px 40px color-mix(in srgb, var(--gc-accent, #7c3aed) 38%, transparent), inset 0 1px 0 rgba(255,255,255,.25); display: grid; place-items: center; transition: transform .2s ease, box-shadow .2s; }",
    ".gc-launcher:hover { transform: translateY(-2px) scale(1.03); }",
    ".gc-ghost { width: 36px; height: 36px; animation: gc-float 3.2s ease-in-out infinite; }",
    ".gc-root[data-thinking='true'] .gc-ghost { animation: gc-think .7s ease-in-out infinite; }",
    "@keyframes gc-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }",
    "@keyframes gc-think { 0%,100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-5px) rotate(6deg); } }",
    ".gc-panel { position: fixed; right: max(12px, var(--gc-offset-right, 22px)); bottom: calc(var(--gc-offset-bottom, 22px) + 76px); z-index: var(--gc-z, 2147483000); width: min(400px, calc(100vw - 24px)); height: min(640px, calc(100vh - var(--gc-offset-bottom, 22px) - 108px)); height: min(640px, calc(100dvh - var(--gc-offset-bottom, 22px) - 108px)); display: flex; flex-direction: column; border-radius: 24px; overflow: hidden; background: var(--gc-panel); border: 1px solid var(--gc-line); box-shadow: 0 30px 80px rgba(0,0,0,.4); backdrop-filter: blur(22px) saturate(1.3); -webkit-backdrop-filter: blur(22px) saturate(1.3); opacity: 0; pointer-events: none; transform: translateY(16px) scale(.98); transition: opacity .22s ease, transform .22s ease; }",
    ".gc-root[data-open='true'] .gc-panel { opacity: 1; pointer-events: auto; transform: none; }",
    ".gc-head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px; border-bottom: 1px solid var(--gc-line); }",
    ".gc-head h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -.02em; flex: 1; color: var(--gc-text); }",
    ".gc-iconbtn { width: 32px; height: 32px; border: 0; background: transparent; color: var(--gc-muted); cursor: pointer; border-radius: 10px; font-size: 16px; }",
    ".gc-iconbtn:hover { background: var(--gc-line); color: var(--gc-text); }",
    ".gc-msgs { flex: 1; overflow: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; }",
    ".gc-row { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; max-width: 92%; }",
    ".gc-row.user { align-self: flex-end; align-items: flex-end; }",
    ".gc-bubble { padding: 10px 12px; border-radius: 16px; background: var(--gc-bubble); border: 1px solid var(--gc-line); line-height: 1.5; font-size: 14px; color: var(--gc-text); word-wrap: break-word; }",
    ".gc-row.user .gc-bubble { background: var(--gc-user); }",
    ".gc-bubble a { color: var(--gc-primary); }",
    ".gc-bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: rgba(0,0,0,.25); padding: 1px 5px; border-radius: 6px; }",
    ".gc-code { margin: 8px 0 0; padding: 10px; overflow: auto; border-radius: 12px; background: #0b0612; color: #f5f3ff; font-size: 12px; }",
    ".gc-root[data-mode='light'] .gc-code { background: #1e1133; }",
    ".gc-sources, .gc-suggest, .gc-actions { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".gc-chip, .gc-src { border: 1px solid var(--gc-line); background: transparent; color: var(--gc-muted); border-radius: 999px; padding: 5px 10px; font-size: 12px; cursor: pointer; text-decoration: none; }",
    ".gc-chip:hover, .gc-src:hover { border-color: var(--gc-primary); color: var(--gc-text); }",
    ".gc-lead { width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px dashed var(--gc-line); border-radius: 14px; }",
    ".gc-lead input { border: 1px solid var(--gc-line); background: transparent; color: var(--gc-text); border-radius: 10px; padding: 8px 10px; font: inherit; }",
    ".gc-lead button { border: 0; border-radius: 10px; padding: 8px 12px; background: var(--gc-primary); color: #1a1028; font-weight: 650; cursor: pointer; }",
    ".gc-composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--gc-line); }",
    ".gc-composer textarea { flex: 1; resize: none; min-height: 44px; max-height: 120px; border-radius: 14px; border: 1px solid var(--gc-line); background: transparent; color: var(--gc-text); padding: 10px 12px; font: inherit; }",
    ".gc-send { width: 44px; border: 0; border-radius: 14px; background: var(--gc-primary); color: #160b27; font-weight: 800; cursor: pointer; }",
    ".gc-send:disabled { opacity: .5; cursor: default; }",
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
    ".gc-fb { display: flex; gap: 4px; }",
    ".gc-fb button { border: 0; background: transparent; cursor: pointer; color: var(--gc-muted); font-size: 13px; }",
    ".gc-fb button.on { color: var(--gc-primary); }",
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
    ".gc-modal-box iframe { flex: 1; width: 100%; border: 0; background: #fff; }"
  ].join("\n");

  var host = el("div", { class: "gc-host", id: "ghostchat-host" });
  var shadow = host.attachShadow({ mode: "open" });
  // Load the widget font only when the panel first opens, so the host page's load isn't slowed.
  var fontLoaded = false;
  function loadFont() {
    if (fontLoaded) return;
    fontLoaded = true;
    document.head.appendChild(el("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" }));
  }

  var ghostSvg = '<svg class="gc-ghost" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 6c-12 0-22 9.4-22 22.2V52c0 2.6 3 3.8 4.8 1.8L21 47l6.2 7.2c1 1.2 2.8 1.2 3.8 0L37 47l6.2 6.8c1.8 2 4.8.8 4.8-1.8V28.2C48 15.4 44 6 32 6z" fill="white" fill-opacity=".95"/><circle cx="24.5" cy="27" r="3.2" fill="#2a1848"/><circle cx="39.5" cy="27" r="3.2" fill="#2a1848"/><path d="M25 36c2.4 3 11.6 3 14 0" stroke="#2a1848" stroke-width="2" stroke-linecap="round"/></svg>';

  var root = el("div", { class: "gc-root", "data-mode": state.themeMode === "light" ? "light" : "dark" });
  root.style.setProperty("--gc-primary", state.primary);

  var launcher = el("button", { class: "gc-launcher", type: "button", "aria-label": "Open chat", html: ghostSvg });
  var panel = el("div", { class: "gc-panel", role: "dialog", "aria-label": "Chat" });
  var title = el("h2", { text: state.name });
  var soundBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Sound", text: "♪" });
  var voiceBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Read replies aloud", text: "🔊", hidden: "hidden" });
  var micBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Speak", text: "🎤", hidden: "hidden" });
  var closeBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Close", text: "✕" });
  var head = el("div", { class: "gc-head" }, [
    el("div", { html: ghostSvg.replace("gc-ghost", "gc-ghost"), style: "width:28px;height:28px" }),
    title, micBtn, voiceBtn, soundBtn, closeBtn
  ]);
  // fix head ghost sizing
  head.firstChild.style.cssText = "width:28px;height:28px;display:grid;place-items:center";
  var msgs = el("div", { class: "gc-msgs" });
  var input = el("textarea", { rows: "1", placeholder: "Ask a question…" });
  var sendBtn = el("button", { class: "gc-send", type: "button", text: "↑" });
  var composer = el("div", { class: "gc-composer" }, [input, sendBtn]);
  var brand = el("div", { class: "gc-brand" });
  panel.appendChild(head);
  panel.appendChild(msgs);
  panel.appendChild(composer);
  panel.appendChild(brand);
  var modal = el("div", { class: "gc-modal" });
  var modalBox = el("div", { class: "gc-modal-box" });
  var modalTitle = el("div", { text: "Book a time" });
  var modalClose = el("button", { class: "gc-iconbtn", type: "button", text: "✕" });
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

  function setOpen(open) {
    state.open = open;
    root.setAttribute("data-open", open ? "true" : "false");
    if (open) {
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
        '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6c-12 0-22 9.4-22 22.2V52c0 2.6 3 3.8 4.8 1.8L21 47l6.2 7.2c1 1.2 2.8 1.2 3.8 0L37 47l6.2 6.8c1.8 2 4.8.8 4.8-1.8V28.2C48 15.4 44 6 32 6z" fill="currentColor"/></svg>' +
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
    sources.forEach(function (s) {
      var label = s.title || s.url || "Source";
      if (s.url) wrap.appendChild(el("a", { class: "gc-src", href: s.url, target: "_blank", rel: "noopener noreferrer", text: label }));
      else wrap.appendChild(el("span", { class: "gc-src", text: label }));
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

  function addLeadForm(row) {
    var form = el("form", { class: "gc-lead" });
    form.appendChild(el("div", { text: "Want a human to follow up? Leave your email." }));
    var email = el("input", { type: "email", required: "required", placeholder: "you@email.com" });
    var btn = el("button", { type: "submit", text: "Send to the team" });
    form.appendChild(email);
    form.appendChild(btn);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      btn.disabled = true;
      fetch(API_BASE + "/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteKey: SITE_KEY, sessionId: state.sessionId, email: email.value })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          form.innerHTML = res.ok ? "Thanks — the team will follow up." : (res.j.error || "Could not send just now.");
        })
        .catch(function () { form.innerHTML = "Could not send just now."; });
    });
    row.appendChild(form);
  }


  function addCards(row, cards) {
    if (!cards || !cards.length) return;
    var wrap = el("div", { class: "gc-cards" });
    cards.forEach(function (card) {
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
      } else if (card.type === "form") {
        addLeadForm(box);
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
    row.appendChild(wrap);
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

  function addFeedback(row, logId) {
    if (!logId) return;
    var wrap = el("div", { class: "gc-fb" });
    ["up", "down"].forEach(function (rating) {
      var b = el("button", { type: "button", text: rating === "up" ? "👍" : "👎", title: rating === "up" ? "Helpful" : "Not helpful" });
      b.addEventListener("click", function () {
        wrap.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
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
      if (!res.ok || !res.body) throw new Error("request failed");
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
      else if (ev && ev.unsure) addLeadForm(row);
      speak(acc || (ev && ev.answer) || "");
      if (ev && ev.assistantLogId) {
        state.lastLogId = ev.assistantLogId;
        addFeedback(row, ev.assistantLogId);
      }
      playPop();
      scrollDown();
    }
  }

  launcher.addEventListener("click", function () { setOpen(!state.open); });
  closeBtn.addEventListener("click", function () { setOpen(false); });
  soundBtn.addEventListener("click", function () {
    state.sound = !state.sound;
    try { localStorage.setItem("gc_sound_" + SITE_KEY, state.sound ? "1" : "0"); } catch (e) {}
    soundBtn.style.color = state.sound ? "var(--gc-primary)" : "";
  });
  voiceBtn.addEventListener("click", function () {
    state.voiceOutput = !state.voiceOutput;
    voiceBtn.style.color = state.voiceOutput ? "var(--gc-primary)" : "";
    if (!state.voiceOutput && window.speechSynthesis) window.speechSynthesis.cancel();
  });
  micBtn.addEventListener("click", function () { startListening(); });
  sendBtn.addEventListener("click", function () { sendMessage(); });
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
    soundBtn.style.color = state.sound ? "var(--gc-primary)" : "";
    setBranding();
  }

  applyConfig({ greeting: state.greeting, showBranding: true });
  setOpen(state.open);
  soundBtn.style.color = state.sound ? "var(--gc-primary)" : "";

  // Proactive open: data-delay wins, then the site's setting, then 4s. 0 turns it off.
  function scheduleProactive() {
    var delay = isNaN(state.delay) ? 4000 : state.delay;
    if (!state.open && delay > 0) {
      setTimeout(function () {
        if (!state.open) setOpen(true);
      }, delay);
    }
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
