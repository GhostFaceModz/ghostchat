// GhostChat owner dashboard: auth (email + optional OAuth), sites, training, styling, billing.
const api = "";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  token: localStorage.getItem("gc_token") || "",
  owner: null,
  sites: [],
  site: null,
  tab: "setup",
  templates: [],
  catalog: null,
  billing: null,
  view: "sites"
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._id);
  toast._id = setTimeout(() => { t.hidden = true; }, 2200);
}

async function req(path, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  if (state.token) headers.authorization = "Bearer " + state.token;
  const body = opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined;
  if (opts.body instanceof FormData) delete headers["content-type"];
  const res = await fetch(api + path, { method: opts.method || "GET", headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showAuth(on) {
  $("#auth").classList.toggle("hidden", !on);
  $("#app").classList.toggle("hidden", on);
  document.title = on ? (authMode === "signup" ? "Create your account · GhostChat" : "Sign in · GhostChat") : "GhostChat · Dashboard";
  // Keep the address bar tidy: /login or /signup while signed out, /dashboard once in.
  const want = on ? "/" + authMode : "/dashboard";
  if (location.pathname !== want && (on || /^\/(login|signup)\/?$/.test(location.pathname))) {
    history.replaceState({}, "", want + location.search + location.hash);
  }
}

// ---- Auth mode (sign in vs create account) ----
let authMode = /^\/signup/.test(location.pathname) || new URLSearchParams(location.search).get("mode") === "signup" ? "signup" : "login";

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";
  const signup = authMode === "signup";
  $("#auth-form").dataset.mode = authMode;
  $$(".signup-only").forEach((n) => n.classList.toggle("hidden", !signup));
  $("#auth-title").textContent = signup ? "Create your account" : "Welcome back";
  $("#auth-sub").textContent = signup ? "Free to start. Your assistant can be live in minutes." : "Sign in to manage your assistants.";
  $("#auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("#auth-form").password.setAttribute("autocomplete", signup ? "new-password" : "current-password");
  $("#auth-switch").innerHTML = signup
    ? 'Already have an account? <a href="/login" data-mode="login">Sign in</a>'
    : 'New to GhostChat? <a href="/signup" data-mode="signup">Create an account</a>';
  $("#auth-error").hidden = true;
  if (!$("#auth").classList.contains("hidden")) showAuth(true);
}

function showOwner(owner) {
  $("#owner-email").textContent = owner.email + (owner.plan ? " · " + owner.plan : "");
  const av = $("#owner-avatar");
  if (owner.avatar_url) {
    const img = document.createElement("img");
    img.src = owner.avatar_url;
    img.alt = "";
    av.replaceChildren(img);
  } else {
    av.textContent = (owner.name || owner.email || "?").trim().charAt(0).toUpperCase() || "👻";
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  const authError = params.get("auth_error");
  if (token) {
    state.token = token;
    localStorage.setItem("gc_token", token);
    params.delete("token");
    const next = params.toString();
    history.replaceState({}, "", location.pathname + (next ? "?" + next : ""));
  }
  setAuthMode(authMode);
  loadTemplates();
  loadProviders();
  if (authError) {
    showAuth(true);
    const err = $("#auth-error");
    err.textContent = authError;
    err.hidden = false;
    return;
  }
  if (!state.token) { showAuth(true); return; }
  try {
    const { owner } = await req("/api/auth/me");
    state.owner = owner;
    showAuth(false);
    showOwner(owner);
    await refreshSites();
  } catch {
    state.token = "";
    localStorage.removeItem("gc_token");
    showAuth(true);
  }
}

// OAuth buttons always show; a provider the server can't use yet gets a "Soon" state.
async function loadProviders() {
  let data = {};
  try {
    data = await fetch("/api/auth/providers").then((r) => r.json());
  } catch { /* treat as not configured */ }
  const providers = data.providers || {};
  const urls = data.urls || {};
  [["discord", "Discord"], ["google", "Google"]].forEach(([id, label]) => {
    const btn = $("#oauth-" + id);
    if (!btn) return;
    const on = Boolean(providers[id] && urls[id]);
    btn.classList.toggle("soon", !on);
    btn.setAttribute("aria-disabled", String(!on));
    btn.title = on ? "" : label + " sign-in is coming soon. Use email for now.";
    if (on) btn.href = urls[id];
    btn.onclick = on ? null : (ev) => { ev.preventDefault(); toast(label + " sign-in is coming soon. Use email for now."); };
  });
}

async function loadTemplates() {
  try {
    const data = await fetch("/api/widget/templates").then((r) => r.json());
    state.templates = data.templates || [];
  } catch { state.templates = []; }
}

async function refreshSites(selectId) {
  const { sites } = await req("/api/sites");
  state.sites = sites;
  const list = $("#site-list");
  list.innerHTML = "";
  sites.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.name;
    b.className = state.site && state.site.id === s.id ? "on" : "";
    b.addEventListener("click", () => selectSite(s.id));
    list.appendChild(b);
  });
  const id = selectId || (state.site && state.site.id) || (sites[0] && sites[0].id);
  if (id) await selectSite(id);
  else {
    state.site = null;
    $("#empty-state").classList.remove("hidden");
    $("#site-view").classList.add("hidden");
  }
}

async function selectSite(id) {
  const { site } = await req("/api/sites/" + id);
  state.site = site;
  $$("#site-list button").forEach((b, i) => b.classList.toggle("on", state.sites[i] && state.sites[i].id === id));
  $("#empty-state").classList.add("hidden");
  $("#site-view").classList.remove("hidden");
  renderSite();
  if (state.tab === "train") loadDocs();
  if (state.tab === "transcripts") loadLogs();
  if (state.tab === "analytics") loadAnalytics();
  if (state.tab === "leads") loadLeads();
}

function renderSite() {
  const s = state.site;
  $("#site-title").textContent = s.name;
  $("#plan-pill").textContent = s.plan;
  const used = s.messages_this_period || 0;
  const limit = s.message_limit || 200;
  $("#usage-label").textContent = used + " / " + limit + " messages this month";
  $("#usage-bar i").style.width = Math.min(100, Math.round((used / limit) * 100)) + "%";
  $("#site-key").value = s.site_key;
  const snippet = `<script src="${location.origin}/widget.js" data-id="${s.site_key}"></script>`;
  $("#embed").value = snippet;
  $("#open-demo").href = "/demo?key=" + encodeURIComponent(s.site_key);
  const share = location.origin + "/c/" + encodeURIComponent(s.site_key);
  $("#share-link").value = share;
  $("#open-share").href = share;
  $("#share-qr").src = "/api/widget/qr/" + encodeURIComponent(s.site_key) + "?format=png";

  const basics = $("#site-basics");
  basics.name.value = s.name;
  basics.url.value = s.url;

  const persona = $("#persona-form");
  persona.persona.value = s.persona || "";
  persona.tone.value = s.tone || "";
  persona.greeting.value = s.greeting || "";
  persona.starter_questions.value = (s.starter_questions || []).join("\n");
  persona.guardrails.value = s.guardrails || "";
  persona.banned_topics.value = (s.banned_topics || []).join(", ");
  persona.proactive_delay_ms.value = s.proactive_delay_ms ?? 4000;

  const theme = $("#theme-form");
  theme.mode.value = (s.theme && s.theme.mode) || "dark";
  theme.primary.value = (s.theme && s.theme.primary) || "#a78bfa";
  theme.sound_default.checked = !!s.sound_default;
  theme.show_branding.checked = s.show_branding !== false;
  theme.show_branding.disabled = s.plan === "free";
  $("#branding-note").textContent = s.plan === "free"
    ? "Free plan always shows the badge. Pro and Business can remove it."
    : "Pro and Business can hide the badge.";
  if (theme.voice_enabled) theme.voice_enabled.checked = !!s.voice_enabled;
  const booking = $("#booking-form");
  if (booking) booking.booking_url.value = s.booking_url || "";
  renderCards();
  fillModelForm();

  const picks = $("#template-picks");
  picks.innerHTML = "";
  state.templates.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = "<strong>" + escapeHtml(t.name) + "</strong><span class='muted tiny'>" + escapeHtml(t.tagline) + "</span>";
    b.addEventListener("click", () => {
      persona.persona.value = t.persona;
      persona.tone.value = t.tone;
      persona.greeting.value = t.greeting;
      persona.starter_questions.value = (t.starter_questions || []).join("\n");
      persona.guardrails.value = t.guardrails || "";
      persona.banned_topics.value = (t.banned_topics || []).join(", ");
      $$("#template-picks button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    });
    picks.appendChild(b);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function lines(v) { return String(v || "").split(/\n/).map((s) => s.trim()).filter(Boolean); }
function csv(v) { return String(v || "").split(/,/).map((s) => s.trim()).filter(Boolean); }

$("#auth-switch").addEventListener("click", (ev) => {
  const link = ev.target.closest("a[data-mode]");
  if (!link) return;
  ev.preventDefault();
  setAuthMode(link.dataset.mode);
  $("#auth-form").email.focus();
});

$("#pw-toggle").addEventListener("click", () => {
  const input = $("#auth-form").password;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  $("#pw-toggle").textContent = show ? "Hide" : "Show";
  $("#pw-toggle").setAttribute("aria-label", show ? "Hide password" : "Show password");
});

$("#auth-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("#auth-error");
  err.hidden = true;
  const fd = new FormData(ev.target);
  const mode = ev.target.dataset.mode || "login";
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Enter a valid email address."; err.hidden = false; return; }
  if (password.length < 8) { err.textContent = "Password must be at least 8 characters."; err.hidden = false; return; }
  const submit = $("#auth-submit");
  const label = submit.textContent;
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  submit.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
  try {
    const data = await req("/api/auth/" + (mode === "signup" ? "signup" : "login"), {
      method: "POST",
      body: { email, password, name: fd.get("name") }
    });
    state.token = data.token;
    state.owner = data.owner;
    localStorage.setItem("gc_token", data.token);
    showAuth(false);
    showOwner(data.owner);
    if (mode === "signup") toast("Welcome to GhostChat! Add your first site to begin.");
    await refreshSites();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
    submit.textContent = label;
  }
});

$("#sign-out").addEventListener("click", () => {
  state.token = ""; state.owner = null; state.site = null;
  localStorage.removeItem("gc_token");
  setAuthMode("login");
  showAuth(true);
});

function openNew() { $("#new-dialog").showModal(); }
$("#new-site").addEventListener("click", openNew);
$("#empty-new").addEventListener("click", openNew);
$("#new-cancel").addEventListener("click", () => $("#new-dialog").close());
$("#new-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("#new-error");
  err.hidden = true;
  const fd = new FormData(ev.target);
  try {
    const { site } = await req("/api/sites", {
      method: "POST",
      body: { url: fd.get("url"), name: fd.get("name"), template: fd.get("template") }
    });
    $("#new-dialog").close();
    ev.target.reset();
    await refreshSites(site.id);
    toast("Site created");
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});

$("#tabs").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b === btn));
  state.view = "sites";
  $("#billing-view")?.classList.add("hidden");
  $("#site-view")?.classList.toggle("hidden", !state.site);
  $$(".panel").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== state.tab));
  if (state.tab === "model") fillModelForm();
  if (state.tab === "convert") renderCards();
  if (state.tab === "train") loadDocs();
  if (state.tab === "transcripts") loadLogs();
  if (state.tab === "analytics") loadAnalytics();
  if (state.tab === "leads") loadLeads();
});

