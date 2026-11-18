import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const widget = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");

test("the widget panel is a modal dialog with a focus trap and Escape to close", () => {
  assert.match(widget, /aria-modal": "true"/);
  assert.match(widget, /aria-labelledby/);
  assert.match(widget, /function trapFocus/);
  assert.match(widget, /function focusables/);
  assert.match(widget, /lastFocus/);
  assert.match(widget, /ev\.key === "Escape"/);
  assert.match(widget, /prefers-reduced-motion: reduce/);
  assert.match(widget, /role: "log", "aria-live": "polite"/);
});

test("opening the widget remembers host focus and closing restores it", () => {
  assert.match(widget, /document\.activeElement/);
  assert.match(widget, /back\.focus/);
  assert.match(widget, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
});
