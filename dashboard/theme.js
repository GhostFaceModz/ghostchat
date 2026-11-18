/* Light/dark dashboard theme: remembered in localStorage, follows prefers-color-scheme until the owner chooses. */
(function () {
  const KEY = "gc_dash_theme";

  function systemTheme() {
    try { return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
    catch { return "dark"; }
  }

  function savedTheme() {
    try {
      const s = localStorage.getItem(KEY);
      if (s === "light" || s === "dark") return s;
    } catch {}
    return null;
  }

  function apply(theme, remember) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    if (remember) {
      try { localStorage.setItem(KEY, next); } catch {}
    }
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      const toLight = next === "dark";
      const i18n = window.GhostChatI18n;
      const label = i18n ? i18n.t(toLight ? "theme.toLight" : "theme.toDark") : (toLight ? "Light theme" : "Dark theme");
      btn.textContent = label;
      btn.setAttribute("title", label);
      btn.setAttribute("aria-pressed", toLight ? "false" : "true");
    });
  }

  function current() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  apply(savedTheme() || systemTheme(), false);

  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-theme-toggle]");
    if (!btn) return;
    apply(current() === "light" ? "dark" : "light", true);
  });

  try {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => { if (!savedTheme()) apply(systemTheme(), false); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch {}

  document.addEventListener("gc-dash-lang", () => apply(current(), false));
  window.GhostChatTheme = { apply, current, saved: savedTheme };
})();