// Getting-started checklist: jump to the matching tab (or the embed snippet).
$$(".checklist [data-goto]").forEach((btn) => btn.addEventListener("click", () => {
  const goto = btn.dataset.goto;
  if (goto === "embed") { $("#embed-head").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  $("#tabs button[data-tab='" + goto + "']")?.click();
  $("#tabs").scrollIntoView({ behavior: "smooth", block: "start" });
}));

$("#copy-key").addEventListener("click", () => navigator.clipboard.writeText($("#site-key").value).then(() => toast("Site key copied")));
$("#copy-embed").addEventListener("click", () => navigator.clipboard.writeText($("#embed").value).then(() => toast("Snippet copied")));
$("#copy-share").addEventListener("click", () => navigator.clipboard.writeText($("#share-link").value).then(() => toast("Link copied")));

$("#site-basics").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const { site } = await req("/api/sites/" + state.site.id, { method: "PATCH", body: { name: fd.get("name"), url: fd.get("url") } });
  state.site = site;
  renderSite();
  toast("Saved");
});

$("#persona-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const { site } = await req("/api/sites/" + state.site.id, {
    method: "PATCH",
    body: {
      persona: fd.get("persona"),
      tone: fd.get("tone"),
      greeting: fd.get("greeting"),
      starter_questions: lines(fd.get("starter_questions")),
      guardrails: fd.get("guardrails"),
      banned_topics: csv(fd.get("banned_topics")),
      proactive_delay_ms: Number(fd.get("proactive_delay_ms") || 4000)
    }
  });
  state.site = site;
  renderSite();
  toast("Persona saved");
});

