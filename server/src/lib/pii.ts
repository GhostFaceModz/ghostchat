/** Redact common PII before chat logs are stored. */

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<![\w])(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\w)/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const UK_NI = /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{6}\s?[A-D]\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function luhnOk(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function redactPii(text: string): string {
  if (!text) return text;
  let out = text
    .replace(EMAIL, "[email]")
    .replace(SSN, "[ssn]")
    .replace(UK_NI, "[id]")
    .replace(PHONE, "[phone]");

  out = out.replace(CARD, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnOk(digits) ? "[card]" : match;
  });

  // Only redact IPs that look private/sensitive in logs? Keep public URLs intact.
  // Skip IPs inside URLs by a simple lookbehind-ish check.
  out = out.replace(IPV4, (match, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - 12), offset);
    if (/https?:\/\/(\w+\.)?$/.test(before) || before.endsWith("://")) return match;
    const parts = match.split(".").map(Number);
    if (parts.some((n) => n > 255)) return match;
    return "[ip]";
  });

  return out;
}
