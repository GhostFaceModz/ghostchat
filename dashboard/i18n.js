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
      "nav.workspace": "Workspace", "nav.language": "Language", "eval.history": "Eval history", "eval.better": "better", "eval.worse": "worse", "eval.vsLast": "Vs last run", "eval.noChange": "no change against the last run", "gap.title": "Train this gap", "gap.train": "Add to training", "gap.draft": "Save draft", "appearance.disclosure": "AI disclosure line", "appearance.disclosureNote": "Shown at the bottom of the chat. On the Free plan it can’t be hidden — Pro and Business can clear the field to hide it.", "export.title": "Export knowledge", "export.note": "Download your FAQs, taught answers, canned replies and crawled page list as JSON or CSV.", "export.json": "Download JSON", "export.csv": "Download CSV", "logs.topic": "Topic", "logs.allTopics": "All topics", "logs.topics": "Topics", "logs.topicsNote": "Automatic tags from visitor questions. Click one to filter transcripts.", "analytics.plausible": "Plausible domain", "analytics.ga4": "GA4 measurement ID", "analytics.eventsNote": "The widget fires events for chat open, message sent, lead captured and handoff. If the host page already has Plausible or gtag, those are used; otherwise the widget sends the events itself.",
    },
    es: {
      "tab.setup": "Configuración", "tab.train": "Entrenar", "tab.tools": "Herramientas de búsqueda", "tab.persona": "Personalidad",
      "tab.appearance": "Apariencia", "tab.model": "Modelo", "tab.convert": "Conversiones", "tab.transcripts": "Transcripciones",
      "tab.analytics": "Analítica", "tab.leads": "Clientes", "tab.share": "Compartir", "tab.live": "Chat en vivo",
      "tab.support": "Modo y soporte", "tab.tickets": "Tickets", "tab.features": "Funciones inteligentes",
      "nav.sites": "Tus sitios", "nav.new": "+ Nuevo sitio", "nav.jump": "Ir a…", "nav.guide": "📘 Guía de setup",
      "nav.inbox": "Bandeja en vivo", "nav.billing": "Plan y facturación", "nav.account": "Mi cuenta", "nav.signout": "Salir",
      "nav.workspace": "Espacio de trabajo", "nav.language": "Idioma", "eval.history": "Historial de pruebas", "eval.better": "mejoraron", "eval.worse": "empeoraron", "eval.vsLast": "Frente a la última prueba", "eval.noChange": "sin cambios respecto a la última prueba", "gap.title": "Entrenar este hueco", "gap.train": "Añadir al entrenamiento", "gap.draft": "Guardar borrador", "appearance.disclosure": "Línea de divulgación de IA", "appearance.disclosureNote": "Se muestra al pie del chat. En el plan Gratis no se puede ocultar; Pro y Business pueden vaciar el campo para ocultarla.", "export.title": "Exportar conocimiento", "export.note": "Descarga tus preguntas frecuentes, respuestas enseñadas, respuestas predefinidas y la lista de páginas rastreadas como JSON o CSV.", "export.json": "Descargar JSON", "export.csv": "Descargar CSV", "logs.topic": "Tema", "logs.allTopics": "Todos los temas", "logs.topics": "Temas", "logs.topicsNote": "Etiquetas automáticas de las preguntas de los visitantes. Haz clic para filtrar las transcripciones.", "analytics.plausible": "Dominio de Plausible", "analytics.ga4": "ID de medición de GA4", "analytics.eventsNote": "El widget envía eventos al abrir el chat, enviar un mensaje, capturar un lead y transferir a un humano. Si la página ya tiene Plausible o gtag, se usan; si no, el widget los envía.",
    },
    fr: {
      "tab.setup": "Configuration", "tab.train": "Entraînement", "tab.tools": "Outils de recherche", "tab.persona": "Persona",
      "tab.appearance": "Apparence", "tab.model": "Modèle", "tab.convert": "Conversion", "tab.transcripts": "Transcriptions",
      "tab.analytics": "Analytique", "tab.leads": "Prospects", "tab.share": "Partage", "tab.live": "Chat en direct",
      "tab.support": "Mode et support", "tab.tickets": "Tickets", "tab.features": "Fonctions intelligentes",
      "nav.sites": "Vos sites", "nav.new": "+ Nouveau site", "nav.jump": "Aller à…", "nav.guide": "📘 Guide",
      "nav.inbox": "Boîte de réception", "nav.billing": "Offre et facturation", "nav.account": "Mon compte", "nav.signout": "Déconnexion",
      "nav.workspace": "Espace de travail", "nav.language": "Langue", "eval.history": "Historique des tests", "eval.better": "en mieux", "eval.worse": "en moins bien", "eval.vsLast": "Par rapport au dernier test", "eval.noChange": "aucun changement par rapport au dernier test", "gap.title": "Former cette lacune", "gap.train": "Ajouter à l’entraînement", "gap.draft": "Enregistrer le brouillon", "appearance.disclosure": "Mention d’utilisation de l’IA", "appearance.disclosureNote": "Affichée en bas du chat. Elle reste visible sur le forfait Gratuit ; Pro et Business peuvent vider le champ pour la masquer.", "export.title": "Exporter les connaissances", "export.note": "Téléchargez vos FAQ, réponses enseignées, réponses types et la liste des pages crawlées en JSON ou CSV.", "export.json": "Télécharger le JSON", "export.csv": "Télécharger le CSV", "logs.topic": "Sujet", "logs.allTopics": "Tous les sujets", "logs.topics": "Sujets", "logs.topicsNote": "Étiquettes automatiques d’après les questions des visiteurs. Cliquez pour filtrer les transcriptions.", "analytics.plausible": "Domaine Plausible", "analytics.ga4": "ID de mesure GA4", "analytics.eventsNote": "Le widget envoie des événements à l’ouverture du chat, à l’envoi d’un message, à la capture d’un lead et au transfert à un humain. S’il y a déjà Plausible ou gtag sur la page, ils sont utilisés ; sinon le widget les envoie.",
    },
    de: {
      "tab.setup": "Einrichtung", "tab.train": "Training", "tab.tools": "Suchtools", "tab.persona": "Persona",
      "tab.appearance": "Erscheinung", "tab.model": "Modell", "tab.convert": "Conversion", "tab.transcripts": "Transkripte",
      "tab.analytics": "Analysen", "tab.leads": "Leads", "tab.share": "Teilen", "tab.live": "Live-Chat",
      "tab.support": "Modus & Support", "tab.tickets": "Tickets", "tab.features": "Intelligente Funktionen",
      "nav.sites": "Ihre Sites", "nav.new": "+ Neue Site", "nav.jump": "Gehe zu…", "nav.guide": "📘 Anleitung",
      "nav.inbox": "Live-Posteingang", "nav.billing": "Tarif & Abrechnung", "nav.account": "Mein Konto", "nav.signout": "Abmelden",
      "nav.workspace": "Arbeitsbereich", "nav.language": "Sprache", "eval.history": "Testverlauf", "eval.better": "besser", "eval.worse": "schlechter", "eval.vsLast": "Gegenüber dem letzten Lauf", "eval.noChange": "keine Änderung gegenüber dem letzten Lauf", "gap.title": "Diese Lücke trainieren", "gap.train": "Zum Training hinzufügen", "gap.draft": "Entwurf speichern", "appearance.disclosure": "KI-Hinweiszeile", "appearance.disclosureNote": "Wird unten im Chat angezeigt. Im Free-Tarif bleibt sie sichtbar; Pro und Business können das Feld leeren, um sie auszublenden.", "export.title": "Wissen exportieren", "export.note": "Laden Sie Ihre FAQs, beigebrachten Antworten, fertigen Antworten und die Liste der gecrawlten Seiten als JSON oder CSV herunter.", "export.json": "JSON herunterladen", "export.csv": "CSV herunterladen", "logs.topic": "Thema", "logs.allTopics": "Alle Themen", "logs.topics": "Themen", "logs.topicsNote": "Automatische Tags aus Besucherfragen. Klicken Sie, um Transkripte zu filtern.", "analytics.plausible": "Plausible-Domain", "analytics.ga4": "GA4-Mess-ID", "analytics.eventsNote": "Das Widget sendet Ereignisse für geöffneten Chat, gesendete Nachricht, erfassten Lead und Übergabe. Ist Plausible oder gtag schon auf der Seite, werden sie genutzt; sonst sendet das Widget selbst.",
    },
    pt: {
      "tab.setup": "Configuração", "tab.train": "Treinar", "tab.tools": "Ferramentas de pesquisa", "tab.persona": "Persona",
      "tab.appearance": "Aparência", "tab.model": "Modelo", "tab.convert": "Conversões", "tab.transcripts": "Transcrições",
      "tab.analytics": "Análises", "tab.leads": "Leads", "tab.share": "Partilhar", "tab.live": "Chat ao vivo",
      "tab.support": "Modo e suporte", "tab.tickets": "Tickets", "tab.features": "Funções inteligentes",
      "nav.sites": "Os seus sites", "nav.new": "+ Novo site", "nav.jump": "Ir para…", "nav.guide": "📘 Guia",
      "nav.inbox": "Caixa ao vivo", "nav.billing": "Plano e faturação", "nav.account": "A minha conta", "nav.signout": "Sair",
      "nav.workspace": "Espaço de trabalho", "nav.language": "Idioma", "eval.history": "Histórico de testes", "eval.better": "melhoraram", "eval.worse": "pioraram", "eval.vsLast": "Em relação ao último teste", "eval.noChange": "sem alterações em relação ao último teste", "gap.title": "Treinar esta lacuna", "gap.train": "Adicionar ao treino", "gap.draft": "Guardar rascunho", "appearance.disclosure": "Linha de divulgação de IA", "appearance.disclosureNote": "Aparece no fundo do chat. No plano Grátis não pode ser ocultada; Pro e Business podem limpar o campo para a esconder.", "export.title": "Exportar conhecimento", "export.note": "Descarregue as suas FAQs, respostas ensinadas, respostas prontas e a lista de páginas rastreadas em JSON ou CSV.", "export.json": "Descarregar JSON", "export.csv": "Descarregar CSV", "logs.topic": "Tópico", "logs.allTopics": "Todos os tópicos", "logs.topics": "Tópicos", "logs.topicsNote": "Etiquetas automáticas das perguntas dos visitantes. Clique para filtrar as transcrições.", "analytics.plausible": "Domínio do Plausible", "analytics.ga4": "ID de medição do GA4", "analytics.eventsNote": "O widget envia eventos ao abrir o chat, enviar uma mensagem, captar um lead e transferir para um humano. Se a página já tiver Plausible ou gtag, são usados; senão, o widget envia-os.",
    },
    it: {
      "tab.setup": "Configurazione", "tab.train": "Addestramento", "tab.tools": "Strumenti di ricerca", "tab.persona": "Persona",
      "tab.appearance": "Aspetto", "tab.model": "Modello", "tab.convert": "Conversioni", "tab.transcripts": "Trascrizioni",
      "tab.analytics": "Analisi", "tab.leads": "Lead", "tab.share": "Condividi", "tab.live": "Chat live",
      "tab.support": "Modalità e supporto", "tab.tickets": "Ticket", "tab.features": "Funzioni smart",
      "nav.sites": "I tuoi siti", "nav.new": "+ Nuovo sito", "nav.jump": "Vai a…", "nav.guide": "📘 Guida",
      "nav.inbox": "Inbox live", "nav.billing": "Piano e fatturazione", "nav.account": "Il mio account", "nav.signout": "Esci",
      "nav.workspace": "Workspace", "nav.language": "Lingua", "eval.history": "Cronologia test", "eval.better": "migliorati", "eval.worse": "peggiorati", "eval.vsLast": "Rispetto all’ultimo test", "eval.noChange": "nessun cambiamento rispetto all’ultimo test", "gap.title": "Addestra questa lacuna", "gap.train": "Aggiungi all’addestramento", "gap.draft": "Salva bozza", "appearance.disclosure": "Riga di informativa IA", "appearance.disclosureNote": "Mostrata in fondo alla chat. Nel piano Free non si può nascondere; Pro e Business possono svuotare il campo per nasconderla.", "export.title": "Esporta conoscenza", "export.note": "Scarica le FAQ, le risposte insegnate, le risposte predefinite e l’elenco delle pagine analizzate in JSON o CSV.", "export.json": "Scarica JSON", "export.csv": "Scarica CSV", "logs.topic": "Argomento", "logs.allTopics": "Tutti gli argomenti", "logs.topics": "Argomenti", "logs.topicsNote": "Tag automatici dalle domande dei visitatori. Fai clic per filtrare le trascrizioni.", "analytics.plausible": "Dominio Plausible", "analytics.ga4": "ID di misurazione GA4", "analytics.eventsNote": "Il widget invia eventi all’apertura della chat, all’invio di un messaggio, alla cattura di un lead e al passaggio a un umano. Se la pagina ha già Plausible o gtag, li usa; altrimenti li invia il widget.",
    },
    nl: {
      "tab.setup": "Installatie", "tab.train": "Trainen", "tab.tools": "Zoektools", "tab.persona": "Persona",
      "tab.appearance": "Uiterlijk", "tab.model": "Model", "tab.convert": "Conversie", "tab.transcripts": "Transcripten",
      "tab.analytics": "Analyses", "tab.leads": "Leads", "tab.share": "Delen", "tab.live": "Livechat",
      "tab.support": "Modus en support", "tab.tickets": "Tickets", "tab.features": "Slimme functies",
      "nav.sites": "Jouw sites", "nav.new": "+ Nieuwe site", "nav.jump": "Ga naar…", "nav.guide": "📘 Handleiding",
      "nav.inbox": "Live-inbox", "nav.billing": "Abonnement en factuur", "nav.account": "Mijn account", "nav.signout": "Uitloggen",
      "nav.workspace": "Werkruimte", "nav.language": "Taal", "eval.history": "Testhistorie", "eval.better": "beter", "eval.worse": "slechter", "eval.vsLast": "Ten opzichte van de vorige run", "eval.noChange": "geen verandering ten opzichte van de vorige run", "gap.title": "Dit hiaat trainen", "gap.train": "Toevoegen aan training", "gap.draft": "Concept opslaan", "appearance.disclosure": "AI-vermeldingsregel", "appearance.disclosureNote": "Wordt onderaan de chat getoond. Op het Free-abonnement blijft die zichtbaar; Pro en Business kunnen het veld leegmaken om hem te verbergen.", "export.title": "Kennis exporteren", "export.note": "Download je FAQ’s, aangeleerde antwoorden, standaardantwoorden en de lijst met gecrawlde pagina’s als JSON of CSV.", "export.json": "JSON downloaden", "export.csv": "CSV downloaden", "logs.topic": "Onderwerp", "logs.allTopics": "Alle onderwerpen", "logs.topics": "Onderwerpen", "logs.topicsNote": "Automatische tags uit bezoekersvragen. Klik om transcripten te filteren.", "analytics.plausible": "Plausible-domein", "analytics.ga4": "GA4-metings-ID", "analytics.eventsNote": "De widget stuurt events voor chat open, bericht verzonden, lead vastgelegd en overdracht. Als de pagina al Plausible of gtag heeft, worden die gebruikt; anders stuurt de widget ze zelf.",
    },
    pl: {
      "tab.setup": "Ustawienia", "tab.train": "Szkolenie", "tab.tools": "Narzędzia wyszukiwania", "tab.persona": "Persona",
      "tab.appearance": "Wygląd", "tab.model": "Model", "tab.convert": "Konwersje", "tab.transcripts": "Transkrypty",
      "tab.analytics": "Analityka", "tab.leads": "Leady", "tab.share": "Udostępnij", "tab.live": "Czat na żywo",
      "tab.support": "Tryb i wsparcie", "tab.tickets": "Zgłoszenia", "tab.features": "Inteligentne funkcje",
      "nav.sites": "Twoje witryny", "nav.new": "+ Nowa witryna", "nav.jump": "Przejdź do…", "nav.guide": "📘 Przewodnik",
      "nav.inbox": "Skrzynka na żywo", "nav.billing": "Plan i płatności", "nav.account": "Moje konto", "nav.signout": "Wyloguj",
      "nav.workspace": "Przestrzeń", "nav.language": "Język", "eval.history": "Historia testów", "eval.better": "lepiej", "eval.worse": "gorzej", "eval.vsLast": "W porównaniu z poprzednim testem", "eval.noChange": "bez zmian względem poprzedniego testu", "gap.title": "Wyszkol tę lukę", "gap.train": "Dodaj do szkolenia", "gap.draft": "Zapisz szkic", "appearance.disclosure": "Linia ujawniająca korzystanie z AI", "appearance.disclosureNote": "Wyświetlana na dole czatu. W planie Free nie da się jej ukryć; Pro i Business mogą wyczyścić pole, żeby ją schować.", "export.title": "Eksportuj wiedzę", "export.note": "Pobierz swoje FAQ, nauczone odpowiedzi, gotowe odpowiedzi i listę przecrawlowanych stron jako JSON lub CSV.", "export.json": "Pobierz JSON", "export.csv": "Pobierz CSV", "logs.topic": "Temat", "logs.allTopics": "Wszystkie tematy", "logs.topics": "Tematy", "logs.topicsNote": "Automatyczne tagi z pytań odwiedzających. Kliknij, aby filtrować transkrypty.", "analytics.plausible": "Domena Plausible", "analytics.ga4": "Identyfikator pomiaru GA4", "analytics.eventsNote": "Widżet wysyła zdarzenia przy otwarciu czatu, wysłaniu wiadomości, przechwyceniu leada i przekazaniu do człowieka. Jeśli strona ma już Plausible lub gtag, używa ich; w przeciwnym razie wysyła je sam.",
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
