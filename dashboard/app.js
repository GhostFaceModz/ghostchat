// GhostChat owner dashboard: auth (email + optional OAuth), sites, training, styling, billing.
const api = "";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Session token: localStorage when "Remember me" is on (about 30 days), sessionStorage otherwise.
const tokenStore = {
  get() { try { return localStorage.getItem("gc_token") || sessionStorage.getItem("gc_token") || ""; } catch { return ""; } },
  set(t, remember = true) {
    try {
      localStorage.removeItem("gc_token"); sessionStorage.removeItem("gc_token");
      (remember ? localStorage : sessionStorage).setItem("gc_token", t);
    } catch {}
  },
  remembered() { try { return Boolean(localStorage.getItem("gc_token")); } catch { return true; } },
  clear() { try { localStorage.removeItem("gc_token"); sessionStorage.removeItem("gc_token"); } catch {} }
};

const state = {
  token: tokenStore.get(),
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
    tokenStore.set(token, true);
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
    tokenStore.clear();
    showAuth(true);
    return;
  }
  if (/^\/account\/?$/.test(location.pathname) || location.hash === "#account") showAccount();
  else if (location.hash === "#billing") showBilling();
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
  $("#billing-view")?.classList.add("hidden");
  $("#account-view")?.classList.add("hidden");
  $("#site-view").classList.remove("hidden");
  if (location.pathname === "/account") history.replaceState({}, "", "/dashboard");
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
      body: { email, password, name: fd.get("name"), remember: fd.get("remember") === "on" }
    });
    state.token = data.token;
    state.owner = data.owner;
    tokenStore.set(data.token, fd.get("remember") === "on");
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

function signOutLocal() {
  state.token = ""; state.owner = null; state.site = null;
  tokenStore.clear();
  setAuthMode("login");
  showAuth(true);
}
$("#sign-out").addEventListener("click", signOutLocal);

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
  $("#account-view")?.classList.add("hidden");
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
  $("#account-view")?.classList.add("hidden");
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
      ...planCatalog(b)
    ];
    box.innerHTML = "<div class='plan-grid'>" + plans.map((p) => {
      const isCurrent = p.id === current;
      let action = "";
      if (isCurrent) action = "<span class='btn ghost' aria-disabled='true'>Current plan</span>";
      else if (p.url && current !== "business") action = "<a class='btn primary' href='" + escapeHtml(checkoutUrl(p.url)) + "' target='_blank' rel='noopener'>Upgrade to " + p.name + "</a>";
      else if (p.id !== "free") action = "<span class='btn ghost' aria-disabled='true'>Coming soon</span>";
      return "<div class='plan-card" + (isCurrent ? " current" : "") + "'>" +
        "<span class='pill'>" + (isCurrent ? "Your plan" : p.name) + "</span>" +
        "<h4>" + p.name + " <small class='price'>" + p.price + "</small></h4><p class='muted tiny'>" + p.msgs + " messages / month</p>" +
        "<ul>" + p.extra.map((x) => "<li>" + x + "</li>").join("") + "</ul>" + action + "</div>";
    }).join("") + "</div>" +
      "<p class='muted tiny' style='margin-top:16px'>Already paid? Your plan updates within a minute. Make sure the email on your Whop purchase matches <b>" +
      escapeHtml((state.owner && state.owner.email) || "your account email") + "</b>.</p>" +
      (b.membership && current !== "free" ? "<p class='tiny'><a href='/account#billing' id='billing-manage-link'>Manage or cancel your subscription</a></p>" : "");
    $("#billing-manage-link")?.addEventListener("click", (ev) => { ev.preventDefault(); showAccount(); });
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


// ---- Plans (prices and limits shown everywhere in the dashboard) ----
function fmt(n) { return Number(n).toLocaleString("en-GB"); }
function planCatalog(b) {
  const L = (b && b.plans) || {};
  const row = (id, name, price, extra, url) => ({
    id, name, price, url,
    msgs: fmt((L[id] && L[id].monthlyMessages) || 0),
    extra: L[id] ? [fmt(L[id].maxSites) + " sites", fmt(L[id].monthlyLeads) + " leads / month"].concat(extra) : extra
  });
  return [
    row("free", "Free", "£0", ["“Powered by GhostChat” badge"]),
    row("pro", "Pro", "£9/mo", ["Remove the badge", "Full analytics"], b && b.checkout && b.checkout.pro),
    row("business", "Business", "£29/mo", ["Remove the badge", "50 conversion cards"], b && b.checkout && b.checkout.business)
  ];
}
// Prefill and lock the account email in Whop checkout so the purchase maps to this account.
function checkoutUrl(url) {
  try {
    const u = new URL(url);
    if (state.owner && state.owner.email) {
      u.searchParams.set("email", state.owner.email);
      u.searchParams.set("email.disabled", "1");
    }
    return u.toString();
  } catch { return url; }
}

