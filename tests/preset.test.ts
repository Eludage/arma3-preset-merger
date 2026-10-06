import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractClientMods,
  mergePresets,
  modKey,
  parsePreset,
  PresetParseError,
  serializePreset,
  type Preset,
} from "../src/preset";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");

const baseHtml = fixture("base-2026-06-01.html");
const whitelistHtml = fixture("whitelist-2026-06-01.html");

describe("parsePreset", () => {
  it("reads name and Steam mods of a launcher export", () => {
    const base = parsePreset(baseHtml);
    expect(base.name).toBe("SSG_2026_06_01_Modpack");
    expect(base.mods).toHaveLength(90);
    expect(base.dlcs).toHaveLength(0);
    expect(base.mods[0]).toEqual({ name: "3den Enhanced", source: "steam", steamId: "623475643" });
    expect(base.mods.find((m) => m.steamId === "682140680")?.name).toBe("kerama Islands By [Vétérans]");
  });

  it("rejects files that are not presets", () => {
    expect(() => parsePreset("<html><body>hello</body></html>")).toThrow(PresetParseError);
  });

  it("reads local mods and DLCs", () => {
    const preset = parsePreset(`<html><head><meta name="arma:Type" content="preset" /></head><body>
      <table>
        <tr data-type="ModContainer">
          <td data-type="DisplayName">@my_local_mod</td>
          <td><span class="from-local">Local</span></td>
          <td><span data-type="Link" data-meta="local:@my_local_mod|D:\\Mods\\@my_local_mod\\|" /></td>
        </tr>
      </table>
      <div class="dlc-list"><table>
        <tr data-type="DlcContainer">
          <td data-type="DisplayName">Global Mobilization</td>
          <td><a href="https://store.steampowered.com/app/1042220" data-type="Link">x</a></td>
        </tr>
      </table></div></body></html>`);
    expect(preset.mods).toHaveLength(1);
    expect(preset.mods[0].source).toBe("local");
    expect(modKey(preset.mods[0])).toBe("local:@my_local_mod");
    expect(preset.dlcs).toEqual([
      { name: "Global Mobilization", appId: "1042220", url: "https://store.steampowered.com/app/1042220" },
    ]);
  });
});

describe("serializePreset", () => {
  it("reproduces a launcher export byte for byte", () => {
    expect(serializePreset(parsePreset(baseHtml))).toBe(baseHtml);
    expect(serializePreset(parsePreset(whitelistHtml))).toBe(whitelistHtml);
  });

  it("round-trips local mods and DLCs", () => {
    const preset: Preset = {
      name: "Test & <Co>",
      mods: [{ name: "@local", source: "local", localLink: { "data-type": "Link", "data-meta": "local:@local|" } }],
      dlcs: [{ name: "S.O.G. Prairie Fire", appId: "1227700", url: "https://store.steampowered.com/app/1227700" }],
    };
    expect(parsePreset(serializePreset(preset))).toEqual(preset);
  });
});

describe("extractClientMods / mergePresets", () => {
  const base = parsePreset(baseHtml);
  const whitelist = parsePreset(whitelistHtml);

  it("finds the client-side mods added on top of the base modpack", () => {
    const { clientMods, missingBaseMods } = extractClientMods(base, whitelist);
    expect(missingBaseMods).toEqual([]);
    expect(clientMods).toHaveLength(whitelist.mods.length - base.mods.length);
    expect(clientMods.map((m) => m.name)).toContain("Enhanced GPS");
    expect(clientMods.map((m) => m.name)).not.toContain("ace");
  });

  it("merging the client mods back into the base yields the original mod set", () => {
    const { clientMods, clientDlcs } = extractClientMods(base, whitelist);
    const { preset, alreadyInBase } = mergePresets(base, { mods: clientMods, dlcs: clientDlcs }, "merged");
    expect(alreadyInBase).toEqual([]);
    expect(new Set(preset.mods.map(modKey))).toEqual(new Set(whitelist.mods.map(modKey)));
  });

  it("handles base modpack changes: removed mods, new mods, client mods promoted to base", () => {
    const { clientMods } = extractClientMods(base, whitelist);
    const promoted = clientMods[0];
    const removed = base.mods[base.mods.length - 1];
    const added = { name: "Brand New Mod", source: "steam" as const, steamId: "1" };
    const newBase: Preset = {
      name: "SSG_next",
      mods: [...base.mods.filter((m) => m !== removed), added, promoted],
      dlcs: [],
    };

    const { preset, alreadyInBase } = mergePresets(newBase, { mods: clientMods, dlcs: [] }, "next");
    const keys = preset.mods.map(modKey);
    expect(alreadyInBase).toEqual([promoted]);
    expect(keys).toContain(modKey(added));
    expect(keys).not.toContain(modKey(removed));
    expect(new Set(keys).size).toBe(keys.length);
    expect(preset.mods).toHaveLength(newBase.mods.length + clientMods.length - 1);
  });

  it("reports base mods the player has deselected", () => {
    const trimmed: Preset = { ...whitelist, mods: whitelist.mods.filter((m) => m.name !== "ace") };
    expect(extractClientMods(base, trimmed).missingBaseMods.map((m) => m.name)).toEqual(["ace"]);
  });
});
