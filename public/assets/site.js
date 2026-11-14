// GhostChat marketing pages: nav, scroll reveals, card glow, particles, copy buttons.
(() => {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const nav = document.querySelector(".nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    nav.querySelector(".menu-btn")?.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      nav.querySelector(".menu-btn").setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll(".nav-links a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("open")));
  }

  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  // Spotlight that follows the pointer inside .glow-card elements.
  document.querySelectorAll(".glow-card").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", e.clientX - r.left + "px");
      card.style.setProperty("--my", e.clientY - r.top + "px");
    });
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = document.querySelector(btn.dataset.copy);
      const text = target ? target.innerText.trim() : "";
      try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; }
      catch { btn.textContent = "Select & copy"; }
      setTimeout(() => { btn.textContent = "Copy"; }, 1600);
    });
  });

  // Signed-in visitors see an account menu instead of "Sign in" / "Start free".
  const readToken = () => { try { return localStorage.getItem("gc_token") || sessionStorage.getItem("gc_token") || ""; } catch { return ""; } };
  const clearToken = () => { try { localStorage.removeItem("gc_token"); sessionStorage.removeItem("gc_token"); } catch {} };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const token = readToken();
  if (nav && token) {
    fetch("/api/auth/me", { headers: { authorization: "Bearer " + token } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(({ owner }) => {
        if (!owner) return;
        const label = owner.name || owner.email.split("@")[0];
        const initial = (label || "?").trim().charAt(0).toUpperCase();
        const avatar = owner.avatar_url
          ? `<img src="${esc(owner.avatar_url)}" alt="" referrerpolicy="no-referrer" />`
          : `<span>${esc(initial)}</span>`;
        const wrap = document.createElement("div");
        wrap.className = "acct-menu";
        wrap.innerHTML =
          `<button type="button" class="acct-btn" aria-haspopup="menu" aria-expanded="false"><span class="acct-av">${avatar}</span><span class="acct-name">${esc(label)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>` +
          `<div class="acct-drop" role="menu" hidden><div class="acct-who"><b>${esc(label)}</b><small>${esc(owner.email)}</small></div>` +
          `<a role="menuitem" href="/account">My account</a><a role="menuitem" href="/dashboard">Dashboard</a><button type="button" role="menuitem" class="acct-out">Log out</button></div>`;
        const btn = wrap.querySelector(".acct-btn"), drop = wrap.querySelector(".acct-drop");
        const setOpen = (open) => { drop.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
        btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(drop.hidden); });
        document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) setOpen(false); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
        wrap.querySelector(".acct-out").addEventListener("click", () => { clearToken(); location.reload(); });
        const inner = nav.querySelector(".wrap") || nav;
        inner.insertBefore(wrap, nav.querySelector(".menu-btn"));
        nav.classList.add("signed-in");
        // In-page "Start free" / "Sign in" buttons go straight to the dashboard.
        // Footer: swap "Sign in" / "Sign up" for account links.
        document.querySelectorAll('footer a[href="/login"]').forEach((a) => { a.href = "/account"; a.textContent = "My account"; });
        document.querySelectorAll('footer a[href="/signup"]').forEach((a) => { a.href = "/dashboard"; a.textContent = "Dashboard"; });
        document.querySelectorAll('main a[href="/signup"], main a[href="/login"]').forEach((a) => { a.href = "/dashboard"; if (/start free|create your account|sign up/i.test(a.textContent)) a.textContent = "Open your dashboard →"; });
      })
      .catch((status) => { if (status === 401) clearToken(); });
  }
  if (location.pathname === "/pricing") document.getElementById("plans")?.scrollIntoView();

  document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = String(new Date().getFullYear()); });

  // Lightweight floating particles; skipped when the user prefers less motion.
  const canvas = document.getElementById("particles");
  if (canvas && !reduceMotion) {
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, dots = [];
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(70, (w * h) / 22000));
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.6 + 0.3, s: Math.random() * 0.25 + 0.05,
        a: Math.random() * 0.5 + 0.15, hue: Math.random() < 0.7 ? 262 : 195
      }));
    };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y -= d.s; if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w; }
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${d.hue}, 100%, 80%, ${d.a})`; ctx.fill();
      }
      requestAnimationFrame(tick);
    };
    addEventListener("resize", resize);
    resize(); tick();
  }
})();
