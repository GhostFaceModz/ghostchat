import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dash = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../dashboard/commandPalette.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../dashboard/styles.css", import.meta.url), "utf8");

test("dashboard includes a command palette opened with Ctrl/Cmd+K", () => {
  assert.match(dash, /id="cmd-palette"/);
  assert.match(dash, /id="open-palette"/);
  assert.match(dash, /commandPalette\.js/);
  assert.match(js, /metaKey \|\| e\.ctrlKey/);
  assert.match(js, /e\.key\.toLowerCase\(\) === "k"/);
  assert.match(js, /Live inbox/);
  assert.match(js, /#tabs button\[data-tab\]/);
  assert.match(js, /#site-list button/);
  assert.match(css, /\.cmd-palette/);
});
