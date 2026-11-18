/* Dashboard command palette: Ctrl/Cmd+K jumps to tabs, sites and key pages. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const pal = $("#cmd-palette");
  const input = $("#cmd-q");
  const list = $("#cmd-list");
  const openBtn = $("#open-palette");
  if (!pal || !input || !list) return;

  if (/Mac|iPhone|iPad|iPod/.test(navigator.platform || "") || /Mac/.test(navigator.userAgent || "")) {
    document.querySelectorAll(".cmd-kbd").forEach((el) => { el.textContent = "⌘K"; });
  }

  let items = [];
  let active = 0;

  function tabCommands() {
    return [...document.querySelectorAll("#tabs button[data-tab]")].map((btn) => ({
      group: "Tabs",
      label: (btn.textContent || "").replace(/\s+/g, " ").trim(),
      run: () => btn.click(),
    })).filter((c) => c.label);
  }

  function siteCommands() {
    return [...document.querySelectorAll("#site-list button")].map((btn) => ({
      group: "Sites",
      label: (btn.textContent || "").replace(/\s+/g, " ").trim() || "Site",
      run: () => btn.click(),
    }));
  }

  function actionCommands() {
    return [
      { group: "Go", label: "Live inbox", run: () => $("#open-inbox")?.click() },
      { group: "Go", label: "My account", run: () => $("#open-account")?.click() },
      { group: "Go", label: "Plan & billing", run: () => $("#open-billing")?.click() },
      { group: "Go", label: "New site", run: () => $("#new-site")?.click() },
      { group: "Go", label: "Setup guide", run: () => window.open("/guide", "_blank", "noopener") },
    ];
  }

  function allCommands() {
    return [...actionCommands(), ...tabCommands(), ...siteCommands()];
  }

  function filter(q) {
    const n = String(q || "").trim().toLowerCase();
    if (!n) return allCommands();
    return allCommands().filter((c) => (c.group + " " + c.label).toLowerCase().includes(n));
  }

  function render() {
    const q = input.value;
    items = filter(q);
    if (active >= items.length) active = Math.max(0, items.length - 1);
    if (!items.length) {
      list.innerHTML = "<li class='muted tiny' style='padding:10px 12px'>No matches.</li>";
      return;
    }
    list.innerHTML = items.map((c, i) =>
      `<li><button type="button" role="option" aria-selected="${i === active ? "true" : "false"}" data-i="${i}"><span>${escapeHtml(c.label)}</span><small>${escapeHtml(c.group)}</small></button></li>`
    ).join("");
    list.querySelector(`button[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function openPalette() {
    if ($("#app")?.classList.contains("hidden")) return;
    pal.showModal();
    input.value = "";
    active = 0;
    render();
    input.focus();
  }

  function closePalette() {
    if (pal.open) pal.close();
  }

  function run(i) {
    const item = items[i];
    closePalette();
    if (item && typeof item.run === "function") item.run();
  }

  openBtn?.addEventListener("click", openPalette);
  pal.addEventListener("close", () => { input.value = ""; });
  pal.addEventListener("click", (e) => { if (e.target === pal) closePalette(); });
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-i]");
    if (btn) run(Number(btn.dataset.i));
  });
  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === "Enter") { e.preventDefault(); run(active); }
    else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (pal.open) closePalette();
      else openPalette();
    }
  });
})();
