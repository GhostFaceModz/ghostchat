// GhostChat dashboard: "Site search tools" (JSON endpoint / catalogue feed + field mapping) and crawl scope.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FIELDS = [["title", "Title", "title"], ["url", "Page link", "url"], ["image", "Image", "image"], ["subtitle", "Subtitle", ""], ["rating", "Rating", ""], ["description", "Description", ""], ["year", "Year / date", ""]];
  const INTENTS = [["recommend", "Recommendations"], ["find", "Finding a specific item"], ["howto", "How-to questions"]];
  let tools = [];

  const blank = (kind) => ({ id: "", name: kind === "feed" ? "Catalogue" : "Site search", kind, url_template: "", items_path: kind === "feed" ? "items" : "results", fields: { title: "title", url: "url", image: "image" }, intents: ["recommend", "find"], button_label: "Open", enabled: true });

  function toolCard(t, i) {
    const f = t.fields || {};
    return `<div class="tool glass" data-i="${i}">
      <div class="row between"><strong>${esc(t.name || "Search tool")}</strong>
        <span class="row tight"><label class="check"><input type="checkbox" data-k="enabled" ${t.enabled !== false ? "checked" : ""}/> On</label>
        <button type="button" class="btn ghost small" data-act="remove" aria-label="Remove tool">Remove</button></span></div>
      <div class="row two">
        <label>Name <input data-k="name" value="${esc(t.name)}" maxlength="60" /></label>
        <label>Type <select data-k="kind"><option value="json" ${t.kind !== "feed" ? "selected" : ""}>JSON search endpoint</option><option value="feed" ${t.kind === "feed" ? "selected" : ""}>Catalogue feed (one JSON file)</option></select></label>
      </div>
      <label>${t.kind === "feed" ? "Feed URL" : "URL template"} <input data-k="url_template" value="${esc(t.url_template)}" placeholder="${t.kind === "feed" ? "https://yoursite.com/catalogue.json" : "https://yoursite.com/api/search?q={query}&genre={genre}"}" /></label>
      <div class="row two">
        <label>Results list path <input data-k="items_path" value="${esc(t.items_path)}" placeholder="results" /></label>
        <label>Button text <input data-k="button_label" value="${esc(t.button_label)}" maxlength="40" placeholder="Open" /></label>
      </div>
      <div class="fieldmap">${FIELDS.map(([k, label, ph]) => `<label>${label} <input data-f="${k}" value="${esc(f[k] || "")}" placeholder="${esc(ph || "optional")}" /></label>`).join("")}</div>
      <div class="row tight">Use for: ${INTENTS.map(([k, label]) => `<label class="check"><input type="checkbox" data-intent="${k}" ${(t.intents || []).includes(k) ? "checked" : ""}/> ${label}</label>`).join("")}</div>
      <div class="row"><input class="grow" data-test-msg placeholder="Try a visitor message, e.g. a horror film like Hereditary" /><button type="button" class="btn small" data-act="test">Test</button></div>
      <div class="tool-out" aria-live="polite"></div>
    </div>`;
  }

  function readCard(node) {
    const t = { fields: {}, intents: [] };
    node.querySelectorAll("[data-k]").forEach((x) => { t[x.dataset.k] = x.type === "checkbox" ? x.checked : x.value.trim(); });
    node.querySelectorAll("[data-f]").forEach((x) => { if (x.value.trim()) t.fields[x.dataset.f] = x.value.trim(); });
    node.querySelectorAll("[data-intent]").forEach((x) => { if (x.checked) t.intents.push(x.dataset.intent); });
    return t;
  }
  const readAll = () => [...$("#tool-list").querySelectorAll(".tool")].map((n, i) => ({ ...tools[i], ...readCard(n) }));

  function render() {
    const list = $("#tool-list");
    list.innerHTML = tools.length ? tools.map(toolCard).join("") : `<p class="muted">No search tools yet.</p>`;
  }

  $("#tool-list").addEventListener("change", (ev) => { if (ev.target.dataset.k === "kind") { tools = readAll(); render(); } });
  $("#tool-list").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-act]"); if (!b) return;
    const card = b.closest(".tool"); const i = Number(card.dataset.i);
    if (b.dataset.act === "remove") { tools = readAll(); tools.splice(i, 1); render(); return; }
    const out = card.querySelector(".tool-out");
    out.innerHTML = `<p class="muted">Searching…</p>`; b.disabled = true;
    try {
      const r = await req(`/api/sites/${state.site.id}/tools/test`, { method: "POST", body: { tool: readCard(card), message: card.querySelector("[data-test-msg]").value } });
      out.innerHTML = `<p class="muted tiny">${r.intent ? `Intent: <b>${esc(r.intent)}</b> · ` : ""}Called <code>${esc(r.url)}</code> · ${r.items.length} result${r.items.length === 1 ? "" : "s"}</p>
        <div class="tool-cards">${r.items.map((it) => `<a class="tool-card" href="${esc(it.url)}" target="_blank" rel="noopener">${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy" />` : "<span class='ph'></span>"}<b>${esc(it.title)}</b><small>${esc([it.year, it.rating ? "★ " + it.rating : "", it.subtitle].filter(Boolean).join(" · "))}</small></a>`).join("") || "<p class='muted'>No results. Check the list path and field names.</p>"}</div>`;
    } catch (err) {
      out.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    } finally { b.disabled = false; }
  });
  $("#tool-add-json").addEventListener("click", () => { tools = readAll(); tools.push(blank("json")); render(); });
  $("#tool-add-feed").addEventListener("click", () => { tools = readAll(); tools.push(blank("feed")); render(); });
  $("#tool-save").addEventListener("click", async () => {
    try {
      const { site } = await req("/api/sites/" + state.site.id, { method: "PATCH", body: { search_tools: readAll() } });
      state.site = site; tools = site.search_tools || []; render(); toast("Search tools saved");
    } catch (err) { toast(err.message); }
  });

  // Crawl scope (Train tab).
  function renderScope(s) {
    const f = $("#scope-form"), c = s.crawl_scope || {};
    f.sitemap_url.value = c.sitemap_url || "";
    f.include.value = (c.include || []).join("\n");
    f.exclude.value = (c.exclude || []).join("\n");
    f.page_chunks.checked = !!c.page_chunks;
    if (c.sitemap_url || (c.include || []).length || c.page_chunks) $("#crawl-scope").open = true;
  }
  $("#scope-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const { site } = await req("/api/sites/" + state.site.id, { method: "PATCH", body: { crawl_scope: { sitemap_url: f.sitemap_url.value.trim(), include: f.include.value, exclude: f.exclude.value, page_chunks: f.page_chunks.checked } } });
      state.site = site; renderScope(site); toast("Crawl scope saved. Re-crawl to apply it.");
    } catch (err) { toast(err.message); }
  });

  window.gcRenderTools = function () {
    if (!state.site) return;
    tools = Array.isArray(state.site.search_tools) ? state.site.search_tools.map((t) => ({ ...t })) : [];
    render(); renderScope(state.site);
  };
})();
