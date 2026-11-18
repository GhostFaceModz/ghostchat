import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");

test("dashboard first-pass i18n covers main tabs in the widget languages", () => {
  assert.match(dash, /dashboard\/i18n\.js/);
  assert.match(dash, /id="dash-lang"/);
  assert.match(dash, /data-i18n="tab.train"/);
  assert.match(dash, /data-i18n="tab.live"/);
  const langs = ["en", "es", "fr", "de", "pt", "it", "nl", "pl"];
  for (const lang of langs) {
    assert.match(js, new RegExp(`\\b${lang}: \\{`));
    assert.match(js, new RegExp(`"${lang === "en" ? "Train" : lang === "es" ? "Entrenar" : lang === "fr" ? "Entraînement" : lang === "de" ? "Training" : lang === "pt" ? "Treinar" : lang === "it" ? "Addestramento" : lang === "nl" ? "Trainen" : "Szkolenie"}"`));
  }
  assert.match(js, /localStorage\.getItem\("gc_dash_lang"\)/);
});
