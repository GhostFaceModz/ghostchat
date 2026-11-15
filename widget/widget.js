/* GhostChat embeddable widget — dependency-free.
 * Host pages can position it with CSS custom properties on #ghostchat-host:
 *   --gc-offset-bottom, --gc-offset-right (default 22px) and --gc-z (default 2147483000). */
(function () {
  "use strict";

  if (window.__GHOSTCHAT_LOADED) return;
  window.__GHOSTCHAT_LOADED = true;

  var script = document.currentScript || (function () {
    var list = document.getElementsByTagName("script");
    return list[list.length - 1];
  })();

  var SITE_KEY = (script && script.getAttribute("data-id")) || "";
  var API_BASE = (function () {
    if (script && script.src) {
      try {
        var u = new URL(script.src, window.location.href);
        return u.origin;
      } catch (e) {}
    }
    return window.location.origin;
  })();

  var DEFAULT_PRIMARY = "#8b5cf6"; // premium violet; ring blends it towards electric cyan with a gold glint
  var LEGACY_PRIMARY = "#a78bfa"; // the old default stored on older sites: treat it as "not customised"
  var attr = function (name, fallback) {
    var v = script && script.getAttribute(name);
    return v == null || v === "" ? fallback : v;
  };

  var state = {
    open: attr("data-open", "") === "true",
    sound: attr("data-sound", "") === "true",
    themeMode: attr("data-theme", "dark"),
    voiceAttr: attr("data-voice", ""),
    primary: attr("data-primary", DEFAULT_PRIMARY),
    greeting: attr("data-greeting", ""),
    delay: parseInt(attr("data-delay", ""), 10),
    name: "GhostChat",
    starters: [],
    showBranding: true,
    sessionId: null,
    sending: false,
    lastLogId: null,
    greeted: false,
    thinking: false,
    voice: false,
    voiceOutput: false,
    bookingUrl: "",
    bookingProvider: "",
    lang: "en",
    multilingual: true,
    memory: false,
    memoryOff: false,
    visitorId: "",
    mode: "assistant",
    quickReplies: [],
    csat: null,
    replies: 0,
    usedVoice: false,
    tab: "assistant",
    supportUnread: 0
  };

  // UI strings for the main languages (the bot itself replies in whatever language the visitor writes).
  var I18N = {
    en: { ph: "Ask a question…", send: "Send message", checking: "Checking the site…", online: "AI assistant · Online", pb: "Powered by", add: "Add to your website →", err: "I couldn't reply just now. Please try again in a moment.", reach: "I couldn't reach the assistant just now. Please try again.", followTitle: "Want a human to follow up?", followSub: "Leave your email and the team will get back to you.", thanks: "Thanks! The team will follow up by email.", ticket: "Ticket created. The team will reply by email.", sendErr: "Could not send just now.", email: "you@email.com", mem: "This chat remembers your preferences on this device.", forget: "Forget me", memOff: "Memory is off for this chat.", memOn: "Turn on", csatQ: "How did we do?", csatThanks: "Thanks for the feedback!", speak: "Ask by voice", listening: "Listening…", micBlocked: "Voice input isn't available here. You can type instead.", readAloud: "Read replies aloud", min: "Minimise chat", greetClose: "Dismiss", tabAi: "Assistant", tabSupport: "Support", endChat: "End chat with agent", connecting: "Connecting you to a support agent…", joined: "{name} joined", openSupport: "Open Support", stayAi: "Stay with Assistant", cancelWait: "Cancel", dismiss: "Dismiss", backAi: "You're back with the AI assistant.", csatComment: "A comment (optional)", csatSend: "Send review", supportPh: "Message the team…", skipReview: "Skip review", closeSupport: "Close support chat", ended: "This support chat has ended." },
    es: { ph: "Haz una pregunta…", send: "Enviar mensaje", checking: "Consultando el sitio…", online: "Asistente IA · En línea", pb: "Con la tecnología de", add: "Añádelo a tu web →", err: "No he podido responder ahora. Inténtalo de nuevo en un momento.", reach: "No he podido conectar con el asistente. Inténtalo de nuevo.", followTitle: "¿Quieres que una persona te responda?", followSub: "Deja tu correo y el equipo se pondrá en contacto.", thanks: "¡Gracias! El equipo te escribirá por correo.", ticket: "Ticket creado. El equipo te responderá por correo.", sendErr: "No se pudo enviar ahora.", email: "tu@correo.com", mem: "Este chat recuerda tus preferencias en este dispositivo.", forget: "Olvidarme", memOff: "La memoria está desactivada.", memOn: "Activar", csatQ: "¿Qué tal te hemos ayudado?", csatThanks: "¡Gracias por tu opinión!", speak: "Preguntar por voz", listening: "Escuchando…", micBlocked: "La voz no está disponible aquí. Puedes escribir.", readAloud: "Leer respuestas en voz alta", min: "Minimizar chat", greetClose: "Cerrar", tabAi: "Asistente", tabSupport: "Soporte", endChat: "Terminar chat con el agente", connecting: "Conectándote con un agente de soporte…", joined: "{name} se unió", openSupport: "Abrir Soporte", stayAi: "Seguir con el Asistente", cancelWait: "Cancelar", dismiss: "Cerrar", backAi: "Has vuelto con el asistente de IA.", csatComment: "Un comentario (opcional)", csatSend: "Enviar reseña", supportPh: "Escribe al equipo…", skipReview: "Omitir reseña", closeSupport: "Cerrar chat de soporte", ended: "Este chat de soporte ha terminado." },
    fr: { ph: "Posez une question…", send: "Envoyer", checking: "Je consulte le site…", online: "Assistant IA · En ligne", pb: "Propulsé par", add: "Ajoutez-le à votre site →", err: "Je n'ai pas pu répondre. Réessayez dans un instant.", reach: "Impossible de joindre l'assistant. Réessayez.", followTitle: "Besoin qu'une personne vous recontacte ?", followSub: "Laissez votre e-mail et l'équipe vous répondra.", thanks: "Merci ! L'équipe vous répondra par e-mail.", ticket: "Ticket créé. L'équipe vous répondra par e-mail.", sendErr: "Envoi impossible pour le moment.", email: "vous@email.com", mem: "Ce chat mémorise vos préférences sur cet appareil.", forget: "M'oublier", memOff: "La mémoire est désactivée.", memOn: "Activer", csatQ: "Comment avons-nous fait ?", csatThanks: "Merci pour votre avis !", speak: "Poser par la voix", listening: "J'écoute…", micBlocked: "La saisie vocale n'est pas disponible ici.", readAloud: "Lire les réponses", min: "Réduire le chat", greetClose: "Fermer", tabAi: "Assistant", tabSupport: "Support", endChat: "Terminer le chat avec l'agent", connecting: "Connexion à un agent du support…", joined: "{name} a rejoint", openSupport: "Ouvrir le Support", stayAi: "Rester avec l'Assistant", cancelWait: "Annuler", dismiss: "Fermer", backAi: "Vous êtes de retour avec l'assistant IA.", csatComment: "Un commentaire (facultatif)", csatSend: "Envoyer l'avis", supportPh: "Écrire à l'équipe…", skipReview: "Passer l'avis", closeSupport: "Fermer le chat support", ended: "Ce chat de support est terminé." },
    de: { ph: "Stell eine Frage…", send: "Senden", checking: "Ich sehe auf der Website nach…", online: "KI-Assistent · Online", pb: "Bereitgestellt von", add: "Auf deiner Website einbauen →", err: "Ich konnte gerade nicht antworten. Bitte versuch es gleich noch einmal.", reach: "Der Assistent ist gerade nicht erreichbar.", followTitle: "Soll sich jemand bei dir melden?", followSub: "Hinterlass deine E-Mail, das Team meldet sich.", thanks: "Danke! Das Team meldet sich per E-Mail.", ticket: "Ticket erstellt. Das Team antwortet per E-Mail.", sendErr: "Senden gerade nicht möglich.", email: "du@email.de", mem: "Dieser Chat merkt sich deine Vorlieben auf diesem Gerät.", forget: "Vergessen", memOff: "Gedächtnis ist aus.", memOn: "Einschalten", csatQ: "Wie war die Hilfe?", csatThanks: "Danke für dein Feedback!", speak: "Per Sprache fragen", listening: "Ich höre zu…", micBlocked: "Spracheingabe ist hier nicht verfügbar.", readAloud: "Antworten vorlesen", min: "Chat minimieren", greetClose: "Schließen", tabAi: "Assistent", tabSupport: "Support", endChat: "Chat mit dem Agenten beenden", connecting: "Du wirst mit einem Support-Agenten verbunden…", joined: "{name} ist beigetreten", openSupport: "Support öffnen", stayAi: "Beim Assistenten bleiben", cancelWait: "Abbrechen", dismiss: "Schließen", backAi: "Du bist wieder beim KI-Assistenten.", csatComment: "Kommentar (optional)", csatSend: "Bewertung senden", supportPh: "Nachricht an das Team…", skipReview: "Bewertung überspringen", closeSupport: "Support-Chat schließen", ended: "Dieser Support-Chat ist beendet." },
    pt: { ph: "Faça uma pergunta…", send: "Enviar", checking: "A consultar o site…", online: "Assistente IA · Online", pb: "Com tecnologia", add: "Adicione ao seu site →", err: "Não consegui responder agora. Tente novamente.", reach: "Não consegui contactar o assistente.", followTitle: "Quer que alguém da equipa responda?", followSub: "Deixe o seu e-mail e a equipa entra em contacto.", thanks: "Obrigado! A equipa responde por e-mail.", ticket: "Pedido criado. A equipa responde por e-mail.", sendErr: "Não foi possível enviar agora.", email: "voce@email.com", mem: "Este chat lembra as suas preferências neste dispositivo.", forget: "Esquecer-me", memOff: "A memória está desligada.", memOn: "Ligar", csatQ: "Como foi a ajuda?", csatThanks: "Obrigado pelo feedback!", speak: "Perguntar por voz", listening: "A ouvir…", micBlocked: "A voz não está disponível aqui.", readAloud: "Ler respostas em voz alta", min: "Minimizar chat", greetClose: "Fechar", tabAi: "Assistente", tabSupport: "Suporte", endChat: "Terminar conversa com o agente", connecting: "A ligá-lo a um agente de suporte…", joined: "{name} entrou", openSupport: "Abrir Suporte", stayAi: "Ficar com o Assistente", cancelWait: "Cancelar", dismiss: "Fechar", backAi: "Está de volta com o assistente de IA.", csatComment: "Um comentário (opcional)", csatSend: "Enviar avaliação", supportPh: "Escrever à equipa…", skipReview: "Saltar avaliação", closeSupport: "Fechar chat de suporte", ended: "Este chat de suporte terminou." },
    it: { ph: "Fai una domanda…", send: "Invia", checking: "Controllo il sito…", online: "Assistente IA · Online", pb: "Realizzato con", add: "Aggiungilo al tuo sito →", err: "Non riesco a rispondere ora. Riprova tra poco.", reach: "Non riesco a contattare l'assistente.", followTitle: "Vuoi che qualcuno ti ricontatti?", followSub: "Lascia la tua email e il team ti risponderà.", thanks: "Grazie! Il team ti scriverà via email.", ticket: "Ticket creato. Il team risponderà via email.", sendErr: "Invio non riuscito.", email: "tu@email.it", mem: "Questa chat ricorda le tue preferenze su questo dispositivo.", forget: "Dimenticami", memOff: "La memoria è disattivata.", memOn: "Attiva", csatQ: "Com'è andata?", csatThanks: "Grazie per il feedback!", speak: "Chiedi a voce", listening: "Ti ascolto…", micBlocked: "L'input vocale non è disponibile qui.", readAloud: "Leggi le risposte", min: "Riduci chat", greetClose: "Chiudi", tabAi: "Assistente", tabSupport: "Supporto", endChat: "Termina chat con l'agente", connecting: "Ti stiamo collegando a un agente di supporto…", joined: "{name} è entrato", openSupport: "Apri Supporto", stayAi: "Resta con l'Assistente", cancelWait: "Annulla", dismiss: "Chiudi", backAi: "Sei di nuovo con l'assistente IA.", csatComment: "Un commento (facoltativo)", csatSend: "Invia recensione", supportPh: "Scrivi al team…", skipReview: "Salta recensione", closeSupport: "Chiudi chat di supporto", ended: "Questa chat di supporto è terminata." },
    nl: { ph: "Stel een vraag…", send: "Versturen", checking: "Ik kijk op de site…", online: "AI-assistent · Online", pb: "Mogelijk gemaakt door", add: "Zet het op je site →", err: "Ik kon nu niet antwoorden. Probeer het zo opnieuw.", reach: "De assistent is nu niet bereikbaar.", followTitle: "Wil je dat iemand contact opneemt?", followSub: "Laat je e-mail achter, het team neemt contact op.", thanks: "Bedankt! Het team mailt je.", ticket: "Ticket aangemaakt. Het team mailt je.", sendErr: "Versturen lukt nu niet.", email: "jij@email.nl", mem: "Deze chat onthoudt je voorkeuren op dit apparaat.", forget: "Vergeet mij", memOff: "Geheugen staat uit.", memOn: "Aanzetten", csatQ: "Hoe hebben we geholpen?", csatThanks: "Bedankt voor je feedback!", speak: "Vraag met je stem", listening: "Ik luister…", micBlocked: "Spraakinvoer is hier niet beschikbaar.", readAloud: "Antwoorden voorlezen", min: "Chat minimaliseren", greetClose: "Sluiten", tabAi: "Assistent", tabSupport: "Support", endChat: "Chat met medewerker beëindigen", connecting: "Je wordt verbonden met een supportmedewerker…", joined: "{name} is toegetreden", openSupport: "Support openen", stayAi: "Bij de Assistent blijven", cancelWait: "Annuleren", dismiss: "Sluiten", backAi: "Je bent terug bij de AI-assistent.", csatComment: "Een opmerking (optioneel)", csatSend: "Beoordeling versturen", supportPh: "Bericht aan het team…", skipReview: "Beoordeling overslaan", closeSupport: "Supportchat sluiten", ended: "Deze supportchat is beëindigd." },
    pl: { ph: "Zadaj pytanie…", send: "Wyślij", checking: "Sprawdzam stronę…", online: "Asystent AI · Online", pb: "Napędzane przez", add: "Dodaj na swoją stronę →", err: "Nie mogę teraz odpowiedzieć. Spróbuj za chwilę.", reach: "Nie mogę połączyć się z asystentem.", followTitle: "Chcesz, żeby ktoś się odezwał?", followSub: "Zostaw e-mail, a zespół się odezwie.", thanks: "Dzięki! Zespół odpisze e-mailem.", ticket: "Zgłoszenie utworzone. Zespół odpisze e-mailem.", sendErr: "Nie udało się wysłać.", email: "ty@email.pl", mem: "Ten czat pamięta twoje preferencje na tym urządzeniu.", forget: "Zapomnij mnie", memOff: "Pamięć jest wyłączona.", memOn: "Włącz", csatQ: "Jak nam poszło?", csatThanks: "Dzięki za opinię!", speak: "Zapytaj głosem", listening: "Słucham…", micBlocked: "Głos nie jest tu dostępny.", readAloud: "Czytaj odpowiedzi", min: "Zminimalizuj czat", greetClose: "Zamknij", tabAi: "Asystent", tabSupport: "Wsparcie", endChat: "Zakończ czat z agentem", connecting: "Łączymy cię z agentem wsparcia…", joined: "{name} dołączył", openSupport: "Otwórz Wsparcie", stayAi: "Zostań z Asystentem", cancelWait: "Anuluj", dismiss: "Zamknij", backAi: "Jesteś z powrotem z asystentem AI.", csatComment: "Komentarz (opcjonalnie)", csatSend: "Wyślij opinię", supportPh: "Napisz do zespołu…", skipReview: "Pomiń opinię", closeSupport: "Zamknij czat wsparcia", ended: "Ten czat wsparcia został zakończony." }
  };
  function pickLang() {
    var langs = [];
    try { langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]); } catch (e) {}
    for (var i = 0; i < langs.length; i++) { var b = String(langs[i] || "").toLowerCase().split("-")[0]; if (I18N[b]) return b; }
    return "en";
  }
  state.lang = pickLang();
  function t(key) { var d = I18N[state.multilingual ? state.lang : "en"] || I18N.en; return d[key] || I18N.en[key] || key; }

  try {
    state.sessionId = localStorage.getItem("gc_session_" + SITE_KEY) || "";
    if (!state.sessionId) {
      state.sessionId = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("gc_session_" + SITE_KEY, state.sessionId);
    }
    // Anonymous visitor id for returning-visitor memory (separate from the chat session). Opt-out is remembered.
    state.visitorId = localStorage.getItem("gc_vid_" + SITE_KEY) || "";
    if (!/^v_[a-z0-9]{8,40}$/.test(state.visitorId)) {
      state.visitorId = "v_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      localStorage.setItem("gc_vid_" + SITE_KEY, state.visitorId);
    }
    state.memoryOff = localStorage.getItem("gc_mem_off_" + SITE_KEY) === "1";
    var soundPref = localStorage.getItem("gc_sound_" + SITE_KEY);
    if (soundPref === "1") state.sound = true;
    if (soundPref === "0") state.sound = false;
  } catch (e) {
    state.sessionId = "s_" + Date.now();
  }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function renderMarkdown(raw) {
    // Internal grounding tags like [#1] are hidden; sources render as chips below the answer.
    var text = String(raw || "").replace(/\s*\[#\d+(?:\s*,\s*#?\d+)*\]/g, "");
    var blocks = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      var i = blocks.length;
      blocks.push('<pre class="gc-code"><code data-lang="' + escapeHtml(lang) + '">' + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>");
      return "\u0000B" + i + "\u0000";
    });
    var html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/^(?:- |\* )(.+)$/gm, "<li>$1</li>");
    html = html.replace(/(?:<li>.*<\/li>\n?)+/g, function (m) { return "<ul>" + m + "</ul>"; });
    html = html.replace(/\n/g, "<br>");
    html = html.replace(/\u0000B(\d+)\u0000/g, function (_, i) { return blocks[Number(i)]; });
    return html;
  }

  var css = [
    ":host, .gc-root { all: initial; }",
    ".gc-root { font-family: 'Instrument Sans', 'Segoe UI', system-ui, sans-serif; color: var(--gc-text); }",
    ".gc-root { --gc-primary: #8b5cf6; --gc-bg: rgba(16,10,28,.78); --gc-text: #f5f3ff; --gc-muted: #c4b5fd; --gc-line: rgba(196,181,253,.18); --gc-user: #2a1848; --gc-bubble: #110818; --gc-panel: rgba(12,8,20,.78); }",
    ".gc-root[data-mode='light'] { --gc-bg: rgba(255,255,255,.86); --gc-text: #1e1133; --gc-muted: #6b528c; --gc-line: rgba(88,40,140,.14); --gc-user: #efe7ff; --gc-bubble: #f7f2ff; --gc-panel: rgba(255,255,255,.8); }",
    ".gc-root { --gc-size: 52px; --gc-ease: cubic-bezier(.2,.8,.2,1); --gc-spring: cubic-bezier(.34,1.4,.5,1); }",
    "@media (max-width: 600px) { .gc-root { --gc-size: 48px; } }",
    ".gc-root svg { display: block; }",
    ".gc-root button:focus-visible, .gc-root a:focus-visible, .gc-root textarea:focus-visible, .gc-root input:focus-visible { outline: 2px solid var(--gc-primary); outline-offset: 2px; }",
    ".gc-root { --gc-cyan: #22d3ee; --gc-gold: #fbbf24; --gc-ring-a: var(--gc-primary); --gc-ring-b: color-mix(in srgb, var(--gc-primary) 30%, var(--gc-cyan)); --gc-core: #0d0820; }",
    ".gc-launcher { position: fixed; right: var(--gc-offset-right, 22px); bottom: var(--gc-offset-bottom, 22px); z-index: var(--gc-z, 2147483000); width: var(--gc-size); height: var(--gc-size); padding: 0; border: 0; border-radius: 50%; cursor: pointer; color: #fff; background: transparent; display: grid; place-items: center; -webkit-tap-highlight-color: transparent; isolation: isolate; box-shadow: 0 10px 26px -8px color-mix(in srgb, var(--gc-ring-a) 70%, transparent), 0 3px 8px rgba(6,3,16,.45); transform: translateZ(0); will-change: transform; transition: transform .3s var(--gc-spring); }",
    ".gc-ring { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; pointer-events: none; }",
    ".gc-ring::before { content: ''; position: absolute; inset: -30%; background: conic-gradient(from 0deg, var(--gc-ring-a), var(--gc-ring-b) 28%, var(--gc-gold) 36%, var(--gc-ring-b) 44%, var(--gc-ring-a) 62%, color-mix(in srgb, var(--gc-ring-a) 55%, #fff) 80%, var(--gc-ring-a)); will-change: transform; transform: translateZ(0); animation: gc-spin 14s linear infinite; }",
    ".gc-core { position: absolute; inset: 2.5px; border-radius: 50%; overflow: hidden; background: radial-gradient(90% 90% at 35% 25%, color-mix(in srgb, var(--gc-ring-a) 38%, var(--gc-core)) 0%, var(--gc-core) 70%); box-shadow: inset 0 1px 0 rgba(255,255,255,.18), inset 0 -6px 12px rgba(0,0,0,.45); }",
    ".gc-core::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(160deg, rgba(255,255,255,.22), rgba(255,255,255,0) 45%); pointer-events: none; }",
    ".gc-launcher::after { content: ''; position: absolute; inset: -9px; border-radius: 50%; z-index: -1; background: radial-gradient(closest-side, color-mix(in srgb, var(--gc-ring-b) 50%, transparent), color-mix(in srgb, var(--gc-ring-a) 22%, transparent) 62%, transparent); opacity: .5; will-change: opacity; animation: gc-glow 6s ease-in-out infinite; transition: opacity .3s var(--gc-ease); pointer-events: none; }",
    ".gc-launcher:hover { transform: translate3d(0,-3px,0) scale(1.06); }",
    ".gc-launcher:hover::after { animation: none; opacity: 1; }",
    ".gc-launcher:active { transform: scale(.92); transition-duration: .12s; }",
    ".gc-launcher .gc-li { position: absolute; inset: 0; display: grid; place-items: center; will-change: transform, opacity; transition: transform .42s var(--gc-spring), opacity .24s var(--gc-ease); }",
    ".gc-launcher .gc-li img { width: 74%; height: 74%; object-fit: contain; user-select: none; -webkit-user-drag: none; }",
    ".gc-launcher .gc-li svg { width: 50%; height: 50%; }",
    ".gc-launcher .gc-li-ghost svg { display: none; }",
    ".gc-launcher[data-img='off'] .gc-li-ghost svg { display: block; } .gc-launcher[data-img='off'] .gc-li-ghost img { display: none; }",
    ".gc-launcher .gc-li-close svg { width: 38%; height: 38%; }",
    ".gc-li-close { opacity: 0; transform: rotate(-135deg) scale(.4); }",
    ".gc-root[data-open='true'] .gc-li-ghost { opacity: 0; transform: rotate(135deg) scale(.4); }",
    ".gc-root[data-open='true'] .gc-li-close { opacity: 1; transform: none; }",
    ".gc-root[data-open='true'] .gc-launcher::after { animation: none; opacity: .3; }",
    ".gc-root[data-open='true'] .gc-ring::before { animation-play-state: paused; }",
    ".gc-launcher.gc-hello .gc-li-ghost { animation: gc-hello .9s var(--gc-ease) 1; }",
    ".gc-dot { position: absolute; top: 0; right: 0; width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ff8fa3, #f43f5e 60%); box-shadow: 0 0 0 2px var(--gc-core), 0 2px 6px rgba(244,63,94,.6); transform: scale(0); transition: transform .3s var(--gc-spring); pointer-events: none; z-index: 2; }",
    ".gc-dot::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: #f43f5e; opacity: 0; will-change: transform, opacity; }",
    ".gc-root[data-unread='true'] .gc-dot { transform: scale(1); }",
    ".gc-root[data-unread='true'] .gc-dot::after { animation: gc-ping 2.4s cubic-bezier(0,0,.2,1) infinite; }",
    ".gc-root[data-open='true'] .gc-dot { transform: scale(0); }",
    "@keyframes gc-spin { to { transform: rotate(360deg); } }",
    "@keyframes gc-glow { 0%,100% { opacity: .38; } 50% { opacity: .7; } }",
    "@keyframes gc-hello { 0% { transform: rotate(0) scale(1); } 15% { transform: rotate(-14deg) scale(1.08); } 30% { transform: rotate(11deg) scale(1.04); } 45% { transform: rotate(-8deg); } 60% { transform: rotate(5deg); } 75% { transform: rotate(-2deg); } 100% { transform: rotate(0) scale(1); } }",
    "@keyframes gc-ping { 0% { transform: scale(1); opacity: .7; } 80%,100% { transform: scale(2.4); opacity: 0; } }",
    "@keyframes gc-breathe { 0%,100% { transform: scale(.92); opacity: .35; } 50% { transform: scale(1.08); opacity: .7; } }",
    "@keyframes gc-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.5px); } }",
    "@keyframes gc-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }",
    ".gc-panel { position: fixed; right: max(12px, var(--gc-offset-right, 22px)); bottom: calc(var(--gc-offset-bottom, 22px) + var(--gc-size) + 14px); z-index: var(--gc-z, 2147483000); width: min(400px, calc(100vw - 24px)); height: min(640px, calc(100vh - var(--gc-offset-bottom, 22px) - var(--gc-size) - 40px)); height: min(640px, calc(100dvh - var(--gc-offset-bottom, 22px) - var(--gc-size) - 40px)); display: flex; flex-direction: column; border-radius: 24px; overflow: hidden; background: var(--gc-panel); border: 1px solid var(--gc-line); box-shadow: 0 28px 70px -12px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.03) inset; backdrop-filter: blur(22px) saturate(1.3); -webkit-backdrop-filter: blur(22px) saturate(1.3); opacity: 0; pointer-events: none; visibility: hidden; transform-origin: calc(100% - var(--gc-size) / 2) calc(100% + 14px); transform: translateY(10px) scale(.94); transition: opacity .24s var(--gc-ease), transform .34s var(--gc-spring), visibility 0s linear .34s; overscroll-behavior: contain; touch-action: manipulation; }",
    ".gc-root[data-open='true'] .gc-panel { opacity: 1; pointer-events: auto; visibility: visible; transform: none; transition: opacity .24s var(--gc-ease), transform .34s var(--gc-spring), visibility 0s; }",
    ".gc-head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; border-bottom: 1px solid var(--gc-line); background: linear-gradient(180deg, color-mix(in srgb, var(--gc-primary) 10%, transparent), transparent); }",
    ".gc-avatar { position: relative; flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: radial-gradient(120% 120% at 30% 15%, color-mix(in srgb, var(--gc-primary) 90%, #fff), var(--gc-primary) 40%, var(--gc-accent, #7c3aed)); box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 4px 12px -4px color-mix(in srgb, var(--gc-accent, #7c3aed) 60%, transparent); }",
    ".gc-avatar svg { width: 18px; height: 18px; }",
    ".gc-avatar { background: radial-gradient(90% 90% at 35% 25%, color-mix(in srgb, var(--gc-ring-a) 38%, var(--gc-core)), var(--gc-core) 70%) padding-box, conic-gradient(from 210deg, var(--gc-ring-a), var(--gc-ring-b), var(--gc-gold), var(--gc-ring-b), var(--gc-ring-a)) border-box; border: 2px solid transparent; }",
    ".gc-avatar img { width: 78%; height: 78%; object-fit: contain; filter: drop-shadow(0 1px 2px rgba(10,4,30,.5)); }",
    ".gc-avatar::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 2px var(--gc-bubble); }",
    ".gc-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }",
    ".gc-head h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -.02em; color: var(--gc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".gc-sub { font-size: 11.5px; color: var(--gc-muted); opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".gc-iconbtn { flex: none; width: 32px; height: 32px; padding: 0; border: 0; background: transparent; color: var(--gc-muted); cursor: pointer; border-radius: 10px; display: grid; place-items: center; transition: background .18s, color .18s, transform .18s var(--gc-spring); }",
    ".gc-iconbtn svg { width: 18px; height: 18px; }",
    ".gc-iconbtn:hover { background: var(--gc-line); color: var(--gc-text); }",
    ".gc-iconbtn:active { transform: scale(.9); }",
    ".gc-iconbtn[aria-pressed='true'] { color: var(--gc-primary); }",
    ".gc-row { animation: gc-in .28s var(--gc-ease) both; }",
    ".gc-msgs { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; }",
    ".gc-row { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; max-width: 92%; }",
    ".gc-row.user { align-self: flex-end; align-items: flex-end; }",
    ".gc-bubble { padding: 10px 12px; border-radius: 16px; background: var(--gc-bubble); border: 1px solid var(--gc-line); line-height: 1.5; font-size: 14px; color: var(--gc-text); word-wrap: break-word; }",
    ".gc-row.user .gc-bubble { background: var(--gc-user); }",
    ".gc-row.agent .gc-bubble { border-color: color-mix(in srgb, #34d399 45%, var(--gc-line)); box-shadow: inset 3px 0 0 #34d399; }",
    ".gc-agent-name { font-size: 11px; font-weight: 700; color: #34d399; display: inline-flex; align-items: center; gap: 5px; padding-left: 2px; }",
    ".gc-agent-name svg { width: 12px; height: 12px; }",
    ".gc-row.system { align-self: center; align-items: center; max-width: 100%; }",
    ".gc-row.system .gc-bubble { background: transparent; border: 1px dashed var(--gc-line); color: var(--gc-muted); font-size: 12px; padding: 6px 12px; border-radius: 999px; text-align: center; }",
    ".gc-root[data-live='true'] .gc-avatar { background: radial-gradient(120% 120% at 30% 15%, #6ee7b7, #10b981 45%, #047857); }",
    ".gc-root[data-live='true'] .gc-sub { color: #34d399; opacity: 1; }",
    ".gc-root[data-live='waiting'] .gc-avatar::after { background: #fbbf24; animation: gc-breathe 1.6s ease-in-out infinite; }",
    ".gc-bubble a { color: var(--gc-primary); }",
    ".gc-bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: rgba(0,0,0,.25); padding: 1px 5px; border-radius: 6px; }",
    ".gc-code { margin: 8px 0 0; padding: 10px; overflow: auto; border-radius: 12px; background: #0b0612; color: #f5f3ff; font-size: 12px; }",
    ".gc-root[data-mode='light'] .gc-code { background: #1e1133; }",
    ".gc-row.has-results { max-width: 100%; width: 100%; }",
    ".gc-recs { position: relative; width: 100%; }",
    ".gc-rail { display: flex; gap: 10px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; scroll-padding: 0 2px; padding: 2px 2px 6px; -webkit-overflow-scrolling: touch; scrollbar-width: none; outline: none; }",
    ".gc-rail::-webkit-scrollbar { display: none; }",
    ".gc-rail:focus-visible { box-shadow: 0 0 0 2px var(--gc-primary); border-radius: 14px; }",
    ".gc-rc { flex: none; width: 142px; scroll-snap-align: start; display: flex; flex-direction: column; border: 1px solid var(--gc-line); border-radius: 14px; overflow: hidden; background: var(--gc-bubble); contain: layout paint; }",
    ".gc-rc-img { position: relative; aspect-ratio: 2 / 3; background: linear-gradient(135deg, color-mix(in srgb, var(--gc-primary) 22%, transparent), transparent); overflow: hidden; }",
    ".gc-rc-img img { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity .35s var(--gc-ease); }",
    ".gc-rc-img img.ok { opacity: 1; }",
    ".gc-rc-img .gc-rc-ph { position: absolute; inset: 0; display: grid; place-items: center; padding: 10px; text-align: center; font-size: 12px; font-weight: 650; color: var(--gc-muted); }",
    ".gc-rc-rate { position: absolute; z-index: 2; top: 6px; left: 6px; padding: 2px 6px; border-radius: 999px; background: rgba(8,4,16,.72); color: #fde68a; font-size: 11px; font-weight: 700; }",
    ".gc-rc-b { display: flex; flex-direction: column; gap: 3px; padding: 8px 9px 9px; flex: 1; }",
    ".gc-rc-t { font-size: 13px; font-weight: 650; color: var(--gc-text); line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
    ".gc-rc-m { font-size: 11px; color: var(--gc-muted); }",
    ".gc-rc-w { font-size: 11.5px; color: var(--gc-muted); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; flex: 1; }",
    ".gc-rc-cta { margin-top: 6px; display: block; text-align: center; border-radius: 9px; padding: 6px 6px; background: var(--gc-primary); color: #160b27; font-size: 11.5px; font-weight: 700; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: transform .18s var(--gc-spring), opacity .18s; }",
    ".gc-rc-cta:hover { opacity: .92; } .gc-rc-cta:active { transform: scale(.96); }",
    ".gc-rc-cta:focus-visible { outline: 2px solid var(--gc-text); outline-offset: 2px; }",
    ".gc-rnav { position: absolute; top: 34%; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--gc-line); background: var(--gc-bubble); color: var(--gc-text); display: grid; place-items: center; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity .18s; }",
    ".gc-rnav svg { width: 14px; height: 14px; }",
    ".gc-rnav.prev { left: -4px; } .gc-rnav.next { right: -4px; }",
    "@media (hover: hover) { .gc-recs:hover .gc-rnav.on, .gc-rnav.on:focus-visible { opacity: 1; pointer-events: auto; } }",
    ".gc-sources, .gc-suggest, .gc-actions { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".gc-chip, .gc-src { border: 1px solid var(--gc-line); background: transparent; color: var(--gc-muted); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 12px; line-height: 1.35; cursor: pointer; text-decoration: none; transition: border-color .18s, color .18s, background .18s; }",
    ".gc-sources { width: 100%; }",
    ".gc-src { display: inline-flex; align-items: center; gap: 5px; max-width: min(100%, 260px); box-sizing: border-box; min-width: 0; }",
    ".gc-src svg { width: 12px; height: 12px; flex: none; opacity: .8; }",
    ".gc-src span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".gc-chip:hover, .gc-src:hover { border-color: var(--gc-primary); color: var(--gc-text); }",
    ".gc-lead { width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--gc-line); border-radius: 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--gc-primary) 10%, var(--gc-bubble)), var(--gc-bubble)); font-size: 13px; color: var(--gc-text); }",
    ".gc-lead-t { display: flex; align-items: center; gap: 8px; font-weight: 650; }",
    ".gc-lead-t svg { width: 16px; height: 16px; color: var(--gc-primary); flex: none; }",
    ".gc-lead-t small { display: block; font-weight: 400; color: var(--gc-muted); font-size: 12px; margin-top: 1px; }",
    ".gc-lead-r { display: flex; gap: 6px; }",
    ".gc-lead input { flex: 1; min-width: 0; border: 1px solid var(--gc-line); background: rgba(0,0,0,.12); color: var(--gc-text); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; }",
    ".gc-lead button { flex: none; border: 0; border-radius: 10px; padding: 8px 12px; background: linear-gradient(135deg, var(--gc-primary), var(--gc-accent, #7c3aed)); color: #fff; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }",
    ".gc-lead-done { color: var(--gc-muted); }",
    ".gc-composer { display: flex; align-items: flex-end; gap: 6px; margin: 10px 12px 10px; padding: 5px 5px 5px 4px; border: 1px solid var(--gc-line); border-radius: 18px; background: rgba(0,0,0,.14); transition: border-color .18s, box-shadow .18s; }",
    ".gc-root[data-mode='light'] .gc-composer { background: rgba(255,255,255,.6); }",
    ".gc-composer:focus-within { border-color: color-mix(in srgb, var(--gc-primary) 60%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gc-primary) 18%, transparent); }",
    ".gc-composer textarea { flex: 1; resize: none; min-height: 36px; max-height: 120px; box-sizing: border-box; border: 0; outline: none; background: transparent; color: var(--gc-text); padding: 8px 8px; font: inherit; font-size: 14px; line-height: 1.4; }",
    ".gc-composer textarea:focus-visible { outline: none; }",
    ".gc-composer .gc-iconbtn { width: 36px; height: 36px; }",
    ".gc-send { flex: none; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center; color: #fff; cursor: pointer; background: linear-gradient(135deg, var(--gc-primary), var(--gc-accent, #7c3aed)); box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--gc-accent, #7c3aed) 70%, transparent), inset 0 1px 0 rgba(255,255,255,.3); transition: transform .2s var(--gc-spring), opacity .2s, filter .2s; }",
    ".gc-send svg { width: 17px; height: 17px; transform: translateX(-1px); }",
    ".gc-send:hover { transform: translateY(-1px) scale(1.05); }",
    ".gc-send:active { transform: scale(.9); }",
    ".gc-send:disabled { opacity: .45; cursor: default; transform: none; filter: saturate(.6); }",
    ".gc-notice { align-self: center; font-size: 12px; color: var(--gc-muted); padding: 6px 12px; border: 1px solid var(--gc-line); border-radius: 999px; background: var(--gc-bubble); }",
    ".gc-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 14px 11px; font-size: 11px; line-height: 1; letter-spacing: .01em; }",
    ".gc-brand a { color: var(--gc-muted); text-decoration: none; opacity: .72; display: inline-flex; align-items: center; gap: 5px; transition: opacity .18s, color .18s; white-space: nowrap; }",
    ".gc-brand a:hover, .gc-brand a:focus-visible { opacity: 1; color: var(--gc-text); outline: none; }",
    ".gc-brand b { font-weight: 700; color: var(--gc-text); }",
    ".gc-brand svg { width: 12px; height: 12px; }",
    ".gc-brand .gc-add { opacity: .9; padding: 5px 9px; border-radius: 999px; border: 1px solid var(--gc-line); background: linear-gradient(135deg, color-mix(in srgb, var(--gc-primary) 14%, transparent), transparent); }",
    ".gc-brand .gc-add:hover { border-color: var(--gc-primary); }",
    ".gc-typing { display: flex; gap: 4px; padding: 8px 4px; }",
    ".gc-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--gc-muted); animation: gc-dots 1s infinite; }",
    ".gc-typing i:nth-child(2) { animation-delay: .15s; }",
    ".gc-typing i:nth-child(3) { animation-delay: .3s; }",
    "@keyframes gc-dots { 0%,80%,100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }",
    ".gc-fb { display: flex; gap: 0; margin: -2px 0 0 0; }",
    ".gc-fb button { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 8px; background: transparent; cursor: pointer; color: var(--gc-muted); opacity: .7; display: grid; place-items: center; transition: opacity .18s, background .18s, color .18s, transform .18s var(--gc-spring); }",
    ".gc-fb button svg { width: 13px; height: 13px; }",
    ".gc-fb button:hover { opacity: 1; background: var(--gc-line); }",
    ".gc-fb button:active { transform: scale(.88); }",
    ".gc-fb button.on { color: var(--gc-primary); opacity: 1; }",
    ".gc-cards { display: flex; flex-direction: column; gap: 8px; width: 100%; }",
    ".gc-card { width: 100%; border: 1px solid var(--gc-line); border-radius: 16px; padding: 10px; background: var(--gc-bubble); display: flex; gap: 10px; align-items: flex-start; }",
    ".gc-card img { width: 56px; height: 56px; object-fit: cover; border-radius: 10px; }",
    ".gc-card h4 { margin: 0 0 2px; font-size: 13px; }",
    ".gc-card p { margin: 0 0 8px; font-size: 12px; color: var(--gc-muted); }",
    ".gc-card .gc-cta, .gc-copy { border: 0; border-radius: 10px; padding: 6px 10px; background: var(--gc-primary); color: #160b27; font-weight: 700; cursor: pointer; font-size: 12px; text-decoration: none; display: inline-block; }",
    ".gc-codechip { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; padding: 4px 8px; border: 1px dashed var(--gc-line); border-radius: 8px; margin-right: 6px; }",
    ".gc-modal { position: fixed; inset: 0; z-index: calc(var(--gc-z, 2147483000) + 1); background: rgba(5,2,12,.72); display: none; place-items: center; padding: 16px; }",
    ".gc-modal.on { display: grid; }",
    ".gc-modal-box { width: min(440px, 100%); height: min(640px, 90vh); background: var(--gc-panel); border: 1px solid var(--gc-line); border-radius: 20px; overflow: hidden; display: flex; flex-direction: column; }",
    ".gc-modal-box header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--gc-line); color: var(--gc-text); font-weight: 700; }",
    ".gc-modal-box iframe { flex: 1; width: 100%; border: 0; background: #fff; }",
    ".gc-status { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--gc-muted); }",
    ".gc-status .gc-typing { padding: 4px 0; }",
    ".gc-lead-f { display: grid; gap: 6px; }",
    ".gc-lead-f input, .gc-lead-f textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--gc-line); background: rgba(0,0,0,.12); color: var(--gc-text); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; resize: vertical; }",
    ".gc-lead-f textarea { min-height: 62px; }",
    ".gc-lead-f label { display: grid; gap: 3px; font-size: 11.5px; color: var(--gc-muted); }",
    ".gc-lead-f button { justify-self: start; }",
    ".gc-lead-err { color: #fca5a5; font-size: 12px; }",
    ".gc-csat { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--gc-line); border-radius: 16px; background: var(--gc-bubble); font-size: 13px; }",
    ".gc-csat-r { display: flex; gap: 4px; }",
    ".gc-csat-r button { min-width: 34px; height: 34px; border: 1px solid var(--gc-line); border-radius: 10px; background: transparent; color: var(--gc-text); font-size: 16px; cursor: pointer; transition: transform .18s var(--gc-spring), border-color .18s, background .18s; }",
    ".gc-csat-r button:hover, .gc-csat-r button:focus-visible { border-color: var(--gc-primary); background: color-mix(in srgb, var(--gc-primary) 16%, transparent); transform: translateY(-1px); outline: none; }",
    ".gc-mem { padding: 0 14px 8px; font-size: 10.5px; color: var(--gc-muted); opacity: .75; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }",
    ".gc-mem button { border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }",
    ".gc-iconbtn.gc-listening { color: var(--gc-primary); animation: gc-pulse 1.1s ease-in-out infinite; }",
    "@keyframes gc-pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--gc-primary) 45%, transparent); } 50% { box-shadow: 0 0 0 6px transparent; } }",
    ".gc-teaser { position: fixed; right: var(--gc-offset-right, 22px); bottom: calc(var(--gc-offset-bottom, 22px) + var(--gc-size) + 12px); z-index: var(--gc-z, 2147483000); max-width: min(270px, calc(100vw - 40px)); display: flex; align-items: flex-start; gap: 6px; padding: 11px 12px 11px 14px; border-radius: 16px 16px 4px 16px; border: 1px solid var(--gc-line); background: var(--gc-panel); color: var(--gc-text); font: 500 13.5px/1.4 'Instrument Sans', 'Segoe UI', system-ui, sans-serif; box-shadow: 0 16px 40px -14px rgba(0,0,0,.6); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); cursor: pointer; opacity: 0; transform: translateY(8px) scale(.97); transition: opacity .25s var(--gc-ease), transform .3s var(--gc-spring); }",
    ".gc-teaser.on { opacity: 1; transform: none; }",
    ".gc-teaser button { flex: none; width: 22px; height: 22px; margin: -3px -4px 0 0; border: 0; border-radius: 8px; background: transparent; color: var(--gc-muted); cursor: pointer; display: grid; place-items: center; padding: 0; }",
    ".gc-teaser button svg { width: 13px; height: 13px; }",
    ".gc-root[data-open='true'] .gc-teaser { display: none; }",

    ".gc-tabs { display: none; align-items: stretch; gap: 4px; padding: 0 10px; border-bottom: 1px solid var(--gc-line); background: color-mix(in srgb, var(--gc-primary) 5%, transparent); }",
    ".gc-root[data-support='true'] .gc-tabs { display: flex; }",
    ".gc-tab { position: relative; flex: 1; height: 36px; border: 0; border-radius: 12px 12px 0 0; background: transparent; color: var(--gc-muted); font: 650 12.5px/1 'Instrument Sans', 'Segoe UI', system-ui, sans-serif; letter-spacing: -.01em; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: color .18s, background .18s; }",
    ".gc-tab:hover { color: var(--gc-text); background: color-mix(in srgb, var(--gc-primary) 8%, transparent); }",
    ".gc-tab.on { color: var(--gc-text); background: color-mix(in srgb, var(--gc-primary) 14%, transparent); box-shadow: inset 0 -2px 0 var(--gc-primary); }",
    ".gc-tab:focus-visible { outline: 2px solid var(--gc-primary); outline-offset: -2px; }",
    ".gc-tab-badge { min-width: 16px; height: 16px; padding: 0 5px; border-radius: 999px; background: #f43f5e; color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; display: none; }",
    ".gc-tab-badge.on { display: inline-block; }",
    ".gc-threads { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }",
    ".gc-threads .gc-msgs { flex: 1; min-height: 0; }",
    ".gc-threads .gc-msgs.is-off { display: none; }",
    ".gc-endbar { display: none; flex: none; flex-shrink: 0; align-items: center; justify-content: center; padding: 8px 12px 0; }",
    ".gc-root[data-tab='support'][data-live='true'] .gc-endbar, .gc-root[data-tab='support'][data-live='waiting'] .gc-endbar { display: flex; }",
    ".gc-tab-end { display: none; flex: none; margin: 4px 0 4px 4px; appearance: none; border: 1px solid color-mix(in srgb, #f43f5e 45%, var(--gc-line)); background: color-mix(in srgb, #f43f5e 10%, transparent); color: #fda4af; font: 650 11px/1 'Instrument Sans', 'Segoe UI', system-ui, sans-serif; padding: 0 10px; height: 28px; border-radius: 999px; cursor: pointer; }",
    ".gc-root[data-tab='support'][data-live='true'] .gc-tab-end, .gc-root[data-tab='support'][data-live='waiting'] .gc-tab-end { display: inline-flex; align-items: center; }",
    ".gc-tab-close { display: none; flex: none; width: 28px; height: 28px; margin: 4px 4px 4px 0; border: 0; border-radius: 8px; background: transparent; color: var(--gc-muted); cursor: pointer; place-items: center; padding: 0; }",
    ".gc-root[data-support='true'][data-live='false'] .gc-tab-close { display: grid; }",
    ".gc-tab-close:hover, .gc-tab-close:focus-visible { color: var(--gc-text); background: var(--gc-line); outline: none; }",
    ".gc-tab-close svg { width: 14px; height: 14px; }",
    "@media (max-width: 480px), (max-height: 640px) { .gc-endbar { padding: 8px 12px 2px; } .gc-end { font-size: 12px; padding: 8px 12px; } .gc-composer { flex-shrink: 0; } }",
    ".gc-end { appearance: none; border: 1px solid color-mix(in srgb, #f43f5e 45%, var(--gc-line)); background: color-mix(in srgb, #f43f5e 10%, transparent); color: #fda4af; font: 650 12.5px/1 'Instrument Sans', 'Segoe UI', system-ui, sans-serif; padding: 8px 14px; border-radius: 999px; cursor: pointer; transition: transform .18s var(--gc-spring), background .18s, border-color .18s; }",
    ".gc-end:hover, .gc-end:focus-visible { background: color-mix(in srgb, #f43f5e 18%, transparent); border-color: #f43f5e; transform: translateY(-1px); outline: none; }",
    ".gc-connect { position: absolute; left: 10px; right: 10px; top: 8px; z-index: 5; display: none; padding: 12px 14px 12px; border-radius: 16px; border: 1px solid var(--gc-line); background: color-mix(in srgb, var(--gc-panel) 94%, transparent); color: var(--gc-text); box-shadow: 0 16px 36px -16px rgba(0,0,0,.65); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); animation: gc-in .28s var(--gc-ease) both; }",
    ".gc-connect.on { display: block; }",
    ".gc-connect-top { display: flex; align-items: flex-start; gap: 10px; }",
    ".gc-connect-copy { flex: 1; min-width: 0; }",
    ".gc-connect-copy strong { display: block; font-size: 13.5px; font-weight: 700; letter-spacing: -.02em; }",
    ".gc-connect-copy span { display: block; margin-top: 2px; font-size: 12px; color: var(--gc-muted); }",
    ".gc-connect-x { flex: none; width: 28px; height: 28px; margin: -4px -6px 0 0; border: 0; border-radius: 8px; background: transparent; color: var(--gc-muted); cursor: pointer; display: grid; place-items: center; padding: 0; }",
    ".gc-connect-x svg { width: 14px; height: 14px; }",
    ".gc-connect-x:hover { background: var(--gc-line); color: var(--gc-text); }",
    ".gc-wait { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(120% 120% at 30% 15%, #c4b5fd, var(--gc-primary) 55%, #5b21b6); color: #fff; box-shadow: 0 0 0 4px color-mix(in srgb, var(--gc-primary) 22%, transparent); }",
    ".gc-wait svg { width: 18px; height: 18px; }",
    ".gc-root:not([data-reduce]) .gc-connect[data-state='waiting'] .gc-wait { animation: gc-breathe 1.6s ease-in-out infinite; }",
    ".gc-connect[data-state='joined'] .gc-wait { background: radial-gradient(120% 120% at 30% 15%, #6ee7b7, #10b981 45%, #047857); box-shadow: 0 0 0 4px color-mix(in srgb, #10b981 28%, transparent); }",
    ".gc-connect-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }",
    ".gc-connect-actions button { appearance: none; border: 1px solid var(--gc-line); background: transparent; color: var(--gc-text); font: 650 12px/1 'Instrument Sans', 'Segoe UI', system-ui, sans-serif; padding: 8px 10px; border-radius: 10px; cursor: pointer; transition: background .18s, border-color .18s, transform .18s var(--gc-spring); }",
    ".gc-connect-actions button.primary { background: var(--gc-primary); border-color: transparent; color: #fff; }",
    ".gc-connect-actions button:hover, .gc-connect-actions button:focus-visible { border-color: var(--gc-primary); transform: translateY(-1px); outline: none; }",
    ".gc-connect-actions button.ghost { color: var(--gc-muted); }",
    ".gc-csat textarea { width: 100%; min-height: 56px; margin-top: 4px; resize: vertical; border: 1px solid var(--gc-line); border-radius: 12px; background: transparent; color: var(--gc-text); font: inherit; font-size: 13px; padding: 8px 10px; }",
    ".gc-csat textarea:focus { outline: 2px solid var(--gc-primary); outline-offset: 1px; }",
    ".gc-csat-send { margin-top: 6px; appearance: none; border: 0; border-radius: 10px; background: var(--gc-primary); color: #fff; font: 650 12.5px/1 'Instrument Sans', 'Segoe UI', system-ui, sans-serif; padding: 8px 12px; cursor: pointer; }",
    "@media (max-width: 480px), (max-height: 640px) { .gc-connect { top: 6px; padding: 10px 10px 10px; } .gc-connect-copy strong { font-size: 13px; } .gc-connect-actions button { flex: 1 1 auto; } }",
    "@media (prefers-reduced-motion: reduce) { .gc-root *, .gc-root *::before, .gc-root *::after { animation: none !important; transition-duration: .01ms !important; } .gc-launcher::after { opacity: .45; } }"
  ].join("\n");

  var host = el("div", { class: "gc-host", id: "ghostchat-host" });
  // Own top-level stacking context at the maximum z-index so site overlays can't cover the chat.
  host.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;z-index:var(--gc-z, 2147483646);";
  var shadow = host.attachShadow({ mode: "open" });
  // Load the widget font only when the panel first opens, so the host page's load isn't slowed.
  var fontLoaded = false;
  function loadFont() {
    if (fontLoaded) return;
    fontLoaded = true;
    document.head.appendChild(el("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" }));
  }

  // One icon set: 24px grid, 1.75 stroke, round caps and joins. currentColor everywhere so brand colours apply.
  function icon(body, fill) {
    return '<svg viewBox="0 0 24 24" width="24" height="24" fill="' + (fill ? "currentColor" : "none") + '" stroke="' + (fill ? "none" : "currentColor") + '" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + "</svg>";
  }
  // The GhostChat mark: a soft ghost with a scalloped hem and cut-out eyes (evenodd).
  var GHOST_PATH = "M12 2.6c-4.3 0-7.4 3.2-7.4 7.5v9.6c0 .9 1 1.4 1.7.8l1.5-1.2 1.6 1.4c.5.4 1.2.4 1.7 0L12 19.3l1.9 1.4c.5.4 1.2.4 1.7 0l1.6-1.4 1.5 1.2c.7.6 1.7.1 1.7-.8v-9.6c0-4.3-3.1-7.5-7.4-7.5ZM9.3 9.4a1.35 1.6 0 1 0 0 3.2 1.35 1.6 0 0 0 0-3.2Zm5.4 0a1.35 1.6 0 1 0 0 3.2 1.35 1.6 0 0 0 0-3.2Z";
  var ICONS = {
    prev: icon('<path d="M15 5l-7 7 7 7"/>'),
    next: icon('<path d="M9 5l7 7-7 7"/>'),
    ghost: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="' + GHOST_PATH + '"/></svg>',
    send: icon('<path d="M4.5 12h11"/><path d="M4.2 4.6 20 12 4.2 19.4c-.5.2-1-.3-.8-.8L6.1 12 3.4 5.4c-.2-.5.3-1 .8-.8Z"/>'),
    close: icon('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    minimize: icon('<path d="M6.5 9.5 12 15l5.5-5.5"/>'),
    mic: icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
    attach: icon('<path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>'),
    link: icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    up: icon('<path d="M7.5 10.5v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h2.5Zm0 0 3.6-6.3a1.6 1.6 0 0 1 2.9 1.2l-.8 3.6h4.9a2 2 0 0 1 2 2.4l-1.3 6a2 2 0 0 1-2 1.6H7.5"/>'),
    down: icon('<path d="M16.5 13.5v-9H19a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2.5Zm0 0-3.6 6.3a1.6 1.6 0 0 1-2.9-1.2l.8-3.6H5.9a2 2 0 0 1-2-2.4l1.3-6a2 2 0 0 1 2-1.6h9.3"/>'),
    copy: icon('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
    check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    speaker: icon('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    sound: icon('<path d="M6 16.5V8l11-2.5v8.5"/><circle cx="4.5" cy="16.5" r="2"/><circle cx="15.5" cy="14" r="2"/>'),
    person: icon('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>')
  };

  var root = el("div", { class: "gc-root", "data-mode": state.themeMode === "light" ? "light" : "dark" });
  root.style.setProperty("--gc-primary", state.primary);

  var launcher = el("button", {
    class: "gc-launcher", type: "button", "aria-label": "Open chat", "aria-expanded": "false",
    html: '<span class="gc-ring"></span><span class="gc-core"></span><span class="gc-li gc-li-ghost"><img alt="" width="64" height="64" decoding="async" src="' + API_BASE + '/img/ghostchat-mascot.webp">' + ICONS.ghost + '</span><span class="gc-li gc-li-close">' + ICONS.close + '</span><span class="gc-dot"></span>'
  });
  var panel = el("div", { class: "gc-panel", role: "dialog", "aria-label": "Chat" });
  var title = el("h2", { text: state.name });
  var soundBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Sound", "aria-label": "Message sound", "aria-pressed": "false", html: ICONS.sound });
  var voiceBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Read replies aloud", "aria-label": "Read replies aloud", "aria-pressed": "false", html: ICONS.speaker, hidden: "hidden" });
  var micBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Speak", "aria-label": "Ask by voice", html: ICONS.mic, hidden: "hidden" });
  var closeBtn = el("button", { class: "gc-iconbtn", type: "button", title: "Minimise", "aria-label": "Minimise chat", html: ICONS.minimize });
  var MASCOT = API_BASE + "/img/ghostchat-mascot.webp";
  function botAvatarHtml() { return '<img alt="" width="34" height="34" decoding="async" src="' + MASCOT + '">'; }
  var avatar = el("div", { class: "gc-avatar", html: botAvatarHtml() });
  var sub = el("span", { class: "gc-sub", text: "AI assistant · Online" });
  var head = el("div", { class: "gc-head" }, [
    avatar,
    el("div", { class: "gc-title" }, [title, sub]),
    voiceBtn, soundBtn, closeBtn
  ]);
  var tabAi = el("button", { class: "gc-tab on", type: "button", "data-tab": "assistant", "aria-pressed": "true", text: t("tabAi") });
  var tabSupportBadge = el("span", { class: "gc-tab-badge", text: "0" });
  var tabSupport = el("button", { class: "gc-tab", type: "button", "data-tab": "support", "aria-pressed": "false" }, [el("span", { text: t("tabSupport") }), tabSupportBadge]);
  var tabEnd = el("button", { class: "gc-tab-end", type: "button", text: t("endChat") });
  var tabClose = el("button", { class: "gc-tab-close", type: "button", "aria-label": t("closeSupport"), html: ICONS.close });
  var tabs = el("div", { class: "gc-tabs", role: "tablist", "aria-label": "Chat" }, [tabAi, tabSupport, tabEnd, tabClose]);
  var msgs = el("div", { class: "gc-msgs", role: "log", "aria-live": "polite", "data-pane": "assistant" });
  var msgsSupport = el("div", { class: "gc-msgs is-off", role: "log", "aria-live": "polite", "data-pane": "support" });
  var connect = el("div", { class: "gc-connect", role: "dialog", "aria-live": "polite" });
  var threads = el("div", { class: "gc-threads" }, [connect, msgs, msgsSupport]);
  var endBtn = el("button", { class: "gc-end", type: "button", text: t("endChat") });
  var endBar = el("div", { class: "gc-endbar" }, [endBtn]);
  var input = el("textarea", { rows: "1", placeholder: t("ph"), "aria-label": "Your message" });
  var sendBtn = el("button", { class: "gc-send", type: "button", title: "Send", "aria-label": "Send message", html: ICONS.send });
  var composer = el("div", { class: "gc-composer" }, [input, micBtn, sendBtn]);
  var brand = el("div", { class: "gc-brand" });
  var memNote = el("div", { class: "gc-mem", hidden: "hidden" });
  panel.appendChild(head);
  panel.appendChild(tabs);
  panel.appendChild(threads);
  panel.appendChild(endBar);
  panel.appendChild(composer);
  panel.appendChild(memNote);
  panel.appendChild(brand);
  var modal = el("div", { class: "gc-modal" });
  var modalBox = el("div", { class: "gc-modal-box" });
  var modalTitle = el("div", { text: "Book a time" });
  var modalClose = el("button", { class: "gc-iconbtn", type: "button", "aria-label": "Close", html: ICONS.close });
  var modalHead = el("header", {}, [modalTitle, modalClose]);
  var modalFrame = el("iframe", { title: "Booking calendar", allow: "payment; fullscreen" });
  modalBox.appendChild(modalHead);
  modalBox.appendChild(modalFrame);
  modal.appendChild(modalBox);
  modalClose.addEventListener("click", function () { modal.classList.remove("on"); modalFrame.src = "about:blank"; });
  modal.addEventListener("click", function (ev) { if (ev.target === modal) modalClose.click(); });
  function openBooking(url) {
    if (!url) return;
    try {
      var parsed = new URL(url, window.location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      modalFrame.src = parsed.href;
      modal.classList.add("on");
    } catch (e) {}
  }

  root.appendChild(panel);
  root.appendChild(launcher);
  root.appendChild(modal);
  shadow.appendChild(el("style", { text: css }));
  shadow.appendChild(root);
  document.documentElement.appendChild(host);

  var launcherImg = launcher.querySelector("img");
  if (launcherImg) launcherImg.addEventListener("error", function () { launcher.setAttribute("data-img", "off"); });
  avatar.addEventListener("error", function (ev) { if (ev.target && ev.target.tagName === "IMG") avatar.innerHTML = ICONS.ghost; }, true);
  // One gentle "hello" wiggle shortly after load (skipped automatically under prefers-reduced-motion).
  setTimeout(function () {
    if (state.open) return;
    launcher.classList.add("gc-hello");
    setTimeout(function () { launcher.classList.remove("gc-hello"); }, 1000);
  }, 1400);

  function setUnread(on) {
    state.unread = !!on;
    root.setAttribute("data-unread", on ? "true" : "false");
    launcher.setAttribute("aria-label", state.open ? "Close chat" : on ? "Open chat (new message)" : "Open chat");
  }
  var announced = null;
  function announce(open) {
    // Let the host page react (e.g. hide its own floating buttons) while the chat is open.
    if (announced === open) return;
    announced = open;
    try { document.documentElement.classList.toggle("ghostchat-open", open); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent(open ? "ghostchat:open" : "ghostchat:close", { detail: { siteKey: SITE_KEY } })); } catch (e) {}
  }
  function setOpen(open) {
    state.open = open;
    announce(!!open);
    root.setAttribute("data-open", open ? "true" : "false");
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    setUnread(open ? false : state.unread);
    if (open) {
      try { sessionStorage.setItem("gc_seen_" + SITE_KEY, "1"); } catch (e) {}
      loadFont();
      input.focus();
      maybeGreet();
    }
  }
  function setThinking(on) {
    state.thinking = on;
    root.setAttribute("data-thinking", on ? "true" : "false");
  }
  function setBranding() {
    if (state.showBranding) {
      var ref = "?utm_source=widget&utm_medium=referral&utm_campaign=" + encodeURIComponent(window.location.hostname || "embed");
      brand.innerHTML =
        '<a class="gc-pb" href="' + API_BASE + '/' + ref + '" target="_blank" rel="noopener">' +
        ICONS.ghost +
        escapeHtml(t("pb")) + ' <b>GhostChat</b></a>' +
        '<a class="gc-add" href="' + API_BASE + '/signup' + ref + '" target="_blank" rel="noopener">' + escapeHtml(t("add")) + '</a>';
      brand.style.display = "";
    } else {
      brand.style.display = "none";
    }
  }
  function playPop() {
    if (!state.sound) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 660;
      g.gain.value = 0.04;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.stop(ctx.currentTime + 0.13);
    } catch (e) {}
  }
  function activeMsgs() { return state.tab === "support" ? msgsSupport : msgs; }
  function scrollDown(box) { var m = box || activeMsgs(); m.scrollTop = m.scrollHeight; }

  function addBubble(role, html, box) {
    var row = el("div", { class: "gc-row " + role });
    var bubble = el("div", { class: "gc-bubble" });
    bubble.innerHTML = html;
    row.appendChild(bubble);
    (box || activeMsgs()).appendChild(row);
    scrollDown(box);
    return row;
  }

  function addSources(row, sources) {
    if (!sources || !sources.length) return;
    var wrap = el("div", { class: "gc-sources" });
    var seen = {};
    sources.slice(0, 3).forEach(function (s) {
      var key = String(s.url || s.title || "").toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
      if (!key || seen[key]) return;
      seen[key] = 1;
      var label = s.title || s.url || "Source";
      var inner = ICONS.link + "<span>" + escapeHtml(label) + "</span>";
      if (s.url) wrap.appendChild(el("a", { class: "gc-src", href: s.url, target: "_blank", rel: "noopener noreferrer", title: label, html: inner }));
      else wrap.appendChild(el("span", { class: "gc-src", title: label, html: inner }));
    });
    if (wrap.firstChild) row.appendChild(wrap);
  }

  // Follow-up chips live only under the latest bot reply (older ones are removed).
  function clearSuggestions() {
    activeMsgs().querySelectorAll(".gc-suggest").forEach(function (n) { n.remove(); });
  }

  function addSuggestions(list) {
    clearSuggestions();
    if (!list || !list.length) return;
    var wrap = el("div", { class: "gc-suggest" });
    list.slice(0, 3).forEach(function (q) {
      var chip = el("button", { class: "gc-chip", type: "button", text: q });
      chip.addEventListener("click", function () { sendMessage(q); });
      wrap.appendChild(chip);
    });
    activeMsgs().appendChild(wrap);
    scrollDown();
  }

  function addLeadForm(row, card) {
    var kind = card && card.kind === "support" ? "support" : card && card.fields ? "form" : "email";
    if (activeMsgs().querySelector('.gc-lead[data-kind="' + kind + '"]')) return; // one of each per conversation
    var form = el("form", { class: "gc-lead", "data-kind": kind, "aria-label": (card && card.title) || t("followTitle"), novalidate: "novalidate" });
    var head = el("div", { class: "gc-lead-t", html: ICONS.person });
    var tx = el("div");
    tx.appendChild(document.createTextNode((card && card.title) || t("followTitle")));
    tx.appendChild(el("small", { text: (card && card.subtitle) || t("followSub") }));
    head.appendChild(tx);
    form.appendChild(head);
    var inputs = {};
    var btn = el("button", { type: "submit", text: (card && card.cta) || "Send" });
    var err = el("div", { class: "gc-lead-err", role: "alert", hidden: "hidden" });
    if (kind === "email") {
      inputs.email = el("input", { type: "email", required: "required", placeholder: t("email"), "aria-label": "Your email", autocomplete: "email" });
      form.appendChild(el("div", { class: "gc-lead-r" }, [inputs.email, btn]));
    } else {
      var grid = el("div", { class: "gc-lead-f" });
      (card.fields || []).forEach(function (f) {
        var type = f.key === "email" ? "email" : f.key === "phone" ? "tel" : f.key === "date" ? "date" : "text";
        var ctl = f.key === "message"
          ? el("textarea", { rows: "3", maxlength: "2000" })
          : el("input", { type: type, autocomplete: f.key === "name" ? "name" : f.key === "email" ? "email" : f.key === "phone" ? "tel" : "off", maxlength: "200" });
        if (f.required) ctl.setAttribute("required", "required");
        inputs[f.key] = ctl;
        grid.appendChild(el("label", { text: f.label + (f.required ? " *" : "") }, [ctl]));
      });
      grid.appendChild(btn);
      form.appendChild(grid);
    }
    form.appendChild(err);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var payload = { siteKey: SITE_KEY, sessionId: state.sessionId, kind: kind };
      var missing = null;
      Object.keys(inputs).forEach(function (k) { payload[k] = inputs[k].value.trim(); if (!missing && inputs[k].required && !payload[k]) missing = inputs[k]; });
      if (missing) { missing.focus(); return; }
      btn.disabled = true;
      err.hidden = true;
      fetch(API_BASE + "/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) { err.textContent = res.j.error || t("sendErr"); err.hidden = false; btn.disabled = false; return; }
          form.innerHTML = "";
          var done = kind === "support" ? t("ticket") + (res.j.ticket && res.j.ticket.number ? " (#" + res.j.ticket.number + ")" : "") : t("thanks");
          form.appendChild(el("div", { class: "gc-lead-t gc-lead-done", html: ICONS.check + "<span>" + escapeHtml(done) + "</span>" }));
          if (kind === "support") maybeCsat(true);
        })
        .catch(function () { btn.disabled = false; err.textContent = t("sendErr"); err.hidden = false; });
    });
    row.appendChild(form);
    scrollDown();
  }

  // End-of-chat satisfaction rating (support mode): once per session.
  function maybeCsat(force) {
    if (!state.csat) return;
    try { if (sessionStorage.getItem("gc_csat_" + SITE_KEY)) return; } catch (e) {}
    if (!force && state.replies < 2) return;
    try { sessionStorage.setItem("gc_csat_" + SITE_KEY, "1"); } catch (e) {}
    var box = el("div", { class: "gc-csat", role: "group", "aria-label": t("csatQ") });
    box.appendChild(el("span", { text: t("csatQ") }));
    var r = el("div", { class: "gc-csat-r" });
    var opts = state.csat === "thumbs" ? [["up", "👍"], ["down", "👎"]] : [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]];
    opts.forEach(function (o) {
      var b = el("button", { type: "button", text: o[1], "aria-label": state.csat === "thumbs" ? (o[0] === "up" ? "Good" : "Bad") : o[0] + " out of 5" });
      b.addEventListener("click", function () {
        fetch(API_BASE + "/api/chat/csat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteKey: SITE_KEY, sessionId: state.sessionId, rating: o[0] }) }).catch(function () {});
        box.innerHTML = "";
        box.appendChild(el("span", { text: t("csatThanks") }));
      });
      r.appendChild(b);
    });
    box.appendChild(r);
    var row = el("div", { class: "gc-row assistant" }, [box]);
    msgs.appendChild(row);
    scrollDown(msgs);
  }

  // Recommendation cards from the site's search tool: a swipeable, lazy-loaded rail.
  function addResults(row, results) {
    if (!results || !results.length) return;
    row.classList.add("has-results");
    var box = el("div", { class: "gc-recs", role: "region", "aria-label": "Recommendations" });
    var rail = el("div", { class: "gc-rail", role: "list", tabindex: "0", "aria-label": results.length + " recommendations. Use the arrow keys to scroll." });
    results.slice(0, 8).forEach(function (r, i) {
      var url = /^https?:\/\//i.test(r.url || "") ? r.url : null;
      if (!url || !r.title) return;
      var card = el("div", { class: "gc-rc", role: "listitem", "aria-label": (i + 1) + " of " + results.length + ": " + r.title });
      var media = el("div", { class: "gc-rc-img" });
      media.appendChild(el("span", { class: "gc-rc-ph", text: r.title, "aria-hidden": "true" }));
      if (r.image && /^https?:\/\//i.test(r.image)) {
        var img = el("img", { alt: "", loading: "lazy", decoding: "async", width: "142", height: "213", referrerpolicy: "no-referrer" });
        img.addEventListener("load", function () { img.classList.add("ok"); var ph = media.querySelector(".gc-rc-ph"); if (ph) ph.style.visibility = "hidden"; });
        img.addEventListener("error", function () { img.remove(); });
        img.src = r.image;
        media.appendChild(img);
      }
      if (r.rating) media.appendChild(el("span", { class: "gc-rc-rate", text: "\u2605 " + r.rating, "aria-label": "Rated " + r.rating }));
      card.appendChild(media);
      var b = el("div", { class: "gc-rc-b" });
      b.appendChild(el("div", { class: "gc-rc-t", text: r.title }));
      var meta = [r.year, r.subtitle].filter(Boolean).join(" \u00b7 ");
      if (meta) b.appendChild(el("div", { class: "gc-rc-m", text: meta }));
      if (r.why) b.appendChild(el("div", { class: "gc-rc-w", text: r.why }));
      b.appendChild(el("a", { class: "gc-rc-cta", href: url, text: r.cta || "Open", "aria-label": (r.cta || "Open") + ": " + r.title }));
      card.appendChild(b);
      rail.appendChild(card);
    });
    if (!rail.firstChild) return;
    var prev = el("button", { class: "gc-rnav prev", type: "button", "aria-label": "Previous", html: ICONS.prev });
    var next = el("button", { class: "gc-rnav next", type: "button", "aria-label": "Next", html: ICONS.next });
    function step(dir) { rail.scrollBy({ left: dir * (rail.clientWidth - 40), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
    function sync() {
      prev.classList.toggle("on", rail.scrollLeft > 4);
      next.classList.toggle("on", rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4);
    }
    prev.addEventListener("click", function () { step(-1); });
    next.addEventListener("click", function () { step(1); });
    rail.addEventListener("scroll", function () { requestAnimationFrame(sync); }, { passive: true });
    rail.addEventListener("keydown", function (ev) {
      if (ev.target !== rail) return;
      if (ev.key === "ArrowRight") { ev.preventDefault(); step(1); }
      if (ev.key === "ArrowLeft") { ev.preventDefault(); step(-1); }
    });
    box.appendChild(rail); box.appendChild(prev); box.appendChild(next);
    row.appendChild(box);
    setTimeout(sync, 60);
  }

  function addCards(row, cards) {
    if (!cards || !cards.length) return;
    var wrap = el("div", { class: "gc-cards" });
    cards.forEach(function (card) {
      if (card.type === "form") { addLeadForm(wrap, card); return; }
      var box = el("div", { class: "gc-card" });
      if (card.image && card.type === "product") box.appendChild(el("img", { src: card.image, alt: "" }));
      var body = el("div");
      body.appendChild(el("h4", { text: card.title || "Card" }));
      if (card.subtitle || card.price) body.appendChild(el("p", { text: [card.price, card.subtitle].filter(Boolean).join(" · ") }));
      if (card.type === "discount" && card.code) {
        var code = el("span", { class: "gc-codechip", text: card.code });
        var copy = el("button", { class: "gc-copy", type: "button", text: "Copy code" });
        copy.addEventListener("click", function () {
          if (navigator.clipboard) navigator.clipboard.writeText(card.code);
          copy.textContent = "Copied";
        });
        body.appendChild(code);
        body.appendChild(copy);
      } else if (card.type === "booking" || card.url) {
        var cta = el(card.type === "booking" ? "button" : "a", {
          class: "gc-cta",
          type: card.type === "booking" ? "button" : undefined,
          href: card.type === "booking" ? undefined : card.url,
          target: card.type === "booking" ? undefined : "_blank",
          rel: "noopener noreferrer",
          text: card.cta || (card.type === "booking" ? "Open calendar" : "View")
        });
        if (card.type === "booking") cta.addEventListener("click", function () { openBooking(card.url || state.bookingUrl); });
        body.appendChild(cta);
      }
      box.appendChild(body);
      wrap.appendChild(box);
    });
    if (wrap.childNodes.length) row.appendChild(wrap);
  }

  function speak(text, force) {
    if (!(state.voiceOutput || force) || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      var clean = String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/[`*_#]/g, " ").trim();
      if (!clean) return;
      var u = new SpeechSynthesisUtterance(clean.slice(0, 800));
      u.rate = 1.02;
      u.lang = state.speechLang || document.documentElement.lang || "en-GB";
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function canListen() {
    return state.voice && (window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  var activeRec = null;
  function stopListening() {
    micBtn.classList.remove("gc-listening");
    micBtn.setAttribute("aria-pressed", "false");
    input.placeholder = t("ph");
  }
  function startListening() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) { addSystem(t("micBlocked")); return; }
    if (activeRec) { try { activeRec.stop(); } catch (e) {} return; }
    var rec;
    try { rec = new Ctor(); } catch (e) { addSystem(t("micBlocked")); return; }
    activeRec = rec;
    rec.lang = state.speechLang || (state.multilingual ? (navigator.language || "en-GB") : (document.documentElement.lang || "en-GB"));
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    var finalText = "";
    rec.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      input.value = (finalText + " " + interim).trim();
    };
    rec.onerror = function (ev) {
      if (ev && (ev.error === "not-allowed" || ev.error === "service-not-allowed" || ev.error === "audio-capture")) addSystem(t("micBlocked"));
    };
    rec.onend = function () {
      activeRec = null;
      stopListening();
      var said = (finalText || input.value || "").trim();
      if (said) { state.usedVoice = true; sendMessage(said); }
    };
    micBtn.classList.add("gc-listening");
    micBtn.setAttribute("aria-pressed", "true");
    input.placeholder = t("listening");
    try { rec.start(); } catch (e) { activeRec = null; stopListening(); addSystem(t("micBlocked")); }
  }

  function addFeedback(row, logId, text) {
    if (!logId) return;
    var wrap = el("div", { class: "gc-fb" });
    var copyBtn = el("button", { type: "button", title: "Copy", "aria-label": "Copy reply", html: ICONS.copy });
    copyBtn.addEventListener("click", function () {
      try { if (navigator.clipboard) navigator.clipboard.writeText(text || ""); } catch (e) {}
      copyBtn.innerHTML = ICONS.check; copyBtn.classList.add("on");
      setTimeout(function () { copyBtn.innerHTML = ICONS.copy; copyBtn.classList.remove("on"); }, 1400);
    });
    wrap.appendChild(copyBtn);
    ["up", "down"].forEach(function (rating) {
      var b = el("button", { type: "button", html: rating === "up" ? ICONS.up : ICONS.down, title: rating === "up" ? "Helpful" : "Not helpful", "aria-label": rating === "up" ? "Helpful" : "Not helpful", "aria-pressed": "false" });
      b.addEventListener("click", function () {
        wrap.querySelectorAll("button[aria-pressed]").forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("on"); b.setAttribute("aria-pressed", "true");
        fetch(API_BASE + "/api/chat/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ siteKey: SITE_KEY, logId: logId, rating: rating })
        }).catch(function () {});
      });
      wrap.appendChild(b);
    });
    row.appendChild(wrap);
  }

  // ---- live human takeover (Support tab) ----
  var live = { status: "bot", agent: "", after: "", timer: null, typingRow: null, lastTyping: 0, seen: {}, connect: "", connectDismissed: false, joinShown: false, reviewShown: false, reviewDone: false, backAiShown: false, visible: false, archived: false };
  function setTab(tab, opts) {
    state.tab = tab === "support" ? "support" : "assistant";
    root.setAttribute("data-tab", state.tab);
    tabAi.classList.toggle("on", state.tab === "assistant");
    tabSupport.classList.toggle("on", state.tab === "support");
    tabAi.setAttribute("aria-pressed", state.tab === "assistant" ? "true" : "false");
    tabSupport.setAttribute("aria-pressed", state.tab === "support" ? "true" : "false");
    msgs.classList.toggle("is-off", state.tab !== "assistant");
    msgsSupport.classList.toggle("is-off", state.tab !== "support");
    if (state.tab === "support") {
      state.supportUnread = 0;
      tabSupportBadge.textContent = "0";
      tabSupportBadge.classList.remove("on");
    }
    setLiveUi();
    scrollDown();
    if (!(opts && opts.silent) && state.open) input.focus();
  }
  function showSupportTab() {
    if (live.archived && live.status !== "human" && live.status !== "waiting") return;
    live.visible = true;
    root.setAttribute("data-support", "true");
  }
  function hideSupportTab() {
    live.visible = false;
    live.archived = true;
    root.setAttribute("data-support", "false");
    if (state.tab === "support") setTab("assistant", { silent: true });
    else setLiveUi();
  }
  function supportDoneKey() { return "gc_live_support_done_" + SITE_KEY + "_" + state.sessionId; }
  function markSupportDone() {
    live.reviewDone = true;
    live.archived = true;
    try { sessionStorage.setItem(supportDoneKey(), "1"); } catch (e) {}
    hideSupportTab();
  }
  function alreadySupportDone() {
    try { return sessionStorage.getItem(supportDoneKey()) === "1"; } catch (e) { return false; }
  }
  function hideConnect() {
    connect.classList.remove("on");
    connect.innerHTML = "";
    live.connect = "";
  }
  function showConnect(mode) {
    if (mode === "waiting" && live.connectDismissed && live.connect === "waiting") return;
    if (mode === "joined" && live.joinShown && live.connect !== "waiting") return;
    live.connect = mode;
    if (mode === "joined") { live.joinShown = true; live.connectDismissed = false; }
    var name = live.agent || "the team";
    connect.classList.add("on");
    connect.setAttribute("data-state", mode);
    connect.setAttribute("aria-label", mode === "joined" ? t("joined").replace("{name}", name) : t("connecting"));
    connect.innerHTML = "";
    var top = el("div", { class: "gc-connect-top" });
    top.appendChild(el("div", { class: "gc-wait", html: ICONS.person }));
    var copy = el("div", { class: "gc-connect-copy" });
    copy.appendChild(el("strong", { text: mode === "joined" ? t("joined").replace("{name}", name) : t("connecting") }));
    if (mode === "waiting") copy.appendChild(el("span", { text: "This usually only takes a moment." }));
    top.appendChild(copy);
    var x = el("button", { class: "gc-connect-x", type: "button", "aria-label": t("dismiss"), html: ICONS.close });
    x.addEventListener("click", function (ev) { ev.stopPropagation(); live.connectDismissed = true; hideConnect(); });
    top.appendChild(x);
    connect.appendChild(top);
    var actions = el("div", { class: "gc-connect-actions" });
    var openBtn = el("button", { class: "primary", type: "button", text: t("openSupport") });
    openBtn.addEventListener("click", function () { hideConnect(); live.connectDismissed = true; setTab("support"); });
    var stayBtn = el("button", { type: "button", text: t("stayAi") });
    stayBtn.addEventListener("click", function () { hideConnect(); live.connectDismissed = true; setTab("assistant"); });
    actions.appendChild(openBtn);
    actions.appendChild(stayBtn);
    if (mode === "waiting") {
      var cancelBtn = el("button", { class: "ghost", type: "button", text: t("cancelWait") });
      cancelBtn.addEventListener("click", function () { endLiveChat("cancel"); });
      actions.appendChild(cancelBtn);
    }
    connect.appendChild(actions);
  }
  function showBackAiOnce() {
    if (live.backAiShown) return;
    live.backAiShown = true;
    var last = msgs.querySelector(".gc-row.system:last-of-type .gc-bubble, .gc-row.system:last-child");
    var text = t("backAi");
    if (last && (last.textContent || "").trim() === text) return;
    addBubble("system", escapeHtml(text), msgs);
  }
  function showReviewPrompt() {
    if (live.reviewShown || live.reviewDone || alreadySupportDone()) return;
    live.reviewShown = true;
    var box = el("div", { class: "gc-csat", role: "group", "aria-label": t("csatQ") });
    box.appendChild(el("span", { text: t("csatQ") }));
    var picked = null;
    var r = el("div", { class: "gc-csat-r" });
    [[1, "★"], [2, "★★"], [3, "★★★"], [4, "★★★★"], [5, "★★★★★"]].forEach(function (o) {
      var b = el("button", { type: "button", text: "★", "aria-label": o[0] + " out of 5", "data-n": String(o[0]) });
      b.addEventListener("click", function () {
        picked = o[0];
        r.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", Number(x.getAttribute("data-n")) <= picked); });
      });
      r.appendChild(b);
    });
    box.appendChild(r);
    var comment = el("textarea", { rows: "2", maxlength: "500", placeholder: t("csatComment"), "aria-label": t("csatComment") });
    box.appendChild(comment);
    var actions = el("div", { class: "gc-connect-actions" });
    var send = el("button", { class: "gc-csat-send", type: "button", text: t("csatSend") });
    send.addEventListener("click", function () {
      if (!picked) { r.querySelector("button").focus(); return; }
      fetch(API_BASE + "/api/chat/csat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteKey: SITE_KEY, sessionId: state.sessionId, rating: picked, comment: comment.value || "" }) }).catch(function () {});
      box.innerHTML = "";
      box.appendChild(el("span", { text: t("csatThanks") }));
      markSupportDone();
    });
    var skip = el("button", { class: "ghost", type: "button", text: t("skipReview") });
    skip.addEventListener("click", function () { box.remove(); markSupportDone(); });
    actions.appendChild(send);
    actions.appendChild(skip);
    box.appendChild(actions);
    var row = el("div", { class: "gc-row assistant" }, [box]);
    msgs.appendChild(row);
    scrollDown(msgs);
  }
  function finishSupportChat(j) {
    hideConnect();
    if (j && (j.status === "closed" || j.status === "bot")) live.status = j.status || "closed";
    else if (live.status === "human" || live.status === "waiting") live.status = "closed";
    var first = !live.backAiShown && !live.reviewShown;
    setLiveUi();
    showBackAiOnce();
    if (first) setTab("assistant", { silent: true });
    if (live.reviewDone || alreadySupportDone()) markSupportDone();
    else if (j && j.reviewPending === false) { /* already rated, just dismiss the tab */ markSupportDone(); }
    else showReviewPrompt();
  }
  function setLiveUi() {
    var on = live.status === "human" || live.status === "waiting";
    root.setAttribute("data-live", live.status === "human" ? "true" : live.status === "waiting" ? "waiting" : "false");
    var supportView = state.tab === "support";
    avatar.innerHTML = supportView && on ? ICONS.person : botAvatarHtml();
    if (supportView && live.status === "human") sub.textContent = "You're chatting with " + (live.agent || "the team");
    else if (supportView && live.status === "waiting") sub.textContent = "Waiting for a team member…";
    else if (supportView && !live.archived) sub.textContent = t("ended");
    else sub.textContent = t("online");
    input.placeholder = supportView && on ? (t("supportPh") || ("Message " + (live.agent || "the team") + "…")) : t("ph");
  }
  function addSystem(text) {
    var same = t("backAi");
    if (text === same) {
      var last = msgsSupport.querySelector(".gc-row.system:last-of-type, .gc-row.system:last-child");
      if (last && (last.textContent || "").trim() === same) return last;
    }
    return addBubble("system", escapeHtml(text), msgsSupport);
  }
  function addAgent(text, name) {
    var row = addBubble("agent", renderMarkdown(text), msgsSupport);
    row.insertBefore(el("span", { class: "gc-agent-name", html: ICONS.person + escapeHtml(name || live.agent || "Team") }), row.firstChild);
    return row;
  }
  function showAgentTyping(on) {
    if (on && !live.typingRow) {
      live.typingRow = el("div", { class: "gc-row agent" }, [el("div", { class: "gc-bubble" }, [el("div", { class: "gc-typing" }, [el("i"), el("i"), el("i")])])]);
      msgsSupport.appendChild(live.typingRow);
      scrollDown(msgsSupport);
    } else if (!on && live.typingRow) { live.typingRow.remove(); live.typingRow = null; }
  }
  function applyLiveStatus(j, opts) {
    if (!j) return;
    if (alreadySupportDone()) { live.reviewDone = true; live.archived = true; }
    var liveNow = j.status === "human" || j.status === "waiting";
    if (liveNow || (j.reviewPending && !live.reviewDone)) showSupportTab();
    else if (j.status === "closed" && !j.reviewPending) { live.archived = true; hideSupportTab(); }
    if (j.agentName) live.agent = j.agentName;
    var fresh = false;
    (j.messages || []).forEach(function (m) {
      if (live.seen[m.id]) return;
      live.seen[m.id] = 1;
      live.after = m.created_at;
      showAgentTyping(false);
      if (m.role === "agent") { addAgent(m.message, m.agent_name); fresh = true; }
      else addSystem(m.message);
    });
    var prev = live.status;
    if (j.status === "human" || j.status === "waiting") live.status = j.status;
    else if (j.status === "closed") live.status = "closed";
    else live.status = "bot";
    if (j.fallback === "form") addLeadForm(msgsSupport.lastElementChild || addSystem(""), { title: "Leave your email", subtitle: "We'll get back to you as soon as someone's free." });
    showAgentTyping(live.status === "human" || live.status === "waiting" ? !!j.typing : false);
    if (live.status === "waiting") showConnect("waiting");
    else if (live.status === "human" && prev === "waiting") showConnect("joined");
    else if (live.status !== "waiting" && live.status !== "human" && live.connect) hideConnect();
    if (prev !== live.status) setLiveUi();
    if (fresh) {
      playPop();
      if (!state.open) setUnread(true);
      if (state.tab !== "support") {
        state.supportUnread += 1;
        tabSupportBadge.textContent = state.supportUnread > 9 ? "9+" : String(state.supportUnread);
        tabSupportBadge.classList.add("on");
      }
    }
    if ((j.reviewPending || live.status === "closed") && live.status !== "human" && live.status !== "waiting") {
      finishSupportChat(j);
    }
  }
  function schedulePoll() {
    clearTimeout(live.timer);
    if (!live.visible && live.status !== "human" && live.status !== "waiting" && !live.reviewShown) return;
    live.timer = setTimeout(pollLive, state.open && !document.hidden ? 2500 : 9000);
  }
  function pollLive() {
    var q = live.after ? "?after=" + encodeURIComponent(live.after) : "";
    fetch(API_BASE + "/api/live/" + encodeURIComponent(SITE_KEY) + "/" + encodeURIComponent(state.sessionId) + q, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { applyLiveStatus(j); })
      .catch(function () {})
      .then(schedulePoll);
  }
  function enterLive(ev) {
    var was = live.status;
    showSupportTab();
    live.status = ev.status === "human" ? "human" : ev.status === "closed" ? "closed" : "waiting";
    if (ev.agentName) live.agent = ev.agentName;
    if (ev.note && ev.note !== t("backAi") && !ev.ended && !ev.reviewPending) addSystem(ev.note);
    setLiveUi();
    if (live.status === "waiting") showConnect("waiting");
    else if (live.status === "human") showConnect("joined");
    if (ev.ended || ev.reviewPending) finishSupportChat(ev);
    if (was !== "human" && was !== "waiting") schedulePoll();
  }
  function endLiveChat(reason) {
    fetch(API_BASE + "/api/live/" + encodeURIComponent(SITE_KEY) + "/" + encodeURIComponent(state.sessionId) + "/end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || "end" })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      finishSupportChat(j || { status: "closed", reviewPending: true, message: t("backAi") });
    }).catch(function () {});
  }
  function visitorTyping() {
    if (state.tab !== "support" || (live.status !== "human" && live.status !== "waiting")) return;
    var now = Date.now();
    if (now - live.lastTyping < 3000) return;
    live.lastTyping = now;
    fetch(API_BASE + "/api/live/" + encodeURIComponent(SITE_KEY) + "/" + encodeURIComponent(state.sessionId) + "/typing", { method: "POST" }).catch(function () {});
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden && live.timer) { clearTimeout(live.timer); pollLive(); } });

  function maybeGreet() {
    if (state.greeted) return;
    state.greeted = true;
    var text = (state.mode === "support" && state.supportGreeting && !script.getAttribute("data-greeting")) ? state.supportGreeting : (state.greeting || "Hi — how can I help?");
    if (state.pendingGreeting) { text = state.pendingGreeting; state.pendingGreeting = ""; }
    var row = addBubble("assistant", renderMarkdown(text), msgs);
    var starters = state.quickReplies && state.quickReplies.length ? state.quickReplies.slice() : (state.starters || []).slice();
    if (state.bookingUrl && starters.indexOf("Book a time") === -1) starters.push("Book a time");
    addSuggestions(starters);
    void row;
  }

  function sendMessage(text) {
    var message = (text || input.value || "").trim();
    if (!message || state.sending) return;
    input.value = "";
    state.sending = true;
    sendBtn.disabled = true;
    clearSuggestions();
    var thread = state.tab === "support" ? "support" : "assistant";
    var pane = thread === "support" ? msgsSupport : msgs;
    addBubble("user", escapeHtml(message), pane);
    setThinking(thread === "assistant");
    var typing = el("div", { class: "gc-row " + (thread === "support" ? "agent" : "assistant") });
    typing.appendChild(el("div", { class: "gc-bubble" }, [
      el("div", { class: "gc-typing" }, [el("i"), el("i"), el("i")])
    ]));
    pane.appendChild(typing);
    scrollDown(pane);

    var row = null;
    var bubble = null;
    var acc = "";
    var gotLive = false;
    var finished = false;

    function ensureRow() {
      if (row || thread === "support") return;
      typing.remove();
      row = addBubble("assistant", "", msgs);
      bubble = row.querySelector(".gc-bubble");
    }

    fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        siteKey: SITE_KEY,
        message: message,
        sessionId: state.sessionId,
        pageUrl: window.location.href,
        lang: (navigator.language || "").slice(0, 20),
        visitorId: state.memory && !state.memoryOff ? state.visitorId : undefined,
        memory: state.memory && !state.memoryOff,
        thread: thread,
        stream: true
      })
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          ensureRow();
          acc = (j && j.error) || t("err");
          bubble.innerHTML = renderMarkdown(acc);
          finish(null);
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (part) {
          if (part.done) return finish(null);
          buf += decoder.decode(part.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          lines.forEach(function (line) {
            var ln = line.trim();
            if (ln.indexOf("data:") !== 0) return;
            var data = ln.slice(5).trim();
            if (!data) return;
            try {
              var ev = JSON.parse(data);
              if (ev.type === "token" && ev.text) {
                ensureRow();
                acc += ev.text;
                bubble.innerHTML = renderMarkdown(acc);
                scrollDown();
              } else if (ev.type === "status" && ev.status === "checking") {
                // Live site lookup: show "Checking the site…" while the bot reads fresh pages.
                if (!row) {
                  var tb = typing.querySelector(".gc-bubble");
                  if (tb) tb.innerHTML = '<div class="gc-status"><div class="gc-typing"><i></i><i></i><i></i></div><span>' + escapeHtml(t("checking")) + "</span></div>";
                } else if (bubble) {
                  bubble.innerHTML = '<div class="gc-status"><div class="gc-typing"><i></i><i></i><i></i></div><span>' + escapeHtml(t("checking")) + "</span></div>";
                }
                scrollDown();
              } else if (ev.type === "reset") {
                acc = "";
                if (bubble) bubble.innerHTML = "";
              } else if (ev.type === "live") {
                gotLive = true;
                enterLive(ev);
              } else if (ev.type === "done") {
                finish(ev);
              } else if (ev.type === "error") {
                ensureRow();
                acc = ev.error || "I couldn't reply just now.";
                bubble.innerHTML = renderMarkdown(acc);
              }
            } catch (e) {}
          });
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      ensureRow();
      bubble.innerHTML = escapeHtml(t("reach"));
      finish(null);
    });

    function finish(ev) {
      if (finished) return;
      if (thread === "support" || (!ev && gotLive && !acc)) {
        finished = true;
        typing.remove();
        setThinking(false);
        state.sending = false;
        sendBtn.disabled = false;
        return;
      }
      finished = true;
      ensureRow();
      setThinking(false);
      state.sending = false;
      sendBtn.disabled = false;
      if (ev && ev.answer && !acc) {
        acc = ev.answer;
        bubble.innerHTML = renderMarkdown(acc);
      }
      if (ev && ev.results) addResults(row, ev.results);
      if (ev && ev.sources) addSources(row, ev.sources);
      if (ev && ev.suggestions) addSuggestions(ev.suggestions);
      if (ev && ev.cards) addCards(row, ev.cards);
      speak(acc || (ev && ev.answer) || "", state.usedVoice);
      state.usedVoice = false;
      if (ev && ev.answer) state.replies++;
      if (/\b(thanks|thank you|cheers|that'?s all|solved|fixed|sorted|gracias|merci|danke|obrigad|grazie|bedankt|dzięki)\b/i.test(message)) maybeCsat(false);
      if (ev && ev.assistantLogId) {
        state.lastLogId = ev.assistantLogId;
        addFeedback(row, ev.assistantLogId, acc || ev.answer);
      }
      playPop();
      if (!state.open) setUnread(true);
      scrollDown();
    }
  }

  launcher.addEventListener("click", function () { setOpen(!state.open); });
  closeBtn.addEventListener("click", function () { setOpen(false); launcher.focus(); });
  panel.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { setOpen(false); launcher.focus(); } });
  // Stop host-page swipe/back gestures from seeing touches inside the chat.
  // Only stopPropagation: never preventDefault, so scrolling, taps and typing still work.
  function trapHostGestures(e) { e.stopPropagation(); }
  ["touchstart", "touchmove", "touchend", "touchcancel", "pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (type) {
    panel.addEventListener(type, trapHostGestures, { passive: true });
    root.addEventListener(type, trapHostGestures, { passive: true });
  });
  soundBtn.addEventListener("click", function () {
    state.sound = !state.sound;
    try { localStorage.setItem("gc_sound_" + SITE_KEY, state.sound ? "1" : "0"); } catch (e) {}
    soundBtn.setAttribute("aria-pressed", state.sound ? "true" : "false");
  });
  voiceBtn.addEventListener("click", function () {
    state.voiceOutput = !state.voiceOutput;
    voiceBtn.setAttribute("aria-pressed", state.voiceOutput ? "true" : "false");
    if (!state.voiceOutput && window.speechSynthesis) window.speechSynthesis.cancel();
  });
  micBtn.addEventListener("click", function () { startListening(); });
  tabAi.addEventListener("click", function () { setTab("assistant"); });
  tabSupport.addEventListener("click", function () { setTab("support"); });
  tabEnd.addEventListener("click", function () { endLiveChat("end"); });
  tabClose.addEventListener("click", function () { markSupportDone(); });
  endBtn.addEventListener("click", function () { endLiveChat("end"); });
  sendBtn.addEventListener("click", function () { sendMessage(); });
  input.addEventListener("input", visitorTyping);
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendMessage();
    }
  });

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.name) { state.name = cfg.name; title.textContent = cfg.name; }
    if (cfg.greeting) state.greeting = cfg.greeting;
    if (typeof cfg.multilingual === "boolean") state.multilingual = cfg.multilingual;
    if (typeof cfg.memory === "boolean") state.memory = cfg.memory;
    if (cfg.mode) state.mode = cfg.mode;
    if (cfg.quickReplies) state.quickReplies = cfg.quickReplies;
    if (cfg.csat) state.csat = cfg.csat;
    if (cfg.supportGreeting) state.supportGreeting = cfg.supportGreeting;
    if (Array.isArray(cfg.greetings)) state.greetings = cfg.greetings;
    if (cfg.starterQuestions) state.starters = cfg.starterQuestions;
    if (typeof cfg.proactiveDelayMs === "number" && !isNaN(state.delay)) { /* attr wins if set */ }
    if (typeof cfg.proactiveDelayMs === "number" && isNaN(state.delay)) state.delay = cfg.proactiveDelayMs;
    if (typeof cfg.soundDefault === "boolean" && localStorage.getItem("gc_sound_" + SITE_KEY) == null) state.sound = cfg.soundDefault;
    if (cfg.theme) {
      if (cfg.theme.mode) state.themeMode = cfg.theme.mode;
      if (cfg.theme.primary && String(cfg.theme.primary).toLowerCase() !== LEGACY_PRIMARY) state.primary = cfg.theme.primary;
      if (cfg.theme.accent && /^#[0-9a-f]{3,8}$/i.test(cfg.theme.accent)) root.style.setProperty("--gc-accent", cfg.theme.accent);
    }
    if (typeof cfg.showBranding === "boolean") state.showBranding = cfg.showBranding;
    if (typeof cfg.voiceEnabled === "boolean") state.voice = cfg.voiceEnabled;
    if (cfg.bookingUrl) state.bookingUrl = cfg.bookingUrl;
    if (cfg.bookingProvider) state.bookingProvider = cfg.bookingProvider;
    voiceBtn.hidden = !(state.voice && window.speechSynthesis);
    input.placeholder = t("ph");
    sub.textContent = t("online");
    if (typeof setLiveUi === "function") setLiveUi();
    micBtn.setAttribute("aria-label", t("speak")); micBtn.title = t("speak");
    voiceBtn.setAttribute("aria-label", t("readAloud")); voiceBtn.title = t("readAloud");
    closeBtn.setAttribute("aria-label", t("min"));
    renderMemNote();
    micBtn.hidden = !canListen();
    root.setAttribute("data-mode", state.themeMode === "light" ? "light" : "dark");
    root.style.setProperty("--gc-primary", state.primary);
    soundBtn.setAttribute("aria-pressed", state.sound ? "true" : "false");
    setBranding();
  }

  applyConfig({ greeting: state.greeting, showBranding: true });
  setOpen(state.open);
  try { if (!state.open && !sessionStorage.getItem("gc_seen_" + SITE_KEY)) setTimeout(function () { if (!state.open) setUnread(true); }, 1500); } catch (e) {}
  soundBtn.setAttribute("aria-pressed", state.sound ? "true" : "false");

  function renderMemNote() {
    if (!state.memory) { memNote.hidden = true; return; }
    memNote.hidden = false;
    memNote.innerHTML = "";
    if (state.memoryOff) {
      memNote.appendChild(el("span", { text: t("memOff") }));
      var on = el("button", { type: "button", text: t("memOn") });
      on.addEventListener("click", function () { state.memoryOff = false; try { localStorage.removeItem("gc_mem_off_" + SITE_KEY); } catch (e) {} renderMemNote(); });
      memNote.appendChild(on);
      return;
    }
    memNote.appendChild(el("span", { text: t("mem") }));
    var off = el("button", { type: "button", text: t("forget") });
    off.addEventListener("click", function () {
      state.memoryOff = true;
      try { localStorage.setItem("gc_mem_off_" + SITE_KEY, "1"); } catch (e) {}
      fetch(API_BASE + "/api/chat/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteKey: SITE_KEY, visitorId: state.visitorId }) }).catch(function () {});
      renderMemNote();
    });
    memNote.appendChild(off);
  }

  // Proactive greeting: owner rules by URL pattern, shown once per session as a small bubble by the launcher.
  function matchGreeting() {
    var list = state.greetings || [];
    var p = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g || !g.message) continue;
      if (g.pattern === "*") return g;
      var pat = String(g.pattern || "").replace(/\/+$/, "") || "/";
      if (pat.slice(-1) === "*" ? p.indexOf(pat.slice(0, -1)) === 0 : p === pat) return g;
    }
    return null;
  }
  function scheduleGreeting() {
    var g = matchGreeting();
    if (!g) return false;
    try { if (sessionStorage.getItem("gc_greet_" + SITE_KEY) || sessionStorage.getItem("gc_seen_" + SITE_KEY)) return true; } catch (e) {}
    setTimeout(function () {
      if (state.open || state.greeted) return;
      try { if (sessionStorage.getItem("gc_greet_" + SITE_KEY)) return; sessionStorage.setItem("gc_greet_" + SITE_KEY, "1"); } catch (e) {}
      var x = el("button", { type: "button", "aria-label": t("greetClose"), html: ICONS.close });
      var teaser = el("div", { class: "gc-teaser", role: "status" }, [el("span", { text: g.message }), x]);
      var hide = function () { teaser.classList.remove("on"); setTimeout(function () { teaser.remove(); }, 300); };
      x.addEventListener("click", function (ev) { ev.stopPropagation(); hide(); });
      teaser.addEventListener("click", function () { state.pendingGreeting = g.message; hide(); setOpen(true); });
      root.appendChild(teaser);
      requestAnimationFrame(function () { teaser.classList.add("on"); });
      setUnread(true);
      setTimeout(hide, 20000);
    }, Math.max(3, Number(g.delay_s) || 15) * 1000);
    return true;
  }

  // Proactive open: data-delay wins, then the site's setting, then 4s. 0 turns it off.
  function scheduleProactive() {
    if (scheduleGreeting()) return; // an owner greeting rule replaces the auto-open on matching pages
    var delay = isNaN(state.delay) ? 4000 : state.delay;
    if (!state.open && delay > 0) {
      setTimeout(function () {
        if (!state.open) setOpen(true);
      }, delay);
    }
  }

  if (SITE_KEY && state.sessionId) {
    fetch(API_BASE + "/api/live/" + encodeURIComponent(SITE_KEY) + "/" + encodeURIComponent(state.sessionId), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (!j) return; if (alreadySupportDone()) { live.reviewDone = true; live.archived = true; } applyLiveStatus(j); if (j.status === "human" || j.status === "waiting" || j.reviewPending) schedulePoll(); })
      .catch(function () {});
  }

  if (SITE_KEY) {
    fetch(API_BASE + "/api/widget/config/" + encodeURIComponent(SITE_KEY))
      .then(function (r) { return r.json(); })
      .then(function (j) { applyConfig(j.config); if (state.open) maybeGreet(); })
      .catch(function () {})
      .then(scheduleProactive);
  } else {
    scheduleProactive();
  }
})();