$("#theme-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const { site } = await req("/api/sites/" + state.site.id, {
    method: "PATCH",
    body: {
      theme: { mode: fd.get("mode"), primary: fd.get("primary") },
      sound_default: $("#theme-form").sound_default.checked,
      show_branding: $("#theme-form").show_branding.checked,
      voice_enabled: $("#theme-form").voice_enabled ? $("#theme-form").voice_enabled.checked : false
    }
  });
  state.site = site;
  renderSite();
  toast("Appearance saved");
});

$("#crawl-btn").addEventListener("click", async () => {
  const btn = $("#crawl-btn");
  const status = $("#crawl-status");
  btn.disabled = true;
  status.textContent = "Crawling — this can take a minute…";
  try {
    const data = await req("/api/sites/" + state.site.id + "/crawl", { method: "POST" });
    state.site = data.site || state.site;
    status.textContent = "Indexed " + data.pages + " pages · " + data.chunks + " chunks";
    renderSite();
    loadDocs();
    toast("Crawl complete");
  } catch (e) {
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

$("#upload-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const data = await fetch("/api/sites/" + state.site.id + "/documents", {
    method: "POST",
    headers: { authorization: "Bearer " + state.token },
    body: fd
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Upload failed");
    return j;
  });
  ev.target.reset();
  toast("Added " + (data.documents || []).length + " document(s)");
  loadDocs();
});

