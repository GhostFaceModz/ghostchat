// GhostChat owner dashboard: auth (email + optional OAuth), sites, training, styling, billing.
const api = "";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Canonical public origin for embed snippets and share links. Local dev keeps location.origin.
// Existing embeds that load widget.js from ghostchat-nfoc.onrender.com still work (API_BASE comes from the script URL).
const PUBLIC_ORIGIN = (function () {
  try {
    const h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return location.origin;
  } catch {}
  return "https://ghostchat.pro";
})();
window.GHOSTCHAT_PUBLIC_ORIGIN = PUBLIC_ORIGIN;

// Session token: localStorage when "Remember me" is on (about 30 days), sessionStorage otherwise.
function widgetScriptUrl(origin) {
  const base = (origin || PUBLIC_ORIGIN || "https://ghostchat.pro").replace(/\/$/, "");
  const v = window.GHOSTCHAT_WIDGET_V || "dev";
  return base + "/widget.js?v=" + encodeURIComponent(v);
}

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
  billInterval: "monthly",
  view: "sites",
  workspaceId: "",
  workspaces: [],
  role: "owner",
  mailer: false,
  limits: null
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
  if (state.workspaceId) headers["x-ghostchat-workspace"] = state.workspaceId;
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

function workspacePlan() {
  const w = (state.workspaces || []).find((x) => x.id === state.workspaceId);
  return (w && w.plan) || (state.owner && state.owner.plan) || "free";
}

function applyWorkspaceRole() {
  const w = (state.workspaces || []).find((x) => x.id === state.workspaceId);
  state.role = w ? w.role : "owner";
  document.body.dataset.role = state.role;
  fillWorkspaceSwitch();
}

