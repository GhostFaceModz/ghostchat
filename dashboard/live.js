// GhostChat dashboard: live human takeover (Inbox + per-bot "Live chat" settings + Telegram/Discord channels).
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago";
  };
  const live = { overview: null, open: null, timer: null, inboxTimer: null, lastCount: -1 };

  // ---------------- Inbox ----------------
  function hideInbox() {
    $("#inbox-view").classList.add("hidden");
    clearInterval(live.inboxTimer); live.inboxTimer = null;
    clearTimeout(live.timer); live.timer = null;
  }
  ["#open-billing", "#open-account", "#owner-avatar", "#site-list", "#new-site", "#tabs"].forEach((sel) => $(sel)?.addEventListener("click", hideInbox, true));

  async function showInbox() {
    state.view = "inbox";
    ["#site-view", "#empty-state", "#billing-view", "#account-view"].forEach((s) => $(s)?.classList.add("hidden"));
    $$("#site-list button").forEach((b) => b.classList.remove("on"));
    $("#inbox-view").classList.remove("hidden");
    await refreshInbox();
    clearInterval(live.inboxTimer);
    live.inboxTimer = setInterval(refreshInbox, 5000);
  }
  $("#open-inbox").addEventListener("click", showInbox);

  function item(c) {
    const status = c.status === "human" ? "<span class='st human'>You're live</span>" : c.status === "waiting" ? "<span class='st waiting'>Waiting for you</span>" : c.status === "bot" ? "<span class='st'>Back with AI</span>" : "<span class='st'>AI</span>";
    const key = c.site_id + ":" + c.session_id;
    const on = live.open && live.open.key === key ? " on" : "";
    return `<button type="button" class="inbox-item${on}" data-site="${esc(c.site_id)}" data-session="${esc(c.session_id)}">
      <span class="ii-top"><b>${esc(c.site_name)}</b> · visitor ${esc(c.session_id.slice(-6))} ${status}</span>
      <span class="ii-prev">${c.visitor_typing ? "<i>typing…</i>" : esc(c.preview || "")}</span>
      <span class="ii-time muted tiny">${esc(ago(c.updated_at))}</span></button>`;
  }

  async function refreshInbox() {
    let data;
    try { data = await req("/api/live/owner/inbox"); } catch (e) { return; }
    const waiting = data.live.filter((c) => c.status === "waiting").length;
    setBadge(waiting);
    if ($("#inbox-view").classList.contains("hidden")) return;
    $("#inbox-live").innerHTML = data.live.length ? data.live.map(item).join("") : "<p class='muted tiny'>No live chats right now.</p>";
    $("#inbox-recent").innerHTML = data.recent.length ? data.recent.map(item).join("") : "<p class='muted tiny'>No recent chats.</p>";
    $("#inbox-updated").textContent = "Updated " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    $$("#inbox-view .inbox-item").forEach((b) => b.addEventListener("click", () => openConversation(b.dataset.site, b.dataset.session)));
  }
  function setBadge(n) {
    const b = $("#inbox-badge");
    b.hidden = !n; b.textContent = String(n);
    if (n > live.lastCount && live.lastCount >= 0 && document.hidden) { try { document.title = "(" + n + ") Live chat waiting · GhostChat"; } catch {} }
    if (!n && /Live chat waiting/.test(document.title)) document.title = "GhostChat · Dashboard";
    live.lastCount = n;
  }
  // keep the badge fresh everywhere in the dashboard
  setInterval(() => { if (state.owner && $("#inbox-view").classList.contains("hidden")) refreshInbox(); }, 20000);
  function openInboxFromUrl() {
    try {
      const q = new URLSearchParams(location.search).get("inbox");
      const m = q && /^([0-9a-f-]{36}):(.{1,80})$/i.exec(q);
      if (!m || !state.owner) return;
      showInbox().then(() => openConversation(m[1], m[2]));
    } catch {}
  }
  setTimeout(() => { if (state.owner) { refreshInbox(); openInboxFromUrl(); } }, 1500);

  async function openConversation(siteId, sessionId) {
    live.open = { key: siteId + ":" + sessionId, siteId, sessionId };
    $$("#inbox-view .inbox-item").forEach((b) => b.classList.toggle("on", b.dataset.site + ":" + b.dataset.session === live.open.key));
    document.querySelector("#inbox-view .inbox")?.classList.add("is-thread");
    await renderConversation(true);
  }

  async function renderConversation(scroll) {
    clearTimeout(live.timer);
    const o = live.open;
    if (!o) return;
    let d;
    try { d = await req("/api/live/owner/inbox/session/" + encodeURIComponent(o.siteId) + "/" + encodeURIComponent(o.sessionId)); } catch (e) { toast(e.message); return; }
    if (!live.open || live.open.key !== o.key) return;
    const c = d.conversation;
    o.conv = c;
    const status = c ? c.status : "ai";
    const pane = $("#inbox-pane");
    const keepDraft = $("#inbox-reply")?.value || "";
    const msgs = d.messages.map((m) => {
      const who = m.role === "user" ? "Visitor" : m.role === "agent" ? (m.agent_name || "You") : m.role === "system" ? "" : "AI";
      return `<div class="im ${esc(m.role)}">${who ? `<span class="im-who">${esc(who)} · ${esc(new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}</span>` : ""}<div class="im-b">${esc(m.message)}</div></div>`;
    }).join("") + (d.visitor_typing ? "<div class='im user'><div class='im-b'><i>typing…</i></div></div>" : "");
    const pill = status === "human" ? "<span class='st human'>You're live</span>" : status === "waiting" ? "<span class='st waiting'>Waiting for you</span>" : "<span class='st'>AI is answering</span>";
    const canCopilot = (state.workspaces || []).some((w) => w.id === state.workspaceId && w.plan === "business") || (state.owner && state.owner.plan === "business" && (!state.workspaceId || state.workspaceId === state.owner.id));
    const copilotBtn = canCopilot && state.role !== "viewer" ? `<button type="button" class="btn ghost small" id="inbox-copilot">✨ Suggest reply</button>` : "";
    const actions = status === "human" || status === "waiting"
      ? `<button type="button" class="btn small" id="inbox-handback">🤖 Hand back to AI</button><button type="button" class="btn ghost small" id="inbox-close">Close</button>${copilotBtn}`
      : `<button type="button" class="btn primary small" id="inbox-take">🧑 Take over</button>${copilotBtn}`;
    const nameField = agentNameFieldHtml();
    pane.innerHTML = `<div class="ip-head"><button type="button" class="btn tiny ghost" id="inbox-back">← Inbox</button><div><b>${esc(d.site.name)}</b> · visitor ${esc(o.sessionId.slice(-6))} ${pill}${c && c.page_url ? `<div class="muted tiny ip-url">${esc(c.page_url)}</div>` : ""}</div><div class="row">${actions}</div></div>
      <div class="ip-msgs" id="inbox-msgs">${msgs || "<p class='muted'>No messages yet.</p>"}</div>
      <form class="ip-reply" id="inbox-form">${nameField}<textarea id="inbox-reply" rows="2" placeholder="${status === "human" || status === "waiting" ? "Reply to the visitor…" : "Type to take over and reply…"}"></textarea><button class="btn primary" type="submit">Send</button></form>`;
    const ta = $("#inbox-reply");
    ta.value = keepDraft;
    const box = $("#inbox-msgs");
    if (scroll || box.scrollHeight - box.scrollTop < box.clientHeight + 120) box.scrollTop = box.scrollHeight;
    $("#inbox-take")?.addEventListener("click", takeOver);
    $("#inbox-back")?.addEventListener("click", () => {
      live.open = null;
      document.querySelector("#inbox-view .inbox")?.classList.remove("is-thread");
      pane.innerHTML = "<div class=\"inbox-empty muted\">Pick a conversation to read the transcript, reply, take over or hand it back to the AI.</div>";
      $$("#inbox-view .inbox-item").forEach((b) => b.classList.remove("on"));
    });
    $("#inbox-copilot")?.addEventListener("click", async () => {
      const btn = $("#inbox-copilot");
      btn.disabled = true; btn.textContent = "Thinking…";
      try {
        const r = await req("/api/sites/" + o.siteId + "/inbox/suggest", { method: "POST", body: { sessionId: o.sessionId } });
        const s = r.suggestion || {};
        if (s.reply) ta.value = s.reply;
        let box = $("#inbox-copilot-box");
        if (!box) {
          box = document.createElement("div");
          box.id = "inbox-copilot-box";
          box.className = "copilot-box";
          $("#inbox-form")?.parentNode?.insertBefore(box, $("#inbox-form"));
        }
        box.innerHTML = "<p class='muted tiny'><b>Suggested</b> " + (s.summary ? esc(s.summary) : "") + "</p>";
        toast("Suggested reply ready");
      } catch (e) { toast(e.message); }
      finally { btn.disabled = false; btn.textContent = "✨ Suggest reply"; }
    });
    $("#inbox-handback")?.addEventListener("click", async () => { await req(`/api/live/owner/inbox/${c.id}/handback`, { method: "POST" }).catch((e) => toast(e.message)); toast("Handed back to the AI. The visitor can leave a review."); renderConversation(true); refreshInbox(); });
    $("#inbox-close")?.addEventListener("click", async () => { await req(`/api/live/owner/inbox/${c.id}/close`, { method: "POST" }).catch((e) => toast(e.message)); toast("Chat closed. The visitor can leave a review."); renderConversation(true); refreshInbox(); });
    let lastTyping = 0;
    ta.addEventListener("input", () => {
      if (!o.conv || Date.now() - lastTyping < 3000) return;
      lastTyping = Date.now();
      req(`/api/live/owner/inbox/${o.conv.id}/typing`, { method: "POST" }).catch(() => {});
    });
    ta.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); $("#inbox-form").requestSubmit(); } });
    if (document.activeElement === document.body || keepDraft) ta.focus();
    $("#inbox-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      try {
        if (!o.conv || o.conv.status === "bot" || o.conv.status === "closed") await takeOver(true);
        await req(`/api/live/owner/inbox/${o.conv.id}/reply`, { method: "POST", body: { text, agentName: readAgentName() } });
        rememberAgentName(readAgentName());
        ta.value = "";
        renderConversation(true);
      } catch (e) { toast(e.message); }
    });
    live.timer = setTimeout(() => renderConversation(false), 2500);
  }

  function needsAgentName() {
    if (live.overview && live.overview.need_name === false) return false;
    const owner = state.owner || {};
    if (owner.discord_linked || owner.agent_display_name) return false;
    return !readAgentName();
  }
  function readAgentName() {
    const typed = $("#inbox-agent-name")?.value.trim();
    if (typed) return typed.slice(0, 32);
    return (live.overview && live.overview.agent_name) || (state.owner && (state.owner.agent_display_name || (state.owner.discord_linked && state.owner.name))) || "";
  }
  function rememberAgentName(name) {
    if (!name) return;
    if (state.owner) state.owner.agent_display_name = name;
    if (live.overview) { live.overview.agent_name = name; live.overview.need_name = false; }
  }
  function agentNameFieldHtml() {
    const owner = state.owner || {};
    const known = (live.overview && live.overview.agent_name) || owner.agent_display_name || (owner.discord_linked ? owner.name : "") || "";
    if (owner.discord_linked && known) return "";
    return `<label class="tiny inbox-agent-name">Name visitors will see <input id="inbox-agent-name" maxlength="32" placeholder="e.g. Sam" value="${esc(known)}" ${known ? "" : "required"}/></label>`;
  }
  async function takeOver(silent) {
    const o = live.open;
    const agentName = readAgentName();
    if (needsAgentName() && !agentName) { toast("Enter the name visitors will see in the chat"); $("#inbox-agent-name")?.focus(); throw new Error("Enter the name visitors will see in the chat"); }
    try {
      const { conversation, agentName: saved } = await req("/api/live/owner/inbox/take", { method: "POST", body: { siteId: o.siteId, sessionId: o.sessionId, agentName } });
      o.conv = conversation;
      rememberAgentName(saved || agentName);
      if (silent !== true) { toast("You have the chat — the AI will stay quiet"); renderConversation(true); refreshInbox(); }
    } catch (e) { toast(e.message); throw e; }
  }

  // ---------------- Per-bot settings ----------------

  async function renderEmailChannel() {
    const box = $("#email-channel");
    if (!box || !state.site) return;
    try {
      const d = await req("/api/sites/" + state.site.id + "/email-channel");
      if (!d.allowed) {
        box.innerHTML = "<h3>Visitor email</h3><p class='muted tiny'>A shared email inbox is a Business feature. Upgrade to let visitors email you and draft replies with the bot.</p>";
        return;
      }
      const threads = (d.threads || []).map((th) => "<button type='button' class='inbox-item' data-thread='"+esc(th.id)+"'><span class='ii-top'><b>"+esc(th.visitor_email)+"</b></span><span class='ii-prev'>"+esc(th.subject||"")+"</span></button>").join("") || "<p class='muted tiny'>No visitor emails yet.</p>";
      const setup = d.enabled
        ? "<p class='muted tiny'>Forward or POST incoming mail to this webhook. Replies are drafted for you; nothing is sent until you click Send.</p><p class='tiny'><code>"+esc(d.webhookUrl)+"</code></p>"
          + (state.role==="owner"?"<button type='button' class='btn ghost tiny' id='email-off'>Turn off</button>":"")
        : (state.role==="owner"?"<p class='muted tiny'>Turn this on to receive visitor email into this inbox. You'll get a webhook URL to point a free forwarder at. Replies stay as drafts until a mail key is configured.</p><button type='button' class='btn primary small' id='email-on'>Enable email channel</button>":"<p class='muted tiny'>The owner hasn't enabled the visitor email channel.</p>");
      box.innerHTML = "<h3>Visitor email</h3>"+setup+"<div id='email-threads'>"+threads+"</div><div id='email-thread-pane'></div>";
      $("#email-on")?.addEventListener("click", async () => {
        try { await req("/api/sites/" + state.site.id + "/email-channel", { method: "POST" }); toast("Email channel on"); renderEmailChannel(); }
        catch (e) { toast(e.message); }
      });
      $("#email-off")?.addEventListener("click", async () => {
        try { await req("/api/sites/" + state.site.id + "/email-channel", { method: "DELETE" }); toast("Email channel off"); renderEmailChannel(); }
        catch (e) { toast(e.message); }
      });
      box.querySelectorAll("[data-thread]").forEach((b) => b.addEventListener("click", () => openEmailThread(b.getAttribute("data-thread"))));
    } catch (e) {
      box.innerHTML = "<h3>Visitor email</h3><p class='muted'>"+esc(e.message)+"</p>";
    }
  }

  async function openEmailThread(tid) {
    const pane = $("#email-thread-pane");
    if (!pane) return;
    try {
      const d = await req("/api/sites/" + state.site.id + "/email-channel/threads/" + tid);
      const msgs = (d.messages || []).map((m) => "<div class='im "+esc(m.direction)+"'><span class='im-who'>"+esc(m.direction==="in"?"Visitor":m.direction==="draft"?"Draft":"You")+"</span><div class='im-b'>"+esc(m.body)+"</div></div>").join("");
      const lastDraft = [...(d.messages||[])].reverse().find((m) => m.direction==="draft");
      const canSend = state.role !== "viewer";
      pane.innerHTML = msgs + (canSend ? "<form id='email-reply-form' class='ip-reply'><textarea id='email-reply' rows='4'>"+esc(lastDraft?lastDraft.body:"")+"</textarea><div class='row'><button class='btn ghost' type='button' id='email-suggest'>✨ Draft reply</button><button class='btn primary' type='submit'>Send</button></div></form>" : "");
      $("#email-suggest")?.addEventListener("click", async () => {
        try {
          const r = await req("/api/sites/" + state.site.id + "/email-channel/threads/" + tid + "/suggest", { method: "POST" });
          if (r.suggestion && r.suggestion.reply) $("#email-reply").value = r.suggestion.reply;
        } catch (e) { toast(e.message); }
      });
      $("#email-reply-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const text = $("#email-reply").value.trim();
        if (!text) return;
        try {
          const r = await req("/api/sites/" + state.site.id + "/email-channel/threads/" + tid + "/reply", { method: "POST", body: { text } });
          toast(r.ok ? "Sent" : (r.error || "Saved as draft"));
          openEmailThread(tid);
        } catch (e) { toast(e.message); }
      });
    } catch (e) { toast(e.message); }
  }

  async function loadOverview() {
    live.overview = await req("/api/live/owner/overview");
    return live.overview;
  }
  function siteLive() {
    const o = live.overview;
    return o && state.site ? o.sites.find((s) => s.id === state.site.id) : null;
  }

  async function renderLivePanel() {
    try { await loadOverview(); } catch (e) { toast(e.message); return; }
    const s = siteLive();
    if (!s) return;
    const cfg = s.live_chat;
    const locked = !s.pro;
    $("#live-locked").classList.toggle("hidden", !locked);
    $("#live-body").classList.toggle("is-locked", locked);
    $("#live-enabled").checked = Boolean(cfg.enabled) && !locked;
    $("#live-enabled").disabled = locked;
    const f = $("#live-form");
    f.trigger.value = cfg.trigger;
    f.misses.value = cfg.misses;
    f.agent_name.value = cfg.agent_name || "";
    f.claim_timeout_min.value = cfg.claim_timeout_min || 5;
    f.timeout_fallback.value = cfg.timeout_fallback || "ai";
    if (f.idle_timeout_min) f.idle_timeout_min.value = cfg.idle_timeout_min || 15;
    if (f.clear_closed_discord) f.clear_closed_discord.checked = cfg.clear_closed_discord !== false;
    if (f.clear_closed_discord_sec) f.clear_closed_discord_sec.value = cfg.clear_closed_discord_sec || 60;
    f.agent_name.placeholder = "e.g. " + ((state.owner && state.owner.name || "").split(" ")[0] || "Sam");
    $$("input[name=status]", f).forEach((r) => { r.checked = r.value === cfg.status; });
    [...f.elements].forEach((el) => { el.disabled = locked; });
    updatePreview();
    renderChannels();
    renderEmailChannel();
  }
  function updatePreview() {
    const f = $("#live-form");
    const name = f.agent_name.value.trim() || ((state.owner && state.owner.name || "").split(" ")[0]) || "the team";
    $("#lp-site").textContent = state.site ? state.site.name : "Your site";
    $("#lp-sub").textContent = "You're chatting with " + name;
    $("#lp-name").textContent = "👤 " + name;
    $("#lp-joined").textContent = `${name} joined the chat`;
    f.misses.closest("label").classList.toggle("hidden", f.trigger.value === "ask" || f.trigger.value === "never");
  }
  window.gcRenderLive = renderLivePanel;
  $("#live-form").addEventListener("input", updatePreview);
  async function saveLive(extra) {
    const f = $("#live-form");
    const body = {
      enabled: $("#live-enabled").checked,
      trigger: f.trigger.value, misses: Number(f.misses.value) || 2, agent_name: f.agent_name.value.trim(),
      claim_timeout_min: Number(f.claim_timeout_min.value) || 5, timeout_fallback: f.timeout_fallback.value,
      idle_timeout_min: Number(f.idle_timeout_min && f.idle_timeout_min.value) || 15,
      clear_closed_discord: Boolean(f.clear_closed_discord && f.clear_closed_discord.checked),
      clear_closed_discord_sec: Number(f.clear_closed_discord_sec && f.clear_closed_discord_sec.value) || 60,
      status: ($("input[name=status]:checked", f) || {}).value || "online",
      ...(extra || {}),
    };
    try {
      await req("/api/live/owner/settings/" + state.site.id, { method: "PATCH", body: { live_chat: body } });
      await loadOverview();
      toast(body.enabled ? "Live chat is on" : "Live chat settings saved");
    } catch (e) { toast(e.message); renderLivePanel(); }
  }
  $("#live-form").addEventListener("submit", (ev) => { ev.preventDefault(); saveLive(); });
  $("#live-enabled").addEventListener("change", () => saveLive());
  $$("#live-form input[name=status]").forEach((r) => r.addEventListener("change", () => saveLive()));
  $("#live-upgrade").addEventListener("click", () => $("#open-billing").click());
  $("#tabs").addEventListener("click", (ev) => { if (ev.target.closest("button")?.dataset.tab === "live") renderLivePanel(); });

  function channelCard(kind) {
    const o = live.overview;
    const ch = o.channels.find((c) => c.kind === kind);
    const connected = ch && ch.status === "connected";
    const status = connected ? "<span class='st human'>Connected</span>" : ch && ch.status === "pending" ? "<span class='st waiting'>Waiting for link</span>" : "<span class='st'>Not connected</span>";
    if (kind === "telegram") {
      const where = connected ? `Chats go to <b>${esc(ch.chat_title || "your Telegram chat")}</b>${ch.own_bot ? ` via your bot @${esc(ch.bot_username)}` : ` via @${esc(o.telegram.bot)}`}${ch.is_forum ? " · one topic per visitor" : ""}.` : "Get chats in Telegram and reply right there.";
      return `<div class="ch-card" data-kind="telegram"><div class="ch-top"><b>✈️ Telegram</b>${status}</div><p class="muted tiny">${where}</p>
        <div class="row">${connected ? `<button type="button" class="btn small" data-act="test">Send test</button><button type="button" class="btn ghost small" data-act="remove">Disconnect</button>` : `<button type="button" class="btn primary small" data-act="tg-link" ${o.telegram.ready ? "" : "disabled title='Shared bot not configured yet'"}>Connect @${esc(o.telegram.bot)}</button>`}</div>
        <div class="ch-extra" id="tg-extra"></div>
        <details class="ch-own"><summary class="tiny">Use my own Telegram bot instead</summary>
          <form class="row" id="tg-own"><input name="token" type="password" autocomplete="off" placeholder="Paste your BotFather token" /><button class="btn small" type="submit">Connect my bot</button></form>
          <p class="muted tiny">Create one with @BotFather → /newbot. The token is stored encrypted and never shown again.</p></details></div>`;
    }
    const where = connected ? `New chats post a ticket card in <b>#${esc(ch.channel_name || "channel")}</b>${ch.guild_name ? ` in ${esc(ch.guild_name)}` : ""}. Claim one and I'll continue the conversation in your DMs.` : ch && ch.guild_id ? `Linked to ${esc(ch.guild_name || "your server")} — pick a channel.` : "Get each chat as a ticket card in Discord, then reply in your DMs.";
    return `<div class="ch-card" data-kind="discord"><div class="ch-top"><b>🎮 Discord</b>${status}</div><p class="muted tiny">${where}</p>
      <div class="row"><a class="btn small" href="${esc(o.discord.invite)}" target="_blank" rel="noopener">Add GhostBot to server</a>
      ${ch && ch.guild_id ? `<button type="button" class="btn small" data-act="dc-channels">Choose channel</button>` : ""}
      <button type="button" class="btn ${connected ? "ghost" : "primary"} small" data-act="dc-link">${ch && ch.guild_id ? "Re-link" : "Get link code"}</button>
      ${connected ? `<button type="button" class="btn small" data-act="test">Send test</button><button type="button" class="btn ghost small" data-act="remove">Disconnect</button>` : ""}</div>
      <div class="ch-extra" id="dc-extra"></div></div>`;
  }
  function renderChannels() {
    const box = $("#live-channels");
    box.innerHTML = channelCard("telegram") + channelCard("discord");
    box.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => channelAction(b.closest(".ch-card").dataset.kind, b.dataset.act)));
    $("#tg-own")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const token = ev.target.token.value.trim();
      if (!token) return;
      try {
        const r = await req("/api/live/owner/channels/telegram", { method: "POST", body: { token } });
        ev.target.token.value = "";
        showTgLink(r);
      } catch (e) { toast(e.message); }
    });
  }
  function showTgLink(r) {
    $("#tg-extra").innerHTML = `<p class="tiny">1. <a class="btn primary small" href="${esc(r.url)}" target="_blank" rel="noopener">Open Telegram and press Start</a></p>
      <p class="muted tiny">For a group: add the bot to the group (make it an admin with “Manage Topics” for one topic per visitor), then send <code>/link ${esc(r.code)}</code> there. The code works for 30 minutes.</p>`;
    pollChannel("telegram");
  }
  let chPoll = null;
  function pollChannel(kind) {
    clearInterval(chPoll);
    let n = 0;
    chPoll = setInterval(async () => {
      if (++n > 120 || $("#site-view").classList.contains("hidden")) return clearInterval(chPoll);
      const o = await loadOverview().catch(() => null);
      const ch = o && o.channels.find((c) => c.kind === kind);
      if (ch && (ch.status === "connected" || (kind === "discord" && ch.guild_id))) {
        clearInterval(chPoll);
        toast(kind === "telegram" ? "Telegram connected" : "Discord server linked");
        renderChannels();
        if (kind === "discord" && !ch.channel_id) channelAction("discord", "dc-channels");
      }
    }, 3000);
  }
  async function channelAction(kind, act) {
    try {
      if (act === "tg-link") showTgLink(await req("/api/live/owner/channels/telegram", { method: "POST", body: {} }));
      else if (act === "dc-link") {
        const r = await req("/api/live/owner/channels/discord", { method: "POST", body: {} });
        $("#dc-extra").innerHTML = `<p class="tiny">1. Add GhostBot to your server (button above).<br/>2. In the channel you want, run <code>${esc(r.command)}</code></p><p class="muted tiny">The code works for 30 minutes. GhostBot needs to send messages, create threads and read history there.</p>`;
        pollChannel("discord");
      } else if (act === "dc-channels") {
        const { channels } = await req("/api/live/owner/channels/discord/channels");
        const cur = live.overview.channels.find((c) => c.kind === "discord");
        $("#dc-extra").innerHTML = `<form class="row" id="dc-pick"><select name="channelId">${channels.map((c) => `<option value="${esc(c.id)}" ${cur && cur.channel_id === c.id ? "selected" : ""}>#${esc(c.name)}</option>`).join("")}</select><button class="btn small primary" type="submit">Use this channel</button></form>`;
        $("#dc-pick").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          await req("/api/live/owner/channels/discord/channel", { method: "POST", body: { channelId: ev.target.channelId.value } }).then(() => toast("Discord channel saved"), (e) => toast(e.message));
          await loadOverview(); renderChannels();
        });
      } else if (act === "test") { await req(`/api/live/owner/channels/${kind}/test`, { method: "POST" }); toast("Test message sent"); }
      else if (act === "remove") { await req(`/api/live/owner/channels/${kind}`, { method: "DELETE" }); await loadOverview(); renderChannels(); toast("Disconnected"); }
    } catch (e) { toast(e.message); }
  }
})();
