import { describe, expect, it } from "vitest";
import { modsNotInCollection } from "../src/collections";
import type { Mod } from "../src/preset";

describe("modsNotInCollection", () => {
  it("returns Steam mods missing from the collection and all local mods", () => {
    const mods: Mod[] = [
      { name: "In collection", source: "steam", steamId: "1" },
      { name: "Not in collection", source: "steam", steamId: "2" },
      { name: "@local", source: "local", localLink: {} },
    ];
    const result = modsNotInCollection(mods, { items: [{ id: "1", name: "In collection" }] });
    expect(result.map((m) => m.name)).toEqual(["Not in collection", "@local"]);
  });
});
