/* First-pass dashboard localisation. Languages match the widget: en, es, fr, de, pt, it, nl, pl. */
(function () {
  const LANGS = ["en", "es", "fr", "de", "pt", "it", "nl", "pl"];
  const NAMES = { en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano", nl: "Nederlands", pl: "Polski" };
  const I18N = {
    en: {
      "tab.setup": "Setup", "tab.train": "Train", "tab.tools": "Search tools", "tab.persona": "Persona",
      "tab.appearance": "Appearance", "tab.model": "Model", "tab.convert": "Convert", "tab.transcripts": "Transcripts",
      "tab.analytics": "Analytics", "tab.leads": "Leads", "tab.share": "Share", "tab.live": "Live chat",
      "tab.support": "Mode & support", "tab.tickets": "Tickets", "tab.features": "Smart features",
      "nav.sites": "Your sites", "nav.new": "+ New site", "nav.jump": "Jump to…", "nav.guide": "📘 Setup guide",
      "nav.inbox": "Live inbox", "nav.billing": "Plan & billing", "nav.account": "My account", "nav.signout": "Sign out",
      "nav.workspace": "Workspace", "nav.language": "Language",
    },
    es: {
      "tab.setup": "Configuración", "tab.train": "Entrenar", "tab.tools": "Herramientas de búsqueda", "tab.persona": "Personalidad",
      "tab.appearance": "Apariencia", "tab.model": "Modelo", "tab.convert": "Conversiones", "tab.transcripts": "Transcripciones",
      "tab.analytics": "Analítica", "tab.leads": "Clientes", "tab.share": "Compartir", "tab.live": "Chat en vivo",
      "tab.support": "Modo y soporte", "tab.tickets": "Tickets", "tab.features": "Funciones inteligentes",
      "nav.sites": "Tus sitios", "nav.new": "+ Nuevo sitio", "nav.jump": "Ir a…", "nav.guide": "📘 Guía de setup",
      "nav.inbox": "Bandeja en vivo", "nav.billing": "Plan y facturación", "nav.account": "Mi cuenta", "nav.signout": "Salir",
      "nav.workspace": "Espacio de trabajo", "nav.language": "Idioma",
    },
    fr: {
      "tab.setup": "Configuration", "tab.train": "Entraînement", "tab.tools": "Outils de recherche", "tab.persona": "Persona",
      "tab.appearance": "Apparence", "tab.model": "Modèle", "tab.convert": "Conversion", "tab.transcripts": "Transcriptions",
      "tab.analytics": "Analytique", "tab.leads": "Prospects", "tab.share": "Partage", "tab.live": "Chat en direct",
      "tab.support": "Mode et support", "tab.tickets": "Tickets", "tab.features": "Fonctions intelligentes",
      "nav.sites": "Vos sites", "nav.new": "+ Nouveau site", "nav.jump": "Aller à…", "nav.guide": "📘 Guide",
      "nav.inbox": "Boîte de réception", "nav.billing": "Offre et facturation", "nav.account": "Mon compte", "nav.signout": "Déconnexion",
      "nav.workspace": "Espace de travail", "nav.language": "Langue",
    },
    de: {
      "tab.setup": "Einrichtung", "tab.train": "Training", "tab.tools": "Suchtools", "tab.persona": "Persona",
      "tab.appearance": "Erscheinung", "tab.model": "Modell", "tab.convert": "Conversion", "tab.transcripts": "Transkripte",
      "tab.analytics": "Analysen", "tab.leads": "Leads", "tab.share": "Teilen", "tab.live": "Live-Chat",
      "tab.support": "Modus & Support", "tab.tickets": "Tickets", "tab.features": "Intelligente Funktionen",
      "nav.sites": "Ihre Sites", "nav.new": "+ Neue Site", "nav.jump": "Gehe zu…", "nav.guide": "📘 Anleitung",
      "nav.inbox": "Live-Posteingang", "nav.billing": "Tarif & Abrechnung", "nav.account": "Mein Konto", "nav.signout": "Abmelden",
      "nav.workspace": "Arbeitsbereich", "nav.language": "Sprache",
    },
    pt: {
      "tab.setup": "Configuração", "tab.train": "Treinar", "tab.tools": "Ferramentas de pesquisa", "tab.persona": "Persona",
      "tab.appearance": "Aparência", "tab.model": "Modelo", "tab.convert": "Conversões", "tab.transcripts": "Transcrições",
      "tab.analytics": "Análises", "tab.leads": "Leads", "tab.share": "Partilhar", "tab.live": "Chat ao vivo",
      "tab.support": "Modo e suporte", "tab.tickets": "Tickets", "tab.features": "Funções inteligentes",
      "nav.sites": "Os seus sites", "nav.new": "+ Novo site", "nav.jump": "Ir para…", "nav.guide": "📘 Guia",
      "nav.inbox": "Caixa ao vivo", "nav.billing": "Plano e faturação", "nav.account": "A minha conta", "nav.signout": "Sair",
      "nav.workspace": "Espaço de trabalho", "nav.language": "Idioma",
    },
    it: {
      "tab.setup": "Configurazione", "tab.train": "Addestramento", "tab.tools": "Strumenti di ricerca", "tab.persona": "Persona",
      "tab.appearance": "Aspetto", "tab.model": "Modello", "tab.convert": "Conversioni", "tab.transcripts": "Trascrizioni",
      "tab.analytics": "Analisi", "tab.leads": "Lead", "tab.share": "Condividi", "tab.live": "Chat live",
      "tab.support": "Modalità e supporto", "tab.tickets": "Ticket", "tab.features": "Funzioni smart",
      "nav.sites": "I tuoi siti", "nav.new": "+ Nuovo sito", "nav.jump": "Vai a…", "nav.guide": "📘 Guida",
      "nav.inbox": "Inbox live", "nav.billing": "Piano e fatturazione", "nav.account": "Il mio account", "nav.signout": "Esci",
      "nav.workspace": "Workspace", "nav.language": "Lingua",
    },
    nl: {
      "tab.setup": "Installatie", "tab.train": "Trainen", "tab.tools": "Zoektools", "tab.persona": "Persona",
      "tab.appearance": "Uiterlijk", "tab.model": "Model", "tab.convert": "Conversie", "tab.transcripts": "Transcripten",
      "tab.analytics": "Analyses", "tab.leads": "Leads", "tab.share": "Delen", "tab.live": "Livechat",
      "tab.support": "Modus en support", "tab.tickets": "Tickets", "tab.features": "Slimme functies",
      "nav.sites": "Jouw sites", "nav.new": "+ Nieuwe site", "nav.jump": "Ga naar…", "nav.guide": "📘 Handleiding",
      "nav.inbox": "Live-inbox", "nav.billing": "Abonnement en factuur", "nav.account": "Mijn account", "nav.signout": "Uitloggen",
      "nav.workspace": "Werkruimte", "nav.language": "Taal",
    },
    pl: {
      "tab.setup": "Ustawienia", "tab.train": "Szkolenie", "tab.tools": "Narzędzia wyszukiwania", "tab.persona": "Persona",
      "tab.appearance": "Wygląd", "tab.model": "Model", "tab.convert": "Konwersje", "tab.transcripts": "Transkrypty",
      "tab.analytics": "Analityka", "tab.leads": "Leady", "tab.share": "Udostępnij", "tab.live": "Czat na żywo",
      "tab.support": "Tryb i wsparcie", "tab.tickets": "Zgłoszenia", "tab.features": "Inteligentne funkcje",
      "nav.sites": "Twoje witryny", "nav.new": "+ Nowa witryna", "nav.jump": "Przejdź do…", "nav.guide": "📘 Przewodnik",
      "nav.inbox": "Skrzynka na żywo", "nav.billing": "Plan i płatności", "nav.account": "Moje konto", "nav.signout": "Wyloguj",
      "nav.workspace": "Przestrzeń", "nav.language": "Język",
    },
  };

  function detect() {
    try {
      const saved = localStorage.getItem("gc_dash_lang");
      if (saved && I18N[saved]) return saved;
    } catch {}
    try {
      const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]);
      for (let i = 0; i < langs.length; i++) {
        const b = String(langs[i] || "").toLowerCase().split("-")[0];
        if (I18N[b]) return b;
      }
    } catch {}
    return "en";
  }

  function t(key, lang) {
    const pack = I18N[lang || stateLang] || I18N.en;
    return pack[key] || I18N.en[key] || key;
  }

  let stateLang = detect();

  function apply(lang) {
    stateLang = I18N[lang] ? lang : "en";
    try { localStorage.setItem("gc_dash_lang", stateLang); } catch {}
    document.documentElement.lang = stateLang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = t(key, stateLang);
      if (val) el.textContent = val;
    });
    const sel = document.getElementById("dash-lang");
    if (sel && sel.value !== stateLang) sel.value = stateLang;
    document.dispatchEvent(new CustomEvent("gc-dash-lang", { detail: { lang: stateLang } }));
  }

  function mountSelect() {
    const sel = document.getElementById("dash-lang");
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = "1";
    sel.innerHTML = LANGS.map((c) => `<option value="${c}">${NAMES[c]}</option>`).join("");
    sel.value = stateLang;
    sel.addEventListener("change", () => apply(sel.value));
  }

  window.GhostChatI18n = { t, apply, langs: LANGS, names: NAMES, get lang() { return stateLang; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { mountSelect(); apply(stateLang); });
  else { mountSelect(); apply(stateLang); }
})();
