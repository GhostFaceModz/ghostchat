// GhostChat dashboard v2: bot mode + support settings, Tickets, Smart features, onboarding wizard.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const site = () => state.site;
  const patch = async (body) => {
    const { site: s } = await req("/api/sites/" + site().id, { method: "PATCH", body });
    state.site = s;
    return s;
  };
  const when = (iso) => { try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

  // ---------- Bot mode + support ----------
  const MODES = [
    ["assistant", "Assistant", "Answers questions from your site."],
    ["support", "Support", "Troubleshoots, opens tickets, hands off to you."],
    ["sales", "Sales", "Qualifies visitors and books calls."],
    ["recommendations", "Recommendations", "Suggests products that fit."],
  ];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DEF = { hours: { enabled: false, tz: "Europe/London", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }, out_of_hours_message: "Our team is offline right now. I can still help, or leave your details and we'll get back to you when we're back.", canned: [], quick_replies: ["Track my order", "Report a problem", "Talk to a human"], csat: "stars", greeting: "Hi! I'm here to help. What's going wrong?" };
  const support = () => { const s = site().support || {}; return { ...DEF, ...s, hours: { ...DEF.hours, ...(s.hours || {}) }, canned: s.canned || [], quick_replies: s.quick_replies || DEF.quick_replies }; };

  function renderModes() {
    const cur = site().bot_mode || "assistant";
    $("#mode-picks").innerHTML = MODES.map(([k, t, d]) => `<button type="button" role="radio" aria-checked="${k === cur}" class="${k === cur ? "on" : ""}" data-mode="${k}"><strong>${t}</strong><span class="muted tiny">${d}</span></button>`).join("");
  }
  $("#mode-picks").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-mode]"); if (!b) return;
    try { await patch({ bot_mode: b.dataset.mode }); renderModes(); toast(b.querySelector("strong").textContent + " mode on"); } catch (e) { toast(e.message); }
  });
  function cannedRow(c) {
    return `<div class="canned glass"><input data-c="title" placeholder="Title, e.g. Refund policy" maxlength="60" value="${esc(c.title)}" /><textarea data-c="text" rows="2" maxlength="1500" placeholder="Text">${esc(c.text)}</textarea><button type="button" class="btn ghost small" data-rm>Remove</button></div>`;
  }
  function renderSupport() {
    const f = $("#support-form"), s = support();
    f.greeting.value = s.greeting || "";
    f.quick_replies.value = (s.quick_replies || []).join("\n");
    f.hours_enabled.checked = !!s.hours.enabled;
    f.start.value = s.hours.start; f.end.value = s.hours.end; f.tz.value = s.hours.tz;
    f.out_of_hours_message.value = s.out_of_hours_message || "";
    f.csat.value = s.csat === "thumbs" ? "thumbs" : "stars";
    $("#support-days").innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="day"><input type="checkbox" value="${d}" ${s.hours.days.includes(d) ? "checked" : ""}/> ${DAYS[d]}</label>`).join("");
    $("#canned-list").innerHTML = s.canned.map(cannedRow).join("") || `<p class="muted tiny">None yet.</p>`;
    const lim = Number.isInteger(site().max_suggestions) ? site().max_suggestions : 2;
    $("#qr-note").textContent = `The widget shows up to ${lim} (your follow-up suggestion limit in Persona). Raise it there to show more.`;
  }
  $("#canned-add").addEventListener("click", () => { const l = $("#canned-list"); if (!l.querySelector(".canned")) l.innerHTML = ""; l.insertAdjacentHTML("beforeend", cannedRow({ title: "", text: "" })); });
  $("#canned-list").addEventListener("click", (ev) => { if (ev.target.closest("[data-rm]")) ev.target.closest(".canned").remove(); });
  $("#support-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const body = { support: {
      greeting: f.greeting.value, quick_replies: f.quick_replies.value.split("\n").map((x) => x.trim()).filter(Boolean),
      hours: { enabled: f.hours_enabled.checked, start: f.start.value, end: f.end.value, tz: f.tz.value.trim() || "Europe/London", days: $$("#support-days input:checked").map((x) => Number(x.value)) },
      out_of_hours_message: f.out_of_hours_message.value, csat: f.csat.value,
      canned: $$("#canned-list .canned").map((n) => ({ title: n.querySelector("[data-c=title]").value.trim(), text: n.querySelector("[data-c=text]").value.trim() })).filter((c) => c.title && c.text),
    } };
    try { await patch(body); renderSupport(); toast("Support settings saved"); } catch (e) { toast(e.message); }
  });

  // ---------- Tickets ----------
  let tStatus = "open", tickets = [], openId = null;
  const PRI = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
  async function loadTickets() {
    if (!site()) return;
    const list = $("#ticket-list");
    list.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      ({ tickets } = await req(`/api/sites/${site().id}/tickets${tStatus ? "?status=" + tStatus : ""}`));
    } catch (e) { list.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    list.innerHTML = tickets.length ? tickets.map((t) => `<button type="button" class="tk ${t.id === openId ? "on" : ""}" data-id="${t.id}">
        <span class="tk-top"><b>#${t.number} ${esc(t.subject || "Support request")}</b><span class="tk-pri p-${t.priority}">${PRI[t.priority] || t.priority}</span></span>
        <span class="muted tiny">${esc(t.name || t.email || "Visitor")} · ${when(t.updated_at)} · <span class="tk-st st-${t.status}">${t.status}</span>${t.rating ? ` · ★ ${t.rating}` : ""}</span>
      </button>`).join("") : `<div class="empty-tk"><p><b>No ${tStatus || ""} tickets.</b></p><p class="muted tiny">In Support mode the bot opens a ticket when it can't solve a problem, when someone asks for a person, or when they're upset.</p></div>`;
  }
  async function openTicket(id) {
    openId = id;
    $$("#ticket-list .tk").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
    const box = $("#ticket-detail");
    box.hidden = false;
    box.innerHTML = `<p class="muted">Loading…</p>`;
    const { ticket: t } = await req(`/api/sites/${site().id}/tickets/${id}`);
    const seen = new Set();
    const canned = [];
    for (const c of [...(state.workspaceCanned || []), ...(support().canned || [])]) {
      const key = (c.title || "").toLowerCase();
      if (!c.text || seen.has(key)) continue;
      seen.add(key);
      canned.push(c);
    }

    const d = t.details || {};
    box.innerHTML = `<div class="tk-head"><h4>#${t.number} ${esc(t.subject || "Support request")}</h4><button type="button" class="btn ghost small" data-close aria-label="Close ticket view">✕</button></div>
      <p class="muted tiny">${esc(t.name || "")} ${t.email ? `&lt;<a href="mailto:${esc(t.email)}?subject=${encodeURIComponent("Re: #" + t.number + " " + (t.subject || "Your support request"))}">${esc(t.email)}</a>&gt;` : ""}${d.order ? ` · Order ${esc(d.order)}` : ""} · opened ${when(t.created_at)}</p>
      <div class="row tight">
        <label>Status <select data-k="status">${["open", "pending", "solved"].map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label>Priority <select data-k="priority">${Object.keys(PRI).map((p) => `<option value="${p}" ${p === t.priority ? "selected" : ""}>${PRI[p]}</option>`).join("")}</select></label>
      </div>
      <div class="tk-thread">${(t.messages || []).map((m) => `<div class="tm ${m.from}"><small>${m.from === "agent" ? esc(m.name || "You") : m.from === "visitor" ? "Visitor" : "System"} · ${when(m.at)}</small><p>${esc(m.text)}</p></div>`).join("") || ""}</div>
      ${t.transcript ? `<details class="tk-trans"><summary>Chat transcript</summary><pre>${esc(t.transcript)}</pre></details>` : ""}
      <form class="stack tk-reply">
        ${canned.length ? `<label>Insert canned response <select data-canned><option value="">Choose…</option>${canned.map((c, i) => `<option value="${i}">${esc(c.title)}</option>`).join("")}</select></label>` : ""}
        <label>Your name in the chat <input name="agentName" maxlength="32" placeholder="e.g. Sam" value="${esc((state.owner && (state.owner.agent_display_name || (state.owner.discord_linked && state.owner.name))) || "")}" ${(state.owner && (state.owner.discord_linked || state.owner.agent_display_name)) ? "" : "required"}/></label>
        <label>Reply <textarea name="text" rows="4" placeholder="Your reply is added to the visitor's chat. Use the email link to reply by email too."></textarea></label>
        <div class="row tight">
          <button type="submit" class="btn primary small">Send reply</button>
          <button type="submit" class="btn small" data-solve>Reply &amp; mark solved</button>
          ${t.email ? `<a class="btn ghost small" data-mail href="#">Email instead</a>` : ""}
        </div>
      </form>`;
    box.querySelector("[data-close]").onclick = () => { box.hidden = true; openId = null; $$("#ticket-list .tk").forEach((b) => b.classList.remove("on")); };
    box.querySelectorAll("[data-k]").forEach((s) => s.addEventListener("change", async () => {
      try { await req(`/api/sites/${site().id}/tickets/${id}`, { method: "PATCH", body: { [s.dataset.k]: s.value } }); toast("Ticket updated"); loadTickets(); } catch (e) { toast(e.message); }
    }));
    const form = box.querySelector("form");
    const cs = box.querySelector("[data-canned]");
    if (cs) cs.onchange = () => { if (cs.value !== "") { form.text.value = (form.text.value ? form.text.value + "\n\n" : "") + canned[Number(cs.value)].text; cs.value = ""; } };
    const mail = box.querySelector("[data-mail]");
    if (mail) mail.onclick = (ev) => { ev.preventDefault(); location.href = `mailto:${t.email}?subject=${encodeURIComponent("Re: #" + t.number + " " + (t.subject || "Your support request"))}&body=${encodeURIComponent(form.text.value)}`; };
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const solve = ev.submitter && ev.submitter.hasAttribute("data-solve");
      if (!form.text.value.trim()) { form.text.focus(); return; }
      try {
        const agentName = (form.agentName && form.agentName.value.trim()) || "";
        if (!agentName && !(state.owner && (state.owner.discord_linked || state.owner.agent_display_name))) { form.agentName.focus(); toast("Enter the name visitors will see"); return; }
        const sent = await req(`/api/sites/${site().id}/tickets/${id}/reply`, { method: "POST", body: { text: form.text.value, status: solve ? "solved" : "pending", agentName } });
        if (sent.agentName && state.owner) state.owner.agent_display_name = sent.agentName;
        toast(solve ? "Replied and solved" : "Reply sent"); await loadTickets(); openTicket(id);
      } catch (e) { toast(e.message); }
    });
  }
  $("#ticket-filter").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    tStatus = b.dataset.status; $$("#ticket-filter button").forEach((x) => x.classList.toggle("on", x === b)); loadTickets();
  });
  $("#ticket-list").addEventListener("click", (ev) => { const b = ev.target.closest(".tk"); if (b) openTicket(b.dataset.id).catch((e) => toast(e.message)); });

  // ---------- Smart features ----------
  const FIELD_KEYS = [["name", "Name"], ["email", "Email"], ["phone", "Phone"], ["date", "Preferred date"], ["message", "Message"], ["order", "Order number"]];
  function greetRow(g) {
    return `<div class="greet glass"><input data-g="pattern" placeholder="/pricing" value="${esc(g.pattern || "")}" maxlength="120" aria-label="Page pattern" /><input data-g="message" placeholder="Questions about plans? I can help." value="${esc(g.message || "")}" maxlength="160" aria-label="Message" /><label class="sec">after <input data-g="delay_s" type="number" min="3" max="300" value="${esc(g.delay_s ?? 15)}" aria-label="Delay in seconds" /> s</label><button type="button" class="btn ghost small" data-rm aria-label="Remove greeting">✕</button></div>`;
  }
  function renderFeatures() {
    const s = site(), f = $("#features-form");
    f.live_lookup.checked = s.live_lookup !== false;
    f.lookup_search_url.value = s.lookup_search_url || "";
    f.multilingual.checked = s.multilingual !== false;
    f.memory_enabled.checked = s.memory_enabled !== false;
    f.recrawl_schedule.value = s.recrawl_schedule || "off";
    $("#recrawl-last").textContent = s.last_crawled_at ? "Last crawl: " + when(s.last_crawled_at) + "." : "";
    $("#greet-list").innerHTML = (s.greetings || []).map(greetRow).join("");
    const form = { enabled: false, title: "Book or request a callback", subtitle: "Leave your details and we'll get back to you.", cta: "Send", fields: [{ key: "name", required: true }, { key: "email", required: true }, { key: "date" }, { key: "message" }], triggers: ["book", "booking", "appointment", "callback", "quote", "contact"], ...(s.chat_form || {}) };
    f.form_enabled.checked = !!form.enabled; f.form_title.value = form.title; f.form_subtitle.value = form.subtitle; f.form_cta.value = form.cta; f.form_triggers.value = (form.triggers || []).join(", ");
    const on = new Map((form.fields || []).map((x) => [x.key, x]));
    $("#form-fields").innerHTML = FIELD_KEYS.map(([k, l]) => `<div class="ff"><label class="check"><input type="checkbox" data-ff="${k}" ${on.has(k) || k === "email" ? "checked" : ""} ${k === "email" ? "disabled" : ""}/> ${l}</label><label class="check sec"><input type="checkbox" data-req="${k}" ${k === "email" || on.get(k)?.required ? "checked" : ""} ${k === "email" ? "disabled" : ""}/> required</label></div>`).join("");
    const pro = s.plan !== "free";
    f.custom_domain.value = s.custom_domain || "";
    f.custom_domain.disabled = !pro;
    $("#wl-note").textContent = pro ? "Hide “Powered by GhostChat” in Appearance. The bot also stops mentioning GhostChat." : "Upgrade to Pro to hide the GhostChat badge and use your own chat domain.";
    const dom = s.custom_domain || "chat.yourdomain.com";
    $("#cname-help").innerHTML = `<b>Custom domain setup</b><ol class="tiny"><li>At your DNS provider add a <code>CNAME</code> record: <code>${esc(dom.split(".")[0])}</code> → <code>ghostchat-nfoc.onrender.com</code></li><li>Send us the domain so it's added to the server (custom domains on the host need a manual step), then wait for the TLS certificate (usually minutes).</li><li>Use <code>https://${esc(dom)}/widget.js</code> in your snippet and <code>https://${esc(dom)}/c/${esc(s.site_key)}</code> as your chat link.</li></ol>`;
    const ch = s.channels || {}, biz = s.plan === "business";
    f.wa_enabled.checked = !!ch.whatsapp?.enabled; f.wa_id.value = ch.whatsapp?.phone_number_id || "";
    f.ig_enabled.checked = !!ch.instagram?.enabled; f.ig_id.value = ch.instagram?.account_id || "";
    [f.wa_enabled, f.ig_enabled].forEach((x) => { x.disabled = !biz; x.title = biz ? "" : "Business plan only"; });
  }
  $("#greet-add").addEventListener("click", () => $("#greet-list").insertAdjacentHTML("beforeend", greetRow({ pattern: "/", delay_s: 15 })));
  $("#greet-list").addEventListener("click", (ev) => { if (ev.target.closest("[data-rm]")) ev.target.closest(".greet").remove(); });
  $("#features-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target, s = site();
    const body = {
      live_lookup: f.live_lookup.checked, lookup_search_url: f.lookup_search_url.value.trim(),
      multilingual: f.multilingual.checked, memory_enabled: f.memory_enabled.checked, recrawl_schedule: f.recrawl_schedule.value,
      greetings: $$("#greet-list .greet").map((n) => ({ pattern: n.querySelector("[data-g=pattern]").value.trim(), message: n.querySelector("[data-g=message]").value.trim(), delay_s: Number(n.querySelector("[data-g=delay_s]").value) })).filter((g) => g.message),
      chat_form: { enabled: f.form_enabled.checked, title: f.form_title.value, subtitle: f.form_subtitle.value, cta: f.form_cta.value, triggers: f.form_triggers.value,
        fields: FIELD_KEYS.map(([k]) => k).filter((k) => k === "email" || $(`#form-fields [data-ff=${k}]`).checked).map((k) => ({ key: k, required: k === "email" || $(`#form-fields [data-req=${k}]`).checked })) },
      channels: { whatsapp: { enabled: f.wa_enabled.checked, phone_number_id: f.wa_id.value }, instagram: { enabled: f.ig_enabled.checked, account_id: f.ig_id.value } },
    };
    if (s.plan !== "free") body.custom_domain = f.custom_domain.value.trim();
    try { await patch(body); renderFeatures(); toast("Features saved"); } catch (e) { toast(e.message); }
  });

  // ---------- Model tab note ----------
  function modelNote() {
    let n = $("#plan-model-note");
    if (!n) { n = document.createElement("p"); n.id = "plan-model-note"; n.className = "muted tiny"; $("#model-form").after(n); }
    n.textContent = site().plan === "free"
      ? "Free sites use the standard model. Pro can use a stronger model for main answers."
      : "Pro: if your server sets PRO_CHAT_MODEL, main answers use that stronger model unless you pick one above.";
  }

  // ---------- Wizard ----------
  const wz = $("#wizard");
  let wzStep = 1, wzSite = null;
  function go(n) {
    wzStep = n;
    wz.querySelectorAll("[data-step]").forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
    wz.querySelectorAll(".wz-steps i").forEach((d, i) => d.classList.toggle("on", i < n));
    if (n === 4) {
      $("#wz-snippet").value = `<script src="${typeof widgetScriptUrl === "function" ? widgetScriptUrl(window.GHOSTCHAT_PUBLIC_ORIGIN) : (window.GHOSTCHAT_PUBLIC_ORIGIN || "https://ghostchat.pro") + "/widget.js"}" data-id="${wzSite.site_key}"></script>`;
      showPlat($("#wz-plats .on")?.dataset.plat || "html");
    }
    if (n === 5) $("#wz-chat").src = "/c/" + encodeURIComponent(wzSite.site_key);
  }
  const PLATS = {
    html: "Paste the snippet just before the closing </body> tag of your site, then publish.",
    shopify: "In Shopify, go to Online Store → Themes → Edit code. Open layout/theme.liquid and paste the snippet just before </body>, then Save.",
    wix: "In Wix, go to Settings → Custom Code → Add Code. Paste the snippet, set it to load on All pages in the Body — end, then Apply.",
    squarespace: "In Squarespace, go to Settings → Developer Tools → Code Injection. Paste the snippet into the Footer box and Save.",
    wordpress: "In WordPress, paste the snippet in your theme footer (Appearance → Theme File Editor → footer.php) just before </body>, or use a plugin like “Insert Headers and Footers” / WPCode in the footer section.",
    webflow: "In Webflow, open Site Settings → Custom Code, paste the snippet into Footer Code, then Publish the site.",
  };
  function showPlat(id) {
    const help = $("#wz-plat-help");
    if (!help) return;
    help.textContent = PLATS[id] || PLATS.html;
    document.querySelectorAll("#wz-plats [data-plat]").forEach((b) => b.classList.toggle("on", b.dataset.plat === id));
  }
  $("#wz-plats")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-plat]"); if (!b) return;
    showPlat(b.dataset.plat);
  });
  function openWizard() { wzSite = null; $("#wz-site").reset(); $("#wz-err").hidden = true; go(1); wz.showModal(); }
  window.gcOpenWizard = openWizard;
  $("#wizard-open").addEventListener("click", () => { wzSite = site(); go(2); wz.showModal(); crawl(); });
  $("#wz-close").addEventListener("click", () => wz.close());
  wz.addEventListener("click", (ev) => { if (ev.target.closest("[data-next]")) go(wzStep + 1); });
  $("#wz-site").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const { site: s } = await req("/api/sites", { method: "POST", body: { url: f.url.value, name: f.name.value, template: f.mode.value === "support" ? "support" : f.mode.value === "sales" ? "sales" : "" } });
      wzSite = s;
      if (f.mode.value !== "assistant") await req("/api/sites/" + s.id, { method: "PATCH", body: { bot_mode: f.mode.value } }).catch(() => {});
      await refreshSites(s.id);
      go(2); crawl();
    } catch (e) { $("#wz-err").textContent = e.message; $("#wz-err").hidden = false; }
  });
  async function crawl() {
    const msg = $("#wz-crawl-msg");
    const faq = $("#wz-faq");
    if (faq) faq.hidden = true;
    msg.textContent = "Crawling your pages… this usually takes under a minute.";
    wz.querySelector(".wz-progress").classList.add("run");
    try {
      const d = await req("/api/sites/" + wzSite.id + "/crawl", { method: "POST" });
      const n = d.pages ?? d.site?.page_count ?? 0;
      msg.textContent = `Done: read ${n} page${n === 1 ? "" : "s"}.`;
      if (d.site) wzSite = d.site;
      if (n > 0) setTimeout(() => wzStep === 2 && go(3), 900);
      else {
        msg.textContent = "We couldn't find readable pages on that site.";
        if (faq) faq.hidden = false;
      }
    } catch (e) {
      msg.textContent = "Couldn't crawl just now (" + e.message + "). Paste a FAQ below, or retry from the Train tab.";
      if (faq) faq.hidden = false;
    }
    finally { wz.querySelector(".wz-progress").classList.remove("run"); }
  }
  $("#wz-faq-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("#wz-faq-err");
    if (err) err.hidden = true;
    const fd = new FormData(ev.target);
    if (!String(fd.get("text") || "").trim()) return;
    if (!fd.get("title")) fd.set("title", "FAQ");
    try {
      await req("/api/sites/" + wzSite.id + "/documents", { method: "POST", body: fd });
      go(3);
    } catch (e) {
      if (err) { err.textContent = e.message; err.hidden = false; }
      else toast(e.message);
    }
  });
  $("#wz-style").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const body = { theme: { ...(wzSite.theme || {}), primary: f.primary.value, mode: f.mode.value } };
      if (f.greeting.value.trim()) body.greeting = f.greeting.value.trim();
      const { site: s } = await req("/api/sites/" + wzSite.id, { method: "PATCH", body });
      wzSite = s; if (state.site && state.site.id === s.id) state.site = s;
      go(4);
    } catch (e) { toast(e.message); }
  });
  $("#wz-copy").addEventListener("click", () => navigator.clipboard.writeText($("#wz-snippet").value).then(() => toast("Snippet copied")));
  $("#wz-done").addEventListener("click", async () => { wz.close(); if (wzSite) await selectSite(wzSite.id); toast("Your bot is ready"); });
  // First-run: no sites yet → offer the wizard instead of the bare dialog.
  const emptyBtn = $("#empty-new");
  if (emptyBtn) emptyBtn.addEventListener("click", (ev) => { ev.stopImmediatePropagation(); $("#new-dialog").open && $("#new-dialog").close(); openWizard(); }, true);

  // ---------- wiring ----------
  function render() { if (!site()) return; renderModes(); renderSupport(); renderFeatures(); modelNote(); }
  window.gcRenderV2 = render;
  $("#tabs").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || !site()) return;
    if (b.dataset.tab === "tickets") loadTickets();
    if (["support", "features", "model"].includes(b.dataset.tab)) render();
  });
  window.gcSiteChanged = () => { openId = null; $("#ticket-detail").hidden = true; render(); if (state.tab === "tickets") loadTickets(); };
  setInterval(() => { if (site() && state.tab === "tickets" && !document.hidden && !openId) loadTickets(); }, 30000);
})();
