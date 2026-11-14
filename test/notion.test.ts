import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNotionPageId } from "../server/src/lib/notion.ts";

test("parses Notion URLs and bare ids", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const dashed = "01234567-89ab-cdef-0123-456789abcdef";
  assert.equal(parseNotionPageId(`https://www.notion.so/My-Page-${id}`), dashed);
  assert.equal(parseNotionPageId(dashed), dashed);
  assert.equal(parseNotionPageId("not a page"), null);
});