// ---- My account ----
function setAvatar(el, owner) {
  if (owner.avatar_url) {
    const img = document.createElement("img");
    img.src = owner.avatar_url; img.alt = "";
    el.replaceChildren(img);
  } else {
    el.textContent = (owner.name || owner.email || "?").trim().charAt(0).toUpperCase() || "👻";
  }
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); } catch { return iso; }
}

async function showAccount() {
  state.view = "account";
  ["#site-view", "#empty-state", "#billing-view"].forEach((s) => $(s)?.classList.add("hidden"));
  $("#account-view").classList.remove("hidden");
  if (location.pathname !== "/account") history.replaceState({}, "", "/account");
  let owner = state.owner;
  try { owner = (await req("/api/auth/me")).owner; state.owner = owner; } catch (e) { toast(e.message); }
  if (!owner) return;
  setAvatar($("#acct-avatar"), owner);
  $("#acct-name").textContent = owner.name || "Your account";
  $("#acct-email").textContent = owner.email + (owner.is_admin ? " · owner" : "");
  $$(".acct-email-inline").forEach((n) => { n.textContent = owner.email; });
  $("#acct-name-form").name.value = owner.name || "";
  const methods = [
    ["Google", owner.google_linked],
    ["Discord", owner.discord_linked],
    ["Email and password", owner.has_password]
  ];
  $("#acct-methods").innerHTML = methods.map(([n, on]) =>
    "<li><span>" + n + "</span><span class='" + (on ? "on'>Connected" : "off'>Not connected") + "</span></li>").join("");
  $("#acct-password").classList.toggle("hidden", !owner.has_password);
  $("#acct-delete").disabled = Boolean(owner.is_admin);
  $("#acct-delete-sub").textContent = owner.is_admin ? " The owner (admin) account can't be deleted here." : " If you pay through Whop, cancel the subscription first.";
  renderAccountBilling();
}

async function renderAccountBilling() {
  const planBox = $("#acct-plan"), grid = $("#acct-upgrades");
  try {
    const { billing: b } = await req("/api/billing");
    state.billing = b;
    const current = b.plan || "free";
    const cat = planCatalog(b);
    const me = cat.find((p) => p.id === current) || cat[0];
    const m = b.membership || null;
    let status = "";
    if (state.owner && state.owner.is_admin) status = "Owner account: Business features are included free.";
    else if (m && m.cancel_at_period_end && m.renewal_period_end) status = "Cancelled. You keep " + me.name + " until " + fmtDate(m.renewal_period_end) + ".";
    else if (m && m.renewal_period_end) status = "Renews on " + fmtDate(m.renewal_period_end) + ".";
    planBox.innerHTML = "<div class='plan-card current'><span class='pill'>Your plan</span><h4>" + me.name + " <small class='price'>" + me.price + "</small></h4>" +
      "<p class='muted tiny'>" + me.msgs + " messages / month · " + me.extra.join(" · ") + "</p>" + (status ? "<p class='tiny'>" + escapeHtml(status) + "</p>" : "") +
      (b.manageUrl && m ? "<a class='btn ghost small' href='" + escapeHtml(b.manageUrl) + "' target='_blank' rel='noopener'>Manage billing on Whop</a>" : "") + "</div>";
    const ups = cat.filter((p) => p.id !== "free" && p.id !== current && !(current === "business"));
    grid.innerHTML = ups.map((p) => "<div class='plan-card'><h4>" + p.name + " <small class='price'>" + p.price + "</small></h4><p class='muted tiny'>" + p.msgs + " messages / month</p><ul>" +
      p.extra.map((x) => "<li>" + x + "</li>").join("") + "</ul>" +
      (p.url ? "<a class='btn primary' href='" + escapeHtml(checkoutUrl(p.url)) + "' target='_blank' rel='noopener'>Upgrade to " + p.name + "</a>" : "<span class='btn ghost' aria-disabled='true'>Coming soon</span>") +
      (current === "pro" && m ? "<p class='muted tiny'>Your account moves to Business as soon as it's paid. Then cancel the Pro order on Whop so you're not billed twice.</p>" : "") + "</div>").join("");
    const paid = current !== "free" && m && !m.cancel_at_period_end && !(state.owner && state.owner.is_admin);
    $("#acct-cancel-line").hidden = !paid;
    $("#acct-cancel-note").hidden = true;
  } catch (e) {
    planBox.innerHTML = "<p class='error'>" + escapeHtml(e.message) + "</p>";
  }
}