async function loadDocs() {
  if (!state.site) return;
  const { documents } = await req("/api/sites/" + state.site.id + "/documents");
  const box = $("#doc-list");
  box.innerHTML = documents.length ? "" : "<p class='muted'>No training documents yet.</p>";
  documents.forEach((d) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = "<strong>" + escapeHtml(d.filename) + "</strong> · " + escapeHtml(d.source_type) + " · " + d.chunk_count + " chunks";
    const del = document.createElement("button");
    del.className = "btn tiny ghost";
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      await req("/api/sites/" + state.site.id + "/documents/" + d.id, { method: "DELETE" });
      loadDocs();
    });
    item.appendChild(del);
    box.appendChild(item);
  });
}

async function loadLogs() {
  if (!state.site) return;
  const { logs } = await req("/api/sites/" + state.site.id + "/logs");
  const box = $("#log-list");
  box.innerHTML = logs.length ? "" : "<p class='muted'>No conversations yet.</p>";
  logs.forEach((l) => {
    const item = document.createElement("div");
    item.className = "log";
    const when = new Date(l.created_at).toLocaleString();
    const extra = [l.was_unsure ? "unsure" : "", l.feedback || "", l.page_url || ""].filter(Boolean).join(" · ");
    item.innerHTML = "<div class='who'>" + escapeHtml(l.role) + " · " + escapeHtml(when) + (extra ? " · " + escapeHtml(extra) : "") + "</div><div>" + escapeHtml(l.message) + "</div>";
    box.appendChild(item);
  });
}

async function loadAnalytics() {
  if (!state.site) return;
  const { analytics } = await req("/api/sites/" + state.site.id + "/analytics");
  const a = analytics;
  const box = $("#analytics");
  const q = (a.topQuestions || []).map((x) => "<li>" + escapeHtml(x.message) + " <span class='muted'>×" + x.count + "</span></li>").join("") || "<li class='muted'>None yet</li>";
  const pages = (a.questionsByPage || []).map((x) => "<li>" + escapeHtml(x.url) + " <span class='muted'>×" + x.count + "</span></li>").join("") || "<li class='muted'>No page data yet — it appears once visitors ask questions from your site.</li>";
  const gaps = (a.unanswered || []).map((x) => "<li>" + escapeHtml(x.message) + "</li>").join("") || "<li class='muted'>No unanswered gaps right now</li>";
  const sat = a.satisfaction || {};
  box.innerHTML = `
    <div class="stat-row">
      <div class="stat"><b>${a.totals.messagesThisPeriod}</b> messages this period</div>
      <div class="stat"><b>${sat.score == null ? "—" : sat.score + "%"}</b> helpful (${sat.up || 0} 👍 / ${sat.down || 0} 👎)</div>
      <div class="stat"><b>${a.totals.leads}</b> leads this period</div>
    </div>
    <div><h3>Top questions</h3><ul>${q}</ul></div>
    <div><h3>Pages driving questions</h3><ul>${pages}</ul></div>
    <div><h3>Unanswered gaps</h3><ul>${gaps}</ul></div>
  `;
}

