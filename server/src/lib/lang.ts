/** Lightweight visitor-language detection (no dependencies) and the widget's supported UI languages. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", nl: "Dutch", pl: "Polish",
  tr: "Turkish", sv: "Swedish", ru: "Russian", uk: "Ukrainian", ar: "Arabic", he: "Hebrew", hi: "Hindi", zh: "Chinese",
  ja: "Japanese", ko: "Korean", el: "Greek", th: "Thai",
};
export const UI_LANGUAGES = ["en", "es", "fr", "de", "pt", "it", "nl", "pl"];

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "is", "are", "what", "how", "do", "you", "can", "have", "and", "with", "my", "for", "this", "does", "where", "when", "i", "it", "of", "to", "hello", "hi", "thanks", "please"],
  es: ["el", "la", "los", "las", "es", "qué", "que", "cómo", "como", "tienen", "hola", "gracias", "por", "para", "con", "una", "un", "del", "dónde", "cuánto", "puedo", "mi", "y", "está", "son", "quiero"],
  fr: ["le", "la", "les", "est", "quel", "quelle", "comment", "vous", "avez", "bonjour", "merci", "pour", "avec", "une", "des", "du", "où", "combien", "je", "mon", "et", "c'est", "pas", "suis", "voudrais"],
  de: ["der", "die", "das", "ist", "was", "wie", "sie", "haben", "hallo", "danke", "für", "mit", "eine", "ein", "und", "wo", "wann", "ich", "mein", "nicht", "kann", "gibt", "bitte", "möchte"],
  pt: ["o", "os", "as", "é", "qual", "como", "vocês", "você", "têm", "olá", "obrigado", "obrigada", "para", "com", "uma", "um", "do", "da", "onde", "quanto", "eu", "meu", "e", "não", "posso"],
  it: ["il", "lo", "gli", "è", "che", "come", "avete", "ciao", "grazie", "per", "con", "una", "uno", "del", "della", "dove", "quanto", "io", "mio", "e", "non", "posso", "sono", "vorrei"],
  nl: ["de", "het", "een", "is", "wat", "hoe", "jullie", "hebben", "hallo", "dank", "bedankt", "voor", "met", "van", "waar", "wanneer", "ik", "mijn", "en", "niet", "kan", "graag", "zijn"],
  pl: ["jest", "co", "jak", "macie", "cześć", "dzień", "dobry", "dziękuję", "dla", "z", "się", "gdzie", "ile", "ja", "mój", "moje", "i", "nie", "mogę", "czy", "to", "proszę"],
  tr: ["bir", "ve", "ne", "nasıl", "var", "merhaba", "teşekkürler", "için", "ile", "nerede", "kaç", "ben", "benim", "değil", "mı", "mi", "bu"],
  sv: ["är", "vad", "hur", "ni", "har", "hej", "tack", "för", "med", "en", "ett", "och", "var", "när", "jag", "min", "inte", "kan"],
};

export function detectLanguage(text: string, hint?: string | null): string {
  const t = String(text || "");
  const base = String(hint || "").toLowerCase().split(/[-_]/)[0];
  if (/[\u3040-\u30ff]/.test(t)) return "ja";
  if (/[\uac00-\ud7af]/.test(t)) return "ko";
  if (/[\u4e00-\u9fff]/.test(t)) return "zh";
  if (/[\u0600-\u06ff]/.test(t)) return "ar";
  if (/[\u0590-\u05ff]/.test(t)) return "he";
  if (/[\u0900-\u097f]/.test(t)) return "hi";
  if (/[\u0e00-\u0e7f]/.test(t)) return "th";
  if (/[\u0370-\u03ff]/.test(t)) return "el";
  if (/[\u0400-\u04ff]/.test(t)) return /[іїєґ]/i.test(t) ? "uk" : "ru";
  const words = t.toLowerCase().match(/[a-zà-ÿąćęłńóśźżğışçœ']+/g) || [];
  const scores: Array<[string, number]> = Object.entries(STOPWORDS).map(([lang, list]) => [lang, words.filter((w) => list.includes(w)).length]);
  // Letters that only some languages use break ties.
  const bonus = (lang: string, re: RegExp) => { if (re.test(t)) { const s = scores.find((x) => x[0] === lang); if (s) s[1] += 1.5; } };
  bonus("es", /[ñ¿¡]/); bonus("de", /[ß]|\b\w*[äöü]\w*\b/); bonus("pl", /[ąćęłńśźż]/); bonus("tr", /[ğış]/); bonus("pt", /[ãõ]/); bonus("fr", /[œç]|\bl'|\bj'|\bd'/);
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (best[1] >= 2 && best[1] > second[1]) return best[0];
  if (best[1] >= 1 && best[1] > second[1] && words.length <= 4) return best[0];
  if (base && LANGUAGE_NAMES[base] && (best[1] === 0 || best[0] === base)) return base;
  return best[1] > 0 && best[1] > second[1] ? best[0] : (base && LANGUAGE_NAMES[base] ? base : "en");
}

export function languageRule(lang: string | null | undefined): string {
  const name = LANGUAGE_NAMES[lang || "en"] || "English";
  return `- Reply in the same language the visitor writes in (detected: ${name}). Keep product names, links and codes unchanged. If you must say you're not sure, say it in that language.`;
}