$("#open-account").addEventListener("click", showAccount);
$("#owner-avatar").addEventListener("click", showAccount);

$("#acct-name-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    const { name } = await req("/api/auth/me", { method: "PATCH", body: { name: ev.target.name.value } });
    state.owner.name = name; $("#acct-name").textContent = name; toast("Name saved");
  } catch (e) { toast(e.message); }
});

$("#acct-pw-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("#acct-pw-error"); err.hidden = true;
  const fd = new FormData(ev.target);
  try {
    const { token } = await req("/api/auth/password", { method: "POST", body: { current_password: fd.get("current_password"), new_password: fd.get("new_password"), remember: tokenStore.remembered() } });
    state.token = token; tokenStore.set(token, tokenStore.remembered());
    ev.target.reset(); toast("Password changed. Other devices are signed out.");
  } catch (e) { err.textContent = e.message; err.hidden = false; }
});

$("#acct-logout-all").addEventListener("click", async () => {
  if (!confirm("Sign out of GhostChat on every device, including this one?")) return;
  try { await req("/api/auth/logout-all", { method: "POST" }); } catch (e) { toast(e.message); return; }
  signOutLocal(); toast("Signed out everywhere");
});

$("#acct-delete").addEventListener("click", () => {
  $("#delete-email").textContent = state.owner.email;
  $("#delete-form").reset(); $("#delete-error").hidden = true;
  $("#delete-dialog").showModal();
});
$("#delete-cancel").addEventListener("click", () => $("#delete-dialog").close());
$("#delete-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    await req("/api/auth/me", { method: "DELETE", body: { confirm_email: ev.target.confirm_email.value } });
    $("#delete-dialog").close(); signOutLocal(); toast("Your account has been deleted");
  } catch (e) { $("#delete-error").textContent = e.message; $("#delete-error").hidden = false; }
});

// ---- Cancel subscription: offer, optional reason, confirm. Two clicks: the link, then Confirm. ----
$("#acct-cancel").addEventListener("click", () => {
  const b = state.billing || {};
  const plan = b.plan;
  const offers = (b.retention || {});
  const parts = [];
  const actions = $("#cancel-offer-actions"); actions.innerHTML = "";
  if (offers.discount) {
    parts.push("Stay and get your next month at 50% off.");
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn primary small"; btn.textContent = "Take 50% off next month";
    btn.addEventListener("click", () => retention("discount")); actions.appendChild(btn);
  }
  if (plan === "business" && offers.downgrade) {
    parts.push("Or switch to Pro (£9/mo) and keep removing the badge.");
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn small"; btn.textContent = "Switch to Pro instead";
    btn.addEventListener("click", () => retention("downgrade")); actions.appendChild(btn);
  }
  $("#cancel-offer-text").textContent = parts.join(" ") || "You can keep your plan, or cancel below.";
  $("#cancel-form").reset(); $("#cancel-error").hidden = true;
  $("#cancel-dialog").showModal();
});
$("#cancel-keep").addEventListener("click", () => $("#cancel-dialog").close());

async function retention(offer) {
  const err = $("#cancel-error"); err.hidden = true;
  const b = state.billing || {};
  // Open Whop inside the click so popup blockers allow it (when we can't apply it in-app).
  if (!b.canCancelInApp && b.manageUrl) window.open(b.manageUrl, "_blank", "noopener");
  try {
    const r = await req("/api/billing/retention", { method: "POST", body: { offer } });
    $("#cancel-dialog").close();
    toast(r.message || "Done");
    renderAccountBilling();
  } catch (e) { err.textContent = e.message; err.hidden = false; }
}

$("#cancel-confirm").addEventListener("click", async () => {
  const fd = new FormData($("#cancel-form"));
  const err = $("#cancel-error"); err.hidden = true;
  const btn = $("#cancel-confirm"); btn.disabled = true;
  const b = state.billing || {};
  if (!b.canCancelInApp && b.manageUrl) window.open(b.manageUrl, "_blank", "noopener");
  try {
    const r = await req("/api/billing/cancel", { method: "POST", body: { reason: fd.get("reason"), details: fd.get("details") } });
    $("#cancel-dialog").close();
    const note = $("#acct-cancel-note");
    const show = () => {
      note.textContent = r.message + " ";
      if (r.manageUrl && !r.cancelled) {
        const a = document.createElement("a"); a.href = r.manageUrl; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open Whop orders";
        note.appendChild(a);
      }
      note.hidden = false;
    };
    show();
    if (r.cancelled) $("#acct-cancel-line").hidden = true;
    renderAccountBilling().then(show);
  } catch (e) { err.textContent = e.message; err.hidden = false; }
  finally { btn.disabled = false; }
});

boot();