async function loadLeads() {
  if (!state.site) return;
  const { leads } = await req("/api/sites/" + state.site.id + "/leads");
  const box = $("#lead-list");
  box.innerHTML = leads.length ? "" : "<p class='muted'>No leads yet.</p>";
  leads.forEach((l) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = "<strong>" + escapeHtml(l.email) + "</strong>" +
      (l.name ? " · " + escapeHtml(l.name) : "") +
      "<div class='muted tiny'>" + escapeHtml(new Date(l.created_at).toLocaleString()) + "</div>" +
      (l.notes ? "<div>" + escapeHtml(l.notes) + "</div>" : "") +
      (l.transcript ? "<pre class='muted tiny' style='white-space:pre-wrap'>" + escapeHtml(l.transcript) + "</pre>" : "");
    box.appendChild(item);
  });
}


function renderCards() {
  const box = $("#card-list");
  if (!box || !state.site) return;
  const cards = state.site.conversion_cards || [];
  box.innerHTML = cards.length ? "" : "<p class='muted'>No conversion cards yet.</p>";
  cards.forEach((card, i) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = "<strong>" + escapeHtml(card.type) + "</strong> · " + escapeHtml(card.title || "") +
      (card.code ? " · <code>" + escapeHtml(card.code) + "</code>" : "");
    const del = document.createElement("button");
    del.className = "btn tiny ghost";
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      const next = (state.site.conversion_cards || []).filter((_, j) => j !== i);
      const { site } = await req("/api/sites/" + state.site.id, { method: "PATCH", body: { conversion_cards: next } });
      state.site = site;
      renderCards();
    });
    item.appendChild(del);
    box.appendChild(item);
  });
}

async function loadCatalog() {
  if (state.catalog) return state.catalog;
  try {
    const data = await req("/api/models");
    state.catalog = data.catalog;
  } catch {
    state.catalog = { providers: [], defaultProvider: "openrouter", defaultModel: "deepseek/deepseek-v4-flash", embedding: { dimensions: 384, supported: true } };
  }
  return state.catalog;
}

async function fillModelForm() {
  const catalog = await loadCatalog();
  const providerSel = $("#chat-provider");
  const modelSel = $("#chat-model");
  if (!providerSel || !modelSel) return;
  const currentProvider = (state.site && state.site.chat_provider) || catalog.defaultProvider;
  providerSel.innerHTML = "";
  (catalog.providers || []).forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name + (p.enabled ? "" : " (key not configured)");
    opt.disabled = !p.enabled;
    if (p.id === currentProvider) opt.selected = true;
    providerSel.appendChild(opt);
  });
  function fillModels() {
    const prov = (catalog.providers || []).find((p) => p.id === providerSel.value);
    modelSel.innerHTML = "";
    (prov ? prov.models : []).forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      if (state.site && state.site.chat_model === m.id) opt.selected = true;
      modelSel.appendChild(opt);
    });
  }
  fillModels();
  providerSel.onchange = fillModels;
  const note = $("#model-note");
  if (note) {
    const enabled = (catalog.providers || []).filter((p) => p.enabled).map((p) => p.name);
    note.textContent = enabled.length
      ? "Enabled now: " + enabled.join(", ") + ". Missing keys fall back to OpenRouter (DeepSeek V4 Flash)."
      : "No provider keys are set yet. Add OPENROUTER_API_KEY so DeepSeek V4 Flash can run by default.";
  }
  const emb = $("#embedding-note");
  if (emb && catalog.embedding) {
    emb.textContent = catalog.embedding.supported
      ? "Embeddings are global (not per-site) so every bot shares the same search index: " +
        (catalog.embedding.provider || "") + " / " + (catalog.embedding.model || "") + " at " + catalog.embedding.dimensions + " dimensions."
      : "Embeddings are not configured yet. Set GROK_API_KEY or OPENAI_API_KEY. Vectors must stay 384-d to match the local MiniLM index.";
  }
}