function fillWorkspaceSwitch() {
  const wrap = $("#workspace-switch");
  const sel = $("#workspace-select");
  if (!wrap || !sel) return;
  const list = state.workspaces || [];
  wrap.classList.toggle("hidden", list.length < 2);
  sel.innerHTML = list.map((w) => {
    const label = (w.self ? "Your workspace" : (w.name || w.email)) + " · " + w.role;
    return `<option value="${escapeHtml(w.id)}"${w.id === state.workspaceId ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

async function applyMe(me) {
  state.owner = me.owner;
  state.workspaces = me.workspaces || [{ id: me.owner.id, name: me.owner.name, email: me.owner.email, plan: me.owner.plan, role: "owner", self: true }];
  state.mailer = Boolean(me.mailer);
  state.limits = me.limits || null;
  const saved = (() => { try { return localStorage.getItem("gc_workspace"); } catch { return ""; } })();
  if (saved && state.workspaces.some((w) => w.id === saved)) state.workspaceId = saved;
  else state.workspaceId = me.workspaceId || me.owner.id;
  applyWorkspaceRole();
  showOwner(me.owner);
}

async function acceptPendingInvite() {
  const token = new URLSearchParams(location.search).get("invite");
  if (!token || !state.token) return;
  try {
    const r = await req("/api/team/invites/" + encodeURIComponent(token) + "/accept", { method: "POST" });
    if (r.workspaceId) {
      state.workspaceId = r.workspaceId;
      try { localStorage.setItem("gc_workspace", r.workspaceId); } catch {}
    }
    const qs = new URLSearchParams(location.search);
    qs.delete("invite");
    history.replaceState({}, "", location.pathname + (qs.toString() ? "?" + qs : "") + location.hash);
    toast("Invite accepted");
    const me = await req("/api/auth/me");
    await applyMe(me);
  } catch (e) {
    toast(e.message || "Could not accept that invite");
  }
}

function showOwner(owner) {
  const role = state.role && state.role !== "owner" ? " · " + state.role : "";
  $("#owner-email").textContent = owner.email + (owner.plan ? " · " + owner.plan : "") + role;
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
  const authError = params.get("auth_error");
  // Short-lived OAuth code arrives in the URL fragment, never as a session token in the query string.
  const hashParams = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const authCode = hashParams.get("gc_code") || params.get("auth_code");
  if (authCode) {
    try {
      const res = await fetch("/api/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: authCode }) });
      const data = await res.json();
      if (res.ok && data.token) {
        state.token = data.token;
        tokenStore.set(data.token, data.remember !== false);
      }
    } catch { /* fall through to the sign-in form */ }
    hashParams.delete("gc_code");
    params.delete("auth_code");
    const qs = params.toString();
    const restHash = hashParams.toString();
    history.replaceState({}, "", location.pathname + (qs ? "?" + qs : "") + (restHash ? "#" + restHash : ""));
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
  if (!state.token) {
    showAuth(true);
    const inviteTok = params.get("invite");
    if (inviteTok) {
      fetch("/api/team/invites/" + encodeURIComponent(inviteTok)).then((r) => r.json()).then((d) => {
        if (!d.invite) return;
        if (d.invite.email) $("#auth-form").email.value = d.invite.email;
        $("#auth-sub").textContent = "Accept your invite to " + (d.invite.workspaceName || "a GhostChat workspace") + " as a " + d.invite.role + ".";
      }).catch(() => {});
    }
    return;
  }
  try {
    const me = await req("/api/auth/me");
    await applyMe(me);
    showAuth(false);
    await acceptPendingInvite();
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
  if (state.tab === "live" && window.gcRenderLive) window.gcRenderLive();
  if (window.gcRenderTools) window.gcRenderTools();
  if (window.gcSiteChanged) window.gcSiteChanged();
  if (state.tab === "leads") loadLeads();
}

// ---- Message top-ups ----
function topupsHtml(b) {
  const packs = (b && b.topups) || [];
  if (!packs.length) return "";
  return "<div class='topup-head'><h4>Buy messages</h4><span class='muted tiny'>Credits: <b>" + Number(b.credits || 0).toLocaleString("en-GB") + "</b> · used after your monthly allowance, never expire</span></div>" +
    "<div class='topup-row'>" + packs.map((t) => "<a class='topup' href='" + escapeHtml(checkoutUrl(t.url)) + "' target='_blank' rel='noopener'><b>" + t.messages.toLocaleString("en-GB") + " messages</b><span>£" + t.price + " <small>+ VAT</small></span><em>One-time</em></a>").join("") + "</div>";
}
async function renderUsageBanner(s) {
  const box = $("#usage-banner"); if (!box) return;
  const used = s.messages_this_period || 0, limit = s.message_limit || 200;
  const pct = used / limit;
  if (pct < 0.8) { box.classList.add("hidden"); return; }
  let b = state.billing;
  if (!b || !b.topups) { try { b = (await req("/api/billing")).billing; state.billing = b; } catch { b = {}; } }
  const credits = Number(b.credits || 0);
  const grace = Math.floor(limit * 1.1);
  let msg;
  if (used >= grace && !credits) msg = "<b>Your bot is paused.</b> It used its " + limit.toLocaleString("en-GB") + " monthly messages plus 10% grace. Visitors see a polite \"taking a break\" message until you top up or the month resets.";
  else if (used >= limit) msg = credits ? "<b>Monthly allowance used.</b> Your bot is now using top-up credits (" + credits.toLocaleString("en-GB") + " left)." : "<b>Monthly allowance used.</b> You're in a 10% grace period (" + Math.max(0, grace - used) + " messages left), then the bot pauses until you top up or the month resets.";
  else msg = "<b>" + Math.round(pct * 100) + "% of this month's messages used</b> (" + used.toLocaleString("en-GB") + " / " + limit.toLocaleString("en-GB") + "). Top up or upgrade so your bot doesn't pause.";
  box.className = "usage-banner " + (used >= limit ? "warn" : "note");
  box.innerHTML = "<p>" + msg + "</p>" + topupsHtml(b);
}


async function loadInstallHealth(refresh) {
  const box = $("#install-health");
  if (!box || !state.site) return;
  box.innerHTML = "<p class='muted tiny'>Checking whether the widget is on your site…</p>";
  try {
    const r = await req("/api/sites/" + state.site.id + "/install-health" + (refresh ? "?refresh=1" : ""));
    const h = r.health || {};
    const tone = h.status === "active" ? "ok" : h.status === "installed" ? "note" : h.status === "missing" ? "warn" : "note";
    const seen = h.lastSeenAt ? " Last seen " + new Date(h.lastSeenAt).toLocaleString("en-GB") + "." : "";
    box.className = "install-health " + tone;
    box.innerHTML = "<p><b>" + escapeHtml(h.label || "Install status") + "</b> " + escapeHtml(h.detail || "") + escapeHtml(seen) + "</p><button type='button' class='btn tiny ghost' id='install-recheck'>Check again</button>";
    $("#install-recheck")?.addEventListener("click", () => loadInstallHealth(true));
  } catch (e) {
    box.className = "install-health note";
    box.innerHTML = "<p class='muted tiny'>" + escapeHtml(e.message || "Could not check the install.") + "</p>";
  }
}

function renderSite() {
  const s = state.site;
  $("#site-title").textContent = s.name;
  $("#plan-pill").textContent = s.plan;
  const used = s.messages_this_period || 0;
  const limit = s.message_limit || 200;
  $("#usage-label").textContent = used + " / " + limit + " messages this month";
  $("#usage-bar i").style.width = Math.min(100, Math.round((used / limit) * 100)) + "%";
  renderUsageBanner(s);
  $("#site-key").value = s.site_key;
  const snippet = `<script src="${widgetScriptUrl(PUBLIC_ORIGIN)}" data-id="${s.site_key}"></script>`;
  $("#embed").value = snippet;
  $("#open-demo").href = "/demo?key=" + encodeURIComponent(s.site_key);
  loadInstallHealth();
  const share = PUBLIC_ORIGIN + "/c/" + encodeURIComponent(s.site_key);
  $("#share-link").value = share;
  $("#open-share").href = share;
  $("#share-qr").src = "/api/widget/qr/" + encodeURIComponent(s.site_key) + "?format=png";
  $("#share-og").src = "/og/" + encodeURIComponent(s.site_key) + ".png?v=" + encodeURIComponent(s.updated_at || "");

  const basics = $("#site-basics");
  basics.name.value = s.name;
  basics.url.value = s.url;

  const persona = $("#persona-form");
  persona.persona.value = s.persona || "";
  persona.tone.value = s.tone || "";
  persona.answer_mode.value = s.answer_mode === "strict" ? "strict" : "helpful";
  persona.reveal_model.checked = !!s.reveal_model;
  persona.max_sources.value = String([0, 1, 3].includes(s.max_sources) ? s.max_sources : 1);
  persona.open_site_links.value = s.open_site_links === "new_tab" ? "new_tab" : "same_tab";
  persona.max_suggestions.value = String(Number.isInteger(s.max_suggestions) && s.max_suggestions >= 0 && s.max_suggestions <= 3 ? s.max_suggestions : 2);
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
  if (theme.read_aloud_enabled) theme.read_aloud_enabled.checked = s.read_aloud_enabled !== false;
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
    tokenStore.set(data.token, fd.get("remember") === "on");
    const me = await req("/api/auth/me");
    await applyMe(me);
    showAuth(false);
    if (mode === "signup") toast("Welcome to GhostChat! Add your first site to begin.");
    await acceptPendingInvite();
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

// If the tab row overflows (phones, or a very narrow window), map the mouse wheel
// to horizontal scroll so later tabs stay reachable on a PC without a visible scrollbar.
$("#tabs").addEventListener("wheel", (ev) => {
  const bar = ev.currentTarget;
  if (bar.scrollWidth <= bar.clientWidth + 1) return;
  if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
  ev.preventDefault();
  bar.scrollLeft += ev.deltaY;
}, { passive: false });

$("#tabs").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  btn.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
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
$("#shopify-snippet")?.addEventListener("click", () => {
  if (!state.site) return;
  const key = state.site.site_key || "";
  fetch("/integrations/ghostchat.liquid").then((r) => r.ok ? r.text() : Promise.reject()).then((tpl) => {
    const body = key && /^gc_[A-Za-z0-9_-]+$/.test(key) ? tpl.replace('data-id="YOUR_SITE_KEY"', 'data-id="' + key + '"') : tpl;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    a.download = "ghostchat.liquid";
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(() => {
    const a = document.createElement("a");
    a.href = "/integrations/ghostchat.liquid";
    a.download = "ghostchat.liquid";
    a.click();
  });
});
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
      answer_mode: fd.get("answer_mode") === "strict" ? "strict" : "helpful",
      reveal_model: ev.target.reveal_model.checked,
      max_sources: Number(fd.get("max_sources")),
      open_site_links: fd.get("open_site_links") === "new_tab" ? "new_tab" : "same_tab",
      max_suggestions: Number(fd.get("max_suggestions")),
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
      voice_enabled: $("#theme-form").voice_enabled ? $("#theme-form").voice_enabled.checked : false,
      read_aloud_enabled: $("#theme-form").read_aloud_enabled ? $("#theme-form").read_aloud_enabled.checked : true
    }
  });
  state.site = site;
  renderSite();
  toast("Appearance saved");
});


$("#staging-publish")?.addEventListener("click", async () => {
  if (!state.site) return;
  await req("/api/sites/" + state.site.id + "/staging/publish", { method: "POST" });
  toast("Unpublished training is now live");
  loadDocs();
});
$("#staging-discard")?.addEventListener("click", async () => {
  if (!state.site) return;
  await req("/api/sites/" + state.site.id + "/staging/discard", { method: "POST" });
  toast("Unpublished training discarded");
  loadDocs();
});

$("#crawl-btn").addEventListener("click", async () => {
  const btn = $("#crawl-btn");
  const status = $("#crawl-status");
  btn.disabled = true;
  status.textContent = "Crawling — this can take a minute…";
  try {
    const data = await req("/api/sites/" + state.site.id + "/crawl", { method: "POST" });
    state.site = data.site || state.site;
    if (data.mode === "preview") {
      const d = data.changes || {};
      status.textContent = "Preview ready: +" + (d.added || 0) + " added, ~" + (d.updated || 0) + " changed, -" + (d.removed || 0) + " removed — review below";
      toast("Recrawl preview ready — approve it to update live answers");
    } else if (data.mode === "unchanged") {
      status.textContent = "Recrawl found no changes";
      toast("No changes in this recrawl");
    } else {
      status.textContent = "Indexed " + data.pages + " pages · " + data.chunks + " chunks";
      toast("Crawl complete");
    }
    renderSite();
    loadDocs();
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
  toast((data.staging ? "Added to the test widget: " : "Added ") + (data.documents || []).length + " document(s)");
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
  loadPreviewAndStaging();
}


function previewUrlList(items, limit) {
  return (items || []).slice(0, limit || 12).map((e) => "<li>" + escapeHtml((e.title || e.url || "") + (e.title && e.url ? " — " + e.url : "")) + "</li>").join("");
}

async function loadPreviewAndStaging() {
  if (!state.site) return;
  const box = $("#preview-box");
  const stagingBox = $("#staging-box");
  if (!box) return;
  try {
    const { preview } = await req("/api/sites/" + state.site.id + "/preview");
    if (!preview) { box.className = "preview-box hidden"; box.innerHTML = ""; }
    else if (preview.status === "pending") {
      const d = preview.diff || {};
      box.className = "preview-box pending";
      box.innerHTML = "<h4>Recrawl waiting for approval</h4>"
        + "<p class='muted tiny'>+" + (preview.added || 0) + " added · ~" + (preview.updated || 0) + " changed · -" + (preview.removed || 0) + " removed · " + (preview.unchanged || 0) + " unchanged. Live answers stay on the current training until you approve.</p>"
        + (d.added && d.added.length ? "<p class='tiny'><b>Added</b></p><ul>" + previewUrlList(d.added) + "</ul>" : "")
        + (d.updated && d.updated.length ? "<p class='tiny'><b>Changed</b></p><ul>" + previewUrlList(d.updated) + "</ul>" : "")
        + (d.removed && d.removed.length ? "<p class='tiny'><b>Removed</b></p><ul>" + previewUrlList(d.removed) + "</ul>" : "")
        + "<div class='row'><button type='button' class='btn primary' id='preview-approve'>Approve and publish</button>"
        + "<button type='button' class='btn ghost' id='preview-reject'>Discard preview</button></div>";
      $("#preview-approve")?.addEventListener("click", async () => {
        await req("/api/sites/" + state.site.id + "/preview/approve", { method: "POST" });
        toast("Recrawl published");
        loadDocs();
      });
      $("#preview-reject")?.addEventListener("click", async () => {
        await req("/api/sites/" + state.site.id + "/preview/reject", { method: "POST" });
        toast("Preview discarded");
        loadDocs();
      });
    } else if (preview.status === "unchanged") {
      box.className = "preview-box unchanged";
      box.innerHTML = "<h4>Last recrawl found no changes</h4><p class='muted tiny'>The published training already matches the site.</p>";
    } else {
      box.className = "preview-box hidden";
      box.innerHTML = "";
    }
  } catch { box.className = "preview-box hidden"; }

  try {
    const data = await req("/api/sites/" + state.site.id + "/staging");
    if (data.site) state.site = data.site;
    const key = data.staging_site_key || state.site.staging_site_key;
    const snippet = key ? '<script src="' + widgetScriptUrl(PUBLIC_ORIGIN) + '" data-id="' + key + '"></script>' : "";
    const pre = $("#staging-snippet");
    if (pre) pre.textContent = snippet;
    const open = $("#staging-open");
    if (open && key) open.href = "/test-widget.html?key=" + encodeURIComponent(key);
    const list = $("#staging-docs");
    const docs = (data.documents || []).filter((d) => !d.preview_id);
    if (list) {
      list.innerHTML = docs.length ? docs.map((d) => "<div class='item'><strong>" + escapeHtml(d.filename) + "</strong> · " + escapeHtml(d.source_type) + " · " + d.chunk_count + " chunks · unpublished</div>").join("") : "<p class='muted tiny'>No unpublished documents yet. Tick “Add to the test widget first” when you upload or paste.</p>";
    }
  } catch {}
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
    if (l.role === "assistant") {
      const fix = document.createElement("button");
      fix.type = "button"; fix.className = "btn tiny ghost fix-btn"; fix.textContent = "Fix this answer";
      fix.addEventListener("click", () => openFix(l.id, "", l.message));
      item.appendChild(fix);
    }
    box.appendChild(item);
  });
}

function barChart(values, labels, opts = {}) {
  const max = Math.max(1, ...values);
  const hi = opts.highlight;
  return "<div class='bars" + (opts.dense ? " dense" : "") + "' role='img' aria-label='" + escapeHtml(opts.label || "Chart") + "'>" + values.map((v, i) =>
    "<div class='bar" + (i === hi ? " hi" : "") + "' title='" + escapeHtml(labels[i] + ": " + v) + "'><i style='height:" + Math.max(v ? 4 : 0, Math.round((v / max) * 100)) + "%'></i><span>" + escapeHtml(opts.short ? opts.short(labels[i], i) : labels[i]) + "</span></div>").join("") + "</div>";
}

async function loadAnalytics() {
  if (!state.site) return;
  let tz = "Europe/London";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}
  const { analytics: a } = await req("/api/sites/" + state.site.id + "/analytics?tz=" + encodeURIComponent(tz));
  const box = $("#analytics");
  const topMax = Math.max(1, ...(a.topQuestions || []).map((x) => x.count));
  const q = (a.topQuestions || []).map((x) => "<li class='hbar'><span class='hbar-t'>" + escapeHtml(x.message) + "</span><span class='hbar-b'><i style='width:" + Math.round((x.count / topMax) * 100) + "%'></i></span><b>" + x.count + "</b></li>").join("") || "<li class='muted'>None yet</li>";
  const pages = (a.questionsByPage || []).map((x) => "<li>" + escapeHtml(x.url) + " <span class='muted'>×" + x.count + "</span></li>").join("") || "<li class='muted'>No page data yet. It appears once visitors ask questions from your site.</li>";
  const low = (a.lowConfidence || []).map((x, i) => "<li class='lowc" + (i >= 6 ? " lowc-more" : "") + "'><div><b>" + escapeHtml(x.question || "(no question)") + "</b><span class='muted tiny'>" + (x.reason === "unsure" ? "Bot wasn't sure" : "Visitor gave 👎") + " · " + escapeHtml(new Date(x.created_at).toLocaleString()) + "</span><p class='muted'>" + escapeHtml(String(x.answer || "").slice(0, 220)) + "</p></div><button type='button' class='btn small' data-fix='" + escapeHtml(x.logId) + "' data-q='" + escapeHtml(x.question || "") + "'>Fix this answer</button></li>").join("") || "<li class='muted'>No low-confidence answers right now.</li>";
  const sat = a.satisfaction || {};
  const conv = a.conversion || {};
  const days = a.daily || [];
  const hours = a.hours || new Array(24).fill(0);
  const hourLabels = hours.map((_, h) => String(h).padStart(2, "0") + ":00");
  box.innerHTML = `
    <div class="stat-row">
      <div class="stat"><b>${conv.conversations ?? 0}</b> conversations (30 days)</div>
      <div class="stat"><b>${a.answerRate == null ? "—" : a.answerRate + "%"}</b> answered confidently</div>
      <div class="stat"><b>${conv.rate ?? 0}%</b> lead conversion (${conv.leads ?? 0} leads)</div>
      <div class="stat"><b>${sat.score == null ? "—" : sat.score + "%"}</b> helpful (${sat.up || 0} 👍 / ${sat.down || 0} 👎)</div>
      <div class="stat"><b>${a.csat && a.csat.average != null ? a.csat.average + "/5" : "—"}</b> satisfaction (${(a.csat && a.csat.count) || 0} ratings)</div>
      <div class="stat"><b>${a.totals.messagesThisPeriod}</b> messages this period</div>
    </div>
    <div class="chart-card"><h3>Questions per day <span class="muted tiny">last 14 days</span></h3>${barChart(days.map((d) => d.count), days.map((d) => d.date), { label: "Questions per day", short: (l) => l.slice(8) })}</div>
    <div class="chart-card"><h3>Busiest hours <span class="muted tiny">${escapeHtml(a.timeZone || "")}${a.peakHour != null ? " · peak " + String(a.peakHour).padStart(2, "0") + ":00" : ""}</span></h3>${barChart(hours, hourLabels, { label: "Questions by hour", dense: true, highlight: a.peakHour, short: (l, i) => (i % 3 === 0 ? String(i) : "") })}</div>
    <div><h3>Top questions</h3><ul class="hbars">${q}</ul></div>
    <div><h3>Unanswered questions</h3><p class="muted tiny">Type the right answer once and it becomes a source the bot will use next time. Low-confidence and 👎 replies are listed here too.</p><ul class="lowc-list">${low}</ul>${(a.lowConfidence || []).length > 6 ? `<button type="button" class="btn ghost small" id="lowc-all">Show all ${a.lowConfidence.length}</button>` : ""}
      <form id="teach-form" class="stack tight" style="margin-top:1rem">
        <label>Teach an answer <input name="question" required placeholder="Visitor question"></label>
        <label>Your answer <textarea name="answer" required rows="3" placeholder="What the bot should say"></textarea></label>
        <button type="submit" class="btn small">Save as a source</button>
      </form>
    </div>
    <div><h3>FAQ drafts</h3><p class="muted tiny">Suggested from your site after a crawl. Approve one to add it as a source.</p><div id="faq-drafts" class="list"><p class="muted tiny">Loading…</p></div></div>
    <div><h3>Pages driving questions</h3><ul>${pages}</ul></div>
    ${a.languages && a.languages.length ? "<div><h3>Visitor languages</h3><p class='muted'>" + a.languages.map((l) => escapeHtml(l.lang) + " ×" + l.count).join(" · ") + "</p></div>" : ""}
    ${a.upgradeHint ? "<p class='muted tiny'>" + escapeHtml(a.upgradeHint) + "</p>" : ""}
    <div><h3>Your corrections</h3><div id="corrections" class="list"><p class="muted tiny">Loading…</p></div></div>
  `;
  const all = $("#lowc-all");
  if (all) all.addEventListener("click", () => { box.querySelectorAll(".lowc-more").forEach((li) => li.classList.remove("lowc-more")); all.remove(); });
  loadCorrections();
  loadFaqDrafts();
  bindTeachForm();
}

// ---- "Fix this answer" ----
function openFix(logId, question, answer, id) {
  const dlg = $("#fix-dialog");
  const f = $("#fix-form");
  f.logId.value = logId || "";
  f.cid.value = id || "";
  f.question.value = question || "";
  f.answer.value = answer || "";
  $("#fix-error").hidden = true;
  dlg.showModal();
  setTimeout(() => f.answer.focus(), 30);
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-fix]");
  if (!b) return;
  openFix(b.dataset.fix, b.dataset.q || "", "");
});
$("#fix-cancel")?.addEventListener("click", () => $("#fix-dialog").close());
$("#fix-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    await req("/api/sites/" + state.site.id + "/corrections", { method: "POST", body: { logId: f.logId.value || null, id: f.cid.value || null, question: f.question.value, answer: f.answer.value } });
    $("#fix-dialog").close();
    toast("Saved. The bot will use your answer from now on.");
    if (state.tab === "analytics") { loadCorrections(); loadFaqDrafts(); }
  } catch (e) { $("#fix-error").textContent = e.message; $("#fix-error").hidden = false; }
});
async function loadCorrections() {
  const box = $("#corrections");
  if (!box || !state.site) return;
  const { corrections } = await req("/api/sites/" + state.site.id + "/corrections").catch(() => ({ corrections: [] }));
  box.innerHTML = corrections.length ? "" : "<p class='muted tiny'>No corrections yet. Use “Fix this answer” on a reply.</p>";
  corrections.forEach((c) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = "<div><strong>" + escapeHtml(c.question) + "</strong><div class='muted'>" + escapeHtml(c.answer.slice(0, 240)) + "</div></div>";
    const row = document.createElement("span");
    row.className = "row tight";
    const edit = document.createElement("button"); edit.className = "btn tiny ghost"; edit.textContent = "Edit";
    edit.addEventListener("click", () => openFix(c.log_id, c.question, c.answer, c.id));
    const del = document.createElement("button"); del.className = "btn tiny ghost"; del.textContent = "Remove";
    del.addEventListener("click", async () => { await req("/api/sites/" + state.site.id + "/corrections/" + c.id, { method: "DELETE" }); loadCorrections(); });
    row.append(edit, del); item.appendChild(row); box.appendChild(item);
  });
}


function bindTeachForm() {
  const f = $("#teach-form");
  if (!f || f.dataset.bound) return;
  f.dataset.bound = "1";
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await req("/api/sites/" + state.site.id + "/corrections", { method: "POST", body: { question: f.question.value, answer: f.answer.value } });
      f.reset();
      toast("Saved. That answer is now a source.");
      loadCorrections();
    } catch (e) { toast(e.message || "Could not save that answer."); }
  });
}
async function loadFaqDrafts() {
  const box = $("#faq-drafts");
  if (!box || !state.site) return;
  const { drafts } = await req("/api/sites/" + state.site.id + "/faq-drafts").catch(() => ({ drafts: [] }));
  const pending = (drafts || []).filter((d) => d.status === "pending");
  const others = (drafts || []).filter((d) => d.status !== "pending");
  box.innerHTML = pending.length || others.length ? "" : "<p class='muted tiny'>No drafts yet. Re-crawl the site to generate some from headings and FAQ pages.</p>";
  const add = (d, actions) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = "<div><strong>" + escapeHtml(d.question) + "</strong><div class='muted'>" + escapeHtml(String(d.answer || "").slice(0, 240)) + "</div><div class='muted tiny'>" + escapeHtml(d.status) + (d.source_url ? " · " + escapeHtml(d.source_url) : "") + "</div></div>";
    if (actions) item.appendChild(actions);
    box.appendChild(item);
  };
  pending.forEach((d) => {
    const row = document.createElement("span");
    row.className = "row tight";
    const ok = document.createElement("button"); ok.className = "btn tiny"; ok.textContent = "Approve";
    ok.addEventListener("click", async () => { await req("/api/sites/" + state.site.id + "/faq-drafts/" + d.id + "/approve", { method: "POST" }); toast("Approved and added as a source."); loadFaqDrafts(); });
    const no = document.createElement("button"); no.className = "btn tiny ghost"; no.textContent = "Reject";
    no.addEventListener("click", async () => { await req("/api/sites/" + state.site.id + "/faq-drafts/" + d.id + "/reject", { method: "POST" }); loadFaqDrafts(); });
    row.append(ok, no);
    add(d, row);
  });
  others.slice(0, 8).forEach((d) => add(d));
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
  let byokProviders = [];
  try {
    if (!state.billing) state.billing = (await req("/api/billing")).billing;
    byokProviders = ((state.billing && state.billing.byok && state.billing.byok.keys) || []).map((k) => k.provider);
  } catch { /* catalog still works on platform keys */ }
  const currentProvider = (state.site && state.site.chat_provider) || catalog.defaultProvider;
  const currentModel = (state.site && state.site.chat_model) || "auto";
  providerSel.innerHTML = "";
  (catalog.providers || []).forEach((p) => {
    const opt = document.createElement("option");
    const own = byokProviders.includes(p.id);
    const on = p.enabled || own;
    opt.value = p.id;
    opt.textContent = p.name + (on ? (own ? " (your key)" : "") : " (key not configured)");
    opt.disabled = !on;
    if (p.id === currentProvider) opt.selected = true;
    providerSel.appendChild(opt);
  });
  function fillModels() {
    const prov = (catalog.providers || []).find((p) => p.id === providerSel.value);
    modelSel.innerHTML = "";
    (prov ? prov.models : []).forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      const creds = m.credits ? (m.credits === 1 ? "1 credit" : m.credits + " credits") : "";
      const rec = m.recommended ? " · Recommended" : "";
      opt.textContent = m.label + (creds ? " (" + creds + rec + ")" : rec);
      if (currentModel === m.id || (!state.site?.chat_model && m.id === "auto")) opt.selected = true;
      modelSel.appendChild(opt);
    });
  }
  fillModels();
  providerSel.onchange = fillModels;
  const note = $("#model-note");
  if (note) {
    const enabled = (catalog.providers || []).filter((p) => p.enabled || byokProviders.includes(p.id)).map((p) => p.name);
    note.textContent = enabled.length
      ? "Enabled now: " + enabled.join(", ") + ". Auto and the cheap default use 1 credit. Paid OpenRouter models fall back to a free model if platform credits run out."
      : "No provider keys are set yet. Add OPENROUTER_API_KEY, or a Pro/Business bring-your-own key, so the recommended default can run.";
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
    box.innerHTML = billingIntervalToggle() + "<div class='plan-grid'>" + plans.map((p) => {
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
      (state.billInterval === "yearly" && !(b.checkout && b.checkout.proYearly && b.checkout.businessYearly) ? "<p class='muted tiny'>Yearly checkout links appear here once the £90 Pro and £290 Business Whop plans are added.</p>" : "") +
      (b.membership && current !== "free" ? "<p class='tiny'><a href='/account#billing' id='billing-manage-link'>Manage or cancel your subscription</a></p>" : "") +
      "<div class='topups'>" + topupsHtml(b) + "</div>" + autoRechargeHtml(b) + byokHtml(b);
    $("#billing-manage-link")?.addEventListener("click", (ev) => { ev.preventDefault(); showAccount(); });
    bindBillingInterval(box, showBilling);
    bindAutoRecharge(box);
    bindByok(box);
  } catch (e) {
    box.innerHTML = "<p class='error'>" + escapeHtml(e.message) + "</p>";
  }
}

document.getElementById("open-billing")?.addEventListener("click", showBilling);

document.getElementById("notion-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const staged = Boolean(fd.get("staging"));
  await req("/api/sites/" + state.site.id + "/documents/notion", { method: "POST", body: { url: fd.get("url"), staging: staged ? "1" : undefined } });
  ev.target.reset();
  toast(staged ? "Notion page added to the test widget" : "Notion page imported");
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

function autoRechargeHtml(b) {
  if (!b || (b.plan !== "pro" && b.plan !== "business")) {
    return "<div class='auto-recharge muted tiny' style='margin-top:16px'>Optional auto-recharge of the £5 / £15 packs is available on Pro and Business, with a monthly cap you set.</div>";
  }
  const s = b.autoRecharge || { enabled: false, pack: 1000, capGbp: 15, spentGbp: 0 };
  const prompt = b.autoRechargePrompt;
  return "<form id='auto-recharge-form' class='stack tight' style='margin-top:18px'><h4>Auto-recharge</h4>" +
    "<p class='muted tiny'>When credits run low, we surface the pack checkout so the bot does not go quiet. Whop one-time packs cannot be charged in the background without a saved card, so you confirm the purchase. Spend counts toward your monthly cap.</p>" +
    "<label class='row tight'><input type='checkbox' name='enabled'" + (s.enabled ? " checked" : "") + "> Turn on auto-recharge</label>" +
    "<label>Pack <select name='pack'><option value='1000'" + (s.pack === 1000 ? " selected" : "") + ">£5 / 1,000 credits</option><option value='5000'" + (s.pack === 5000 ? " selected" : "") + ">£15 / 5,000 credits</option></select></label>" +
    "<label>Monthly cap (£) <input type='number' name='capGbp' min='5' max='150' step='5' value='" + Number(s.capGbp || 15) + "'></label>" +
    "<p class='muted tiny'>Used this month: £" + Number(s.spentGbp || 0) + " of £" + Number(s.capGbp || 15) + ".</p>" +
    (prompt && prompt.checkoutUrl ? "<p><a class='btn small primary' href='" + escapeHtml(checkoutUrl(prompt.checkoutUrl)) + "' target='_blank' rel='noopener'>Credits are low — buy the £" + prompt.priceGbp + " pack</a></p>" : "") +
    "<button type='submit' class='btn small'>Save auto-recharge</button></form>";
}
function bindAutoRecharge(root) {
  const f = root?.querySelector("#auto-recharge-form");
  if (!f || f.dataset.bound) return;
  f.dataset.bound = "1";
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const r = await req("/api/billing/auto-recharge", { method: "POST", body: { enabled: f.enabled.checked, pack: Number(f.pack.value), capGbp: Number(f.capGbp.value) } });
      if (state.billing) state.billing.autoRecharge = r.settings;
      toast("Auto-recharge saved");
    } catch (e) { toast(e.message || "Could not save auto-recharge."); }
  });
}
function byokHtml(b) {
  const allowed = b && b.byok && b.byok.allowed;
  if (!allowed) return "<div class='byok muted tiny' style='margin-top:16px'>On Pro and Business you can paste your own OpenRouter or OpenAI key and use premium models on your own bill.</div>";
  const keys = (b.byok.keys || []);
  const list = keys.length ? keys.map((k) => "<li><span>" + escapeHtml(k.provider) + " · " + escapeHtml(k.hint) + "</span> <button type='button' class='btn tiny ghost' data-del-key='" + escapeHtml(k.provider) + "'>Remove</button></li>").join("") : "<li class='muted'>No keys saved.</li>";
  const ready = b.byok.configured;
  return "<div class='byok' style='margin-top:18px'><h4>Your API keys</h4>" +
    (ready ? "<p class='muted tiny'>Keys are encrypted at rest and never shown again or written to logs.</p>" : "<p class='error'>Key encryption is not configured on the server yet.</p>") +
    "<ul class='list' id='byok-list'>" + list + "</ul>" +
    "<form id='byok-form' class='stack tight'><label>Provider <select name='provider'><option value='openrouter'>OpenRouter</option><option value='openai'>OpenAI</option><option value='gemini'>Google Gemini</option><option value='grok'>Grok (xAI)</option></select></label>" +
    "<label>API key <input type='password' name='key' required autocomplete='off' spellcheck='false'></label>" +
    "<button type='submit' class='btn small'" + (ready ? "" : " disabled") + ">Save key</button></form></div>";
}
function bindByok(root) {
  const f = root?.querySelector("#byok-form");
  if (f && !f.dataset.bound) {
    f.dataset.bound = "1";
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        await req("/api/billing/keys", { method: "PUT", body: { provider: f.provider.value, key: f.key.value } });
        f.key.value = "";
        toast("Key saved");
        renderAccountBilling().catch(() => {});
      } catch (e) { toast(e.message || "Could not save that key."); }
    });
  }
  root?.querySelectorAll("[data-del-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await req("/api/billing/keys/" + btn.getAttribute("data-del-key"), { method: "DELETE" });
        toast("Key removed");
        renderAccountBilling().catch(() => {});
      } catch (e) { toast(e.message || "Could not remove that key."); }
    });
  });
}

function fmt(n) { return Number(n).toLocaleString("en-GB"); }
function planCatalog(b) {
  const L = (b && b.plans) || {};
  const row = (id, name, price, extra, url) => ({
    id, name, price, url,
    msgs: fmt((L[id] && L[id].monthlyMessages) || 0),
    extra: L[id] ? [fmt(L[id].maxSites) + " sites", fmt(L[id].monthlyLeads) + " leads / month"].concat(extra) : extra
  });
  const yearly = (state.billInterval || "monthly") === "yearly";
  const proPrice = yearly ? "£90/year + VAT" : "£9/mo + VAT";
  const bizPrice = yearly ? "£290/year + VAT" : "£29/mo + VAT";
  const proUrl = yearly ? (b && b.checkout && (b.checkout.proYearly || null)) : (b && b.checkout && b.checkout.pro);
  const bizUrl = yearly ? (b && b.checkout && (b.checkout.businessYearly || null)) : (b && b.checkout && b.checkout.business);
  return [
    row("free", "Free", "£0", ["“Powered by GhostChat” badge", "Cheap/free Recommended model"]),
    row("pro", "Pro", proPrice, ["Remove the badge", "Full analytics", "BYOK and auto-recharge"], proUrl),
    row("business", "Business", bizPrice, ["Remove the badge", "50 conversion cards", "BYOK and auto-recharge"], bizUrl)
  ];
}
function billingIntervalToggle() {
  const yearly = (state.billInterval || "monthly") === "yearly";
  return "<div class='bill-switch row tight' style='margin:0 0 14px'>" +
    "<button type='button' class='btn tiny" + (yearly ? " ghost" : "") + "' data-interval='monthly'>Monthly</button>" +
    "<button type='button' class='btn tiny" + (yearly ? "" : " ghost") + "' data-interval='yearly'>Yearly <span class='muted'>2 months free</span></button></div>";
}
function bindBillingInterval(root, redraw) {
  root?.querySelectorAll("[data-interval]").forEach((btn) => {
    btn.addEventListener("click", () => { state.billInterval = btn.getAttribute("data-interval"); redraw(); });
  });
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



const AUDIT_LABELS = {
  "site.create": "Created a site",
  "site.settings": "Updated site settings",
  "training.crawl": "Crawled a site",
  "training.approve_preview": "Approved a recrawl preview",
  "training.reject_preview": "Discarded a recrawl preview",
  "training.publish_staging": "Published unpublished training",
  "training.discard_staging": "Discarded unpublished training",
  "training.upload": "Added training",
  "training.delete_document": "Removed a training document",
  "training.faq_approve": "Approved an FAQ draft",
  "training.faq_reject": "Rejected an FAQ draft",
  "training.correction": "Saved a correction",
  "training.teach": "Taught an unanswered question",
  "team.invite": "Invited a teammate",
  "team.remove": "Removed a teammate",
  "team.accept": "Accepted a team invite"
};

async function renderAudit() {
  const box = $("#acct-audit");
  if (!box) return;
  try {
    const { events } = await req("/api/team/audit");
    if (!events || !events.length) {
      box.innerHTML = "<p class='muted tiny'>No activity recorded yet.</p>";
      return;
    }
    box.innerHTML = events.map((e) => {
      const when = new Date(e.created_at).toLocaleString();
      const label = AUDIT_LABELS[e.action] || e.action;
      const who = e.actor_email || "Someone";
      const extra = e.meta && e.meta.email ? " · " + e.meta.email : (e.meta && e.meta.role ? " · " + e.meta.role : "");
      return "<div class='item'><div class='who'>" + escapeHtml(when) + " · " + escapeHtml(who) + "</div><div>" + escapeHtml(label) + escapeHtml(extra) + "</div></div>";
    }).join("");
  } catch (e) {
    box.innerHTML = "<p class='muted'>" + escapeHtml(e.message) + "</p>";
  }
}

async function renderTeam() {
  const box = $("#acct-team");
  if (!box) return;
  const intro = $("#acct-team-intro");
  try {
    const t = await req("/api/team");
    const seats = t.seats || { used: 1, cap: 1 };
    intro.textContent = "This workspace has " + seats.used + " of " + seats.cap + " seats. Pro includes 2, Business includes 5.";
    const rows = (t.members || []).map((m) => {
      const st = m.status === "pending" ? "Pending" : "Active";
      const del = t.role === "owner" ? "<button type='button' class='btn tiny ghost' data-remove-member='" + escapeHtml(m.id) + "'>Remove</button>" : "";
      return "<div class='team-row'><div><b>" + escapeHtml(m.email) + "</b><div class='muted tiny'>" + escapeHtml(m.role) + " · " + st + "</div></div>" + del + "</div>";
    }).join("") || "<p class='muted tiny'>No teammates yet.</p>";
    const form = t.role === "owner" && seats.cap > 1
      ? "<form id='team-invite-form' class='row' style='margin-top:10px'><input name='email' type='email' required placeholder='teammate@email.com' /><select name='role'><option value='agent'>Agent</option><option value='viewer'>Viewer</option></select><button class='btn primary' type='submit'>Invite</button></form><p class='muted tiny' id='team-invite-url' hidden></p>"
      : (seats.cap <= 1 ? "<p class='muted tiny'>Upgrade to Pro to invite a teammate.</p>" : "");
    box.innerHTML = rows + form;
    box.querySelectorAll("[data-remove-member]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this teammate?")) return;
        try { await req("/api/team/" + btn.getAttribute("data-remove-member"), { method: "DELETE" }); toast("Removed"); renderTeam(); }
        catch (e) { toast(e.message); }
      });
    });
    const inviteForm = $("#team-invite-form");
    if (inviteForm) inviteForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        const r = await req("/api/team/invites", { method: "POST", body: { email: inviteForm.email.value, role: inviteForm.role.value } });
        toast(r.emailed ? "Invite emailed" : "Invite created");
        const note = $("#team-invite-url");
        if (note && r.inviteUrl) { note.hidden = false; note.textContent = "Share this link: " + r.inviteUrl; }
        renderTeam();
      } catch (e) { toast(e.message); }
    });
    renderAudit();
  } catch (e) {
    box.innerHTML = "<p class='muted'>" + escapeHtml(e.message) + "</p>";
  }
}

async function renderDigest() {
  const box = $("#acct-digest");
  if (!box) return;
  try {
    const d = await req("/api/digest");
    if (!d.allowed) {
      box.innerHTML = "<p class='muted tiny'>Weekly digests are on Pro and Business.</p>";
      return;
    }
    const cur = d.current || {};
    const stats = cur.messages != null
      ? "<p><b>" + cur.messages + "</b> messages this week · <b>" + cur.leads + "</b> leads · CSAT " + (cur.csat && cur.csat.average != null ? cur.csat.average + "/5" : "n/a") + "</p>"
        + (cur.unanswered && cur.unanswered.length ? "<p class='muted tiny'>Unanswered: " + escapeHtml(cur.unanswered.slice(0, 3).map((q) => q.question).join(" · ")) + "</p>" : "<p class='muted tiny'>No unanswered questions in the last 7 days.</p>")
      : "<p class='muted tiny'>No digest data yet.</p>";
    const mailNote = d.mailer
      ? "When this is on, we'll email the summary once a week."
      : "The summary appears here. To email it, add a free Resend or AgentMail key on the server (no paid signup needed).";
    const toggle = state.role === "owner"
      ? "<label class='check'><input id='digest-opt' type='checkbox' " + (d.optIn ? "checked" : "") + " /> Email me the weekly digest</label><p class='muted tiny'>" + mailNote + "</p>"
      : "<p class='muted tiny'>" + (d.optIn ? "Digest email is on for the owner." : "The owner hasn't opted into digest email.") + "</p>";
    box.innerHTML = stats + toggle;
    const opt = $("#digest-opt");
    if (opt) opt.addEventListener("change", async () => {
      try { await req("/api/digest/opt-in", { method: "POST", body: { optIn: opt.checked } }); toast(opt.checked ? "Digest email on" : "Digest email off"); }
      catch (e) { toast(e.message); opt.checked = !opt.checked; }
    });
  } catch (e) {
    box.innerHTML = "<p class='muted'>" + escapeHtml(e.message) + "</p>";
  }
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
  renderTeam();
  renderDigest();
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
    grid.parentElement?.querySelector(".bill-switch")?.remove();
    const toggle = document.createElement("div");
    toggle.innerHTML = billingIntervalToggle();
    grid.parentElement?.insertBefore(toggle.firstChild, grid);
    bindBillingInterval($("#acct-billing"), renderAccountBilling);
    planBox.innerHTML = "<div class='plan-card current'><span class='pill'>Your plan</span><h4>" + me.name + " <small class='price'>" + me.price + "</small></h4>" +
      "<p class='muted tiny'>" + me.msgs + " messages / month · " + me.extra.join(" · ") + "</p>" + (status ? "<p class='tiny'>" + escapeHtml(status) + "</p>" : "") +
      (b.manageUrl && m ? "<a class='btn ghost small' href='" + escapeHtml(b.manageUrl) + "' target='_blank' rel='noopener'>Manage billing on Whop</a>" : "") + "</div>";
    const ups = cat.filter((p) => p.id !== "free" && p.id !== current && !(current === "business"));
    grid.innerHTML = ups.map((p) => "<div class='plan-card'><h4>" + p.name + " <small class='price'>" + p.price + "</small></h4><p class='muted tiny'>" + p.msgs + " messages / month</p><ul>" +
      p.extra.map((x) => "<li>" + x + "</li>").join("") + "</ul>" +
      (p.url ? "<a class='btn primary' href='" + escapeHtml(checkoutUrl(p.url)) + "' target='_blank' rel='noopener'>Upgrade to " + p.name + "</a>" : "<span class='btn ghost' aria-disabled='true'>Coming soon</span>") +
      (current === "pro" && m ? "<p class='muted tiny'>Your account moves to Business as soon as it's paid. Then cancel the Pro order on Whop so you're not billed twice.</p>" : "") + "</div>").join("");
    $("#acct-topups").innerHTML = topupsHtml(b);
    const ar = $("#acct-auto-recharge"); if (ar) { ar.innerHTML = autoRechargeHtml(b); bindAutoRecharge(ar); }
    const bk = $("#acct-byok"); if (bk) { bk.innerHTML = byokHtml(b); bindByok(bk); }
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
    parts.push("Or switch to Pro (£9/mo + VAT) and keep removing the badge.");
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

$("#workspace-select")?.addEventListener("change", async (ev) => {
  state.workspaceId = ev.target.value;
  try { localStorage.setItem("gc_workspace", state.workspaceId); } catch {}
  applyWorkspaceRole();
  state.site = null;
  try { await refreshSites(); toast("Switched workspace"); } catch (e) { toast(e.message); }
});

boot();
