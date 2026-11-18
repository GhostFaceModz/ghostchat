import { test } from "node:test";
import assert from "node:assert/strict";
import { wasNearBottom, nextScrollTop, shouldStick, shouldShowNewPill } from "../server/src/lib/inboxScroll.ts";

test("near-bottom uses a 120px threshold", () => {
  assert.equal(wasNearBottom(880, 1000, 100, 120), true); // 20px from bottom
  assert.equal(wasNearBottom(0, 1000, 100, 120), false);
  assert.equal(wasNearBottom(0, 100, 100, 120), true); // short thread fits
});

test("a re-render must not jump a long thread back to the top", () => {
  // Agent was reading mid-thread (scrollTop 400 of 1000, client 200)
  const prevTop = 400;
  const near = wasNearBottom(prevTop, 1000, 200);
  assert.equal(near, false);
  const stick = shouldStick({ force: false, prevNearBottom: near, hasPrev: true });
  assert.equal(stick, false);
  assert.equal(nextScrollTop({ stick, prevTop, newScrollHeight: 1000, clientHeight: 200 }), 400);
  assert.equal(shouldShowNewPill({ stick, grew: true }), true);
  assert.equal(shouldShowNewPill({ stick, grew: false }), false);
});

test("stays stuck to the bottom when the agent was already there, even as messages arrive", () => {
  const prevTop = 880;
  const near = wasNearBottom(prevTop, 1000, 120);
  assert.equal(near, true);
  const stick = shouldStick({ force: false, prevNearBottom: near, hasPrev: true });
  assert.equal(stick, true);
  assert.equal(nextScrollTop({ stick, prevTop, newScrollHeight: 1300, clientHeight: 120 }), 1180);
  assert.equal(shouldShowNewPill({ stick, grew: true }), false);
});

test("opening a conversation or sending a reply forces a stick", () => {
  const stick = shouldStick({ force: true, prevNearBottom: false, hasPrev: true });
  assert.equal(stick, true);
  assert.equal(shouldShowNewPill({ stick, grew: true }), false);
});
