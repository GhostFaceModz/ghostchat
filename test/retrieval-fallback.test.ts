import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retrievalOnlyAnswer } from "../server/src/lib/chat.ts";
import type { RetrievedChunk } from "../server/src/types.ts";

function chunk(partial: Partial<RetrievedChunk> & { content: string; id: string }): RetrievedChunk {
  return { site_id: "s", url: null, title: null, similarity: 0.8, ...partial };
}

describe("retrievalOnlyAnswer", () => {
  it("returns null when there are no useful chunks", () => {
    assert.equal(retrievalOnlyAnswer([]), null);
    assert.equal(retrievalOnlyAnswer([chunk({ id: "1", content: "too short" })]), null);
  });

  it("builds a source-backed extract instead of the trouble-replying message", () => {
    const result = retrievalOnlyAnswer([
      chunk({
        id: "1",
        title: "All Games | GhostGames",
        heading: "Game categories",
        url: "https://ghostgames.app/ghostgames/games/",
        content: "GhostGames is a free library of browser games. Play zombies, shooters, open worlds, sports, skill, RPG, strategy, arcade and retro instantly in your browser, with no installs. Featured titles include BO1 Zombies Hub, Kino der Toten, Skate 3 Browser and CS Surf Browser.",
      }),
      chunk({
        id: "2",
        title: "BO1 Zombies Hub | Play free in your browser",
        heading: "BO1 Zombies Hub",
        url: "https://ghostgames.app/ghostgames/g/bo1-zombies/",
        content: "BO1 Zombies Hub is a Zombies game in the GhostGames library. Black Ops 1 Zombies ported to the browser. Pick from Kino der Toten, Five, Der Riese and more. Current status: online, playable in the browser.",
      }),
    ]);
    assert.ok(result);
    assert.match(result.answer, /^Here's what I found:/);
    assert.match(result.answer, /free library of browser games/);
    assert.match(result.answer, /BO1 Zombies Hub/);
    assert.match(result.answer, /https:\/\/ghostgames\.app\/ghostgames\/games\//);
    assert.doesNotMatch(result.answer, /having trouble replying/);
    assert.equal(result.sources.length, 2);
    assert.equal(result.sources[0].url, "https://ghostgames.app/ghostgames/games/");
    assert.equal(result.sources[1].url, "https://ghostgames.app/ghostgames/g/bo1-zombies/");
  });

  it("dedupes the same page and caps the number of extracts", () => {
    const chunks = Array.from({ length: 8 }, (_, i) =>
      chunk({
        id: String(i),
        title: i < 2 ? "Home" : `Game ${i}`,
        url: i < 2 ? "https://ghostgames.app/ghostgames/" : `https://ghostgames.app/ghostgames/g/game-${i}/`,
        content: `This is a reasonably long GhostGames passage number ${i} that describes a real game visitors can play in their browser today.`,
      }),
    );
    const result = retrievalOnlyAnswer(chunks);
    assert.ok(result);
    assert.equal(result.sources.length, 4);
    assert.equal(result.answer.split("https://").length - 1, 4);
  });
});
