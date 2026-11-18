import { test } from "node:test";
import assert from "node:assert/strict";
import { agentKey, buildAgentReviewBoard, firstResponseMs, median } from "../server/src/lib/agentReviews.ts";
import { endChatSystemMessage } from "../server/src/lib/handoff.ts";
import { readFileSync } from "node:fs";

test("median and first-response helpers", () => {
  assert.equal(median([]), null);
  assert.equal(median([4]), 4);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(firstResponseMs("2026-11-18T12:00:00.000Z", "2026-11-18T12:00:45.000Z"), 45_000);
  assert.equal(firstResponseMs("2026-11-18T12:00:00.000Z", "2026-11-18T11:59:00.000Z"), null);
});

test("leaderboard ranks agents by average rating, then volume", () => {
  const board = buildAgentReviewBoard(
    [
      { rating: 5, comment: "Great", agent_id: "a1", agent_name: "Ada", created_at: "2026-11-18T10:00:00.000Z", handled_by_human: true },
      { rating: 4, comment: "Good", agent_id: "a1", agent_name: "Ada", created_at: "2026-11-18T11:00:00.000Z", handled_by_human: true },
      { rating: 3, comment: null, agent_id: "b2", agent_name: "Ben", created_at: "2026-11-18T12:00:00.000Z", handled_by_human: true },
    ],
    [
      { agent_id: "a1", agent_name: "Ada", first_response_ms: 20_000 },
      { agent_id: "a1", agent_name: "Ada", first_response_ms: 40_000 },
      { agent_id: "b2", agent_name: "Ben", first_response_ms: 10_000 },
    ],
    [{ id: "a1", name: "Ada Lovelace", avatar_url: "https://example.com/ada.png" }],
  );
  assert.equal(board.length, 2);
  assert.equal(board[0].rank, 1);
  assert.equal(board[0].display_name, "Ada Lovelace");
  assert.equal(board[0].average_rating, 4.5);
  assert.equal(board[0].ratings, 2);
  assert.equal(board[0].chats_handled, 2);
  assert.equal(board[0].median_first_response_ms, 30_000);
  assert.equal(board[0].recent_comments[0].comment, "Good");
  assert.equal(board[1].display_name, "Ben");
  assert.equal(board[1].average_rating, 3);
  assert.equal(agentKey("a1", "Ada"), "id:a1");
});

test("closing a chat tells the visitor it is closed and they can start a new one", () => {
  assert.match(endChatSystemMessage("end"), /closed/i);
  assert.match(endChatSystemMessage("end"), /new one/i);
  assert.match(endChatSystemMessage("handback"), /AI assistant/i);
});

test("dashboard ships Close chat, a Closed filter, and Agent reviews copy in all 8 languages", () => {
  const i18n = readFileSync(new URL("../dashboard/i18n.js", import.meta.url), "utf8");
  const live = readFileSync(new URL("../dashboard/live.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
  assert.match(live, /Close chat/);
  assert.match(live, /applyTranscriptScroll/);
  assert.match(live, /inbox-new-pill/);
  assert.match(html, /data-inbox-filter="closed"/);
  assert.match(html, /id="acct-reviews"/);
  assert.match(html, /idle_timeout_min[^>]+value="30"/);
  for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "pl"]) {
    assert.match(i18n, new RegExp(`${lang}: \\{`));
    assert.match(i18n, /"team.reviews"/);
  }
  assert.equal((i18n.match(/"team.reviews":/g) || []).length, 8);
  assert.equal((i18n.match(/"inbox.closeChat":/g) || []).length, 8);
});