async function showBilling() {
  state.view = "billing";
  $("#site-view")?.classList.add("hidden");
  $("#empty-state")?.classList.add("hidden");
  $("#billing-view")?.classList.remove("hidden");
  const box = $("#billing-body");
  try {
    const data = await req("/api/billing");
    const b = data.billing;
    state.billing = b;
    const current = b.plan || "free";
    const plans = [
      { id: "free", name: "Free", msgs: "200", extra: ["2 sites", "15 leads / month", "GhostChat badge"] },
      { id: "pro", name: "Pro", msgs: "5,000", extra: ["10 sites", "1,000 leads / month", "Remove the badge"], url: b.checkout && b.checkout.pro },
      { id: "business", name: "Business", msgs: "25,000", extra: ["50 sites", "10,000 leads / month", "50 conversion cards"], url: b.checkout && b.checkout.business }
    ];
    box.innerHTML = "<div class='plan-grid'>" + plans.map((p) => {
      const isCurrent = p.id === current;
      let action = "";
      if (isCurrent) action = "<span class='btn ghost' aria-disabled='true'>Current plan</span>";
      else if (p.url) action = "<a class='btn primary' href='" + escapeHtml(p.url) + "' target='_blank' rel='noopener'>Upgrade to " + p.name + "</a>";
      else if (p.id !== "free") action = "<span class='btn ghost' aria-disabled='true'>Coming soon</span>";
      return "<div class='plan-card" + (isCurrent ? " current" : "") + "'>" +
        "<span class='pill'>" + (isCurrent ? "Your plan" : p.name) + "</span>" +
        "<h4>" + p.name + "</h4><p class='muted tiny'>" + p.msgs + " messages / month</p>" +
        "<ul>" + p.extra.map((x) => "<li>" + x + "</li>").join("") + "</ul>" + action + "</div>";
    }).join("") + "</div>" +
      "<p class='muted tiny' style='margin-top:16px'>Already paid? Your plan updates within a minute. Make sure the email on your Whop purchase matches <b>" +
      escapeHtml((state.owner && state.owner.email) || "your account email") + "</b>.</p>";
  } catch (e) {
    box.innerHTML = "<p class='error'>" + escapeHtml(e.message) + "</p>";
  }
}

document.getElementById("open-billing")?.addEventListener("click", showBilling);

document.getElementById("notion-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  await req("/api/sites/" + state.site.id + "/documents/notion", { method: "POST", body: { url: fd.get("url") } });
  ev.target.reset();
  toast("Notion page imported");
  loadDocs();
});

document.getElementById("booking-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const { site } = await req("/api/sites/" + state.site.id, { method: "PATCH", body: { booking_url: fd.get("booking_url") } });
  state.site = site;
  toast("Booking link saved");
});

document.getElementById("card-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const triggers = String(fd.get("triggers") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const card = {
    id: "card_" + Date.now().toString(36),
    type: fd.get("type"),
    title: fd.get("title"),
    subtitle: fd.get("subtitle") || undefined,
    url: fd.get("url") || undefined,
    image: fd.get("image") || undefined,
    price: fd.get("price") || undefined,
    code: fd.get("code") || undefined,
    cta: fd.get("cta") || undefined,
    triggers: triggers.length ? triggers : undefined
  };
  const next = (state.site.conversion_cards || []).concat([card]);
  const { site } = await req("/api/sites/" + state.site.id, { method: "PATCH", body: { conversion_cards: next } });
  state.site = site;
  ev.target.reset();
  renderCards();
  toast("Card added");
});

document.getElementById("model-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const { site } = await req("/api/sites/" + state.site.id, {
    method: "PATCH",
    body: { chat_provider: fd.get("chat_provider"), chat_model: fd.get("chat_model") }
  });
  state.site = site;
  toast("Model saved");
});


boot();
