/**
 * Parsing, diffing, merging and serializing of Arma 3 Launcher preset files.
 *
 * A preset is the HTML file the launcher exports via MODS > PRESET > EXPORT.
 * Mods are identified by their Steam Workshop ID (names change between updates);
 * local mods have no ID and are identified by their local path/name instead.
 */

export type ModSource = "steam" | "local";

export interface Mod {
  name: string;
  source: ModSource;
  /** Steam Workshop item ID, set for Steam mods. */
  steamId?: string;
  /** Attributes of the link element of a local mod, re-emitted unchanged on export. */
  localLink?: Record<string, string>;
}

export interface Dlc {
  name: string;
  /** Steam app ID of the DLC, if the link contains one. */
  appId?: string;
  url?: string;
}

export interface Preset {
  name: string;
  mods: Mod[];
  dlcs: Dlc[];
}

export class PresetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetParseError";
  }
}

const STEAM_ID_PATTERN = /[?&]id=(\d+)/;
const STEAM_APP_PATTERN = /\/app\/(\d+)/;

/** Stable identity of a mod, used to compare presets. */
export function modKey(mod: Mod): string {
  if (mod.steamId) return `steam:${mod.steamId}`;
  // data-meta looks like "local:<mod name>|<path>|"; the path differs between machines, so only the name is used.
  const metaName = mod.localLink?.["data-meta"]?.match(/^local:([^|]*)/)?.[1];
  return `local:${(metaName || mod.name).trim().toLowerCase()}`;
}

/** Stable identity of a DLC, used to compare presets. */
export function dlcKey(dlc: Dlc): string {
  return dlc.appId ? `app:${dlc.appId}` : `name:${dlc.name.trim().toLowerCase()}`;
}

export function parsePreset(html: string): Preset {
  const doc = new DOMParser().parseFromString(html.replace(/^﻿/, ""), "text/html");

  const type = doc.querySelector('meta[name="arma:Type"]')?.getAttribute("content");
  if (type !== "preset") {
    throw new PresetParseError("This file is not an Arma 3 Launcher preset.");
  }
  const name = doc.querySelector('meta[name="arma:PresetName"]')?.getAttribute("content")?.trim() ?? "";

  const mods = uniqueBy(
    Array.from(doc.querySelectorAll('tr[data-type="ModContainer"]'), parseModRow),
    modKey,
  );
  const dlcs = uniqueBy(
    Array.from(doc.querySelectorAll('tr[data-type="DlcContainer"]'), parseDlcRow),
    dlcKey,
  );

  return { name, mods, dlcs };
}

function parseModRow(row: Element): Mod {
  const name = displayName(row);
  const link = row.querySelector('[data-type="Link"]');
  const steamId = link?.getAttribute("href")?.match(STEAM_ID_PATTERN)?.[1];
  const isLocal = row.querySelector(".from-local") !== null;

  if (steamId && !isLocal) {
    return { name, source: "steam", steamId };
  }
  const localLink: Record<string, string> = {};
  for (const attr of Array.from(link?.attributes ?? [])) {
    localLink[attr.name] = attr.value;
  }
  return { name, source: "local", localLink };
}

function parseDlcRow(row: Element): Dlc {
  const url = row.querySelector('[data-type="Link"]')?.getAttribute("href") ?? undefined;
  const appId = url?.match(STEAM_APP_PATTERN)?.[1];
  return { name: displayName(row), appId, url };
}

function displayName(row: Element): string {
  return row.querySelector('[data-type="DisplayName"]')?.textContent?.trim() ?? "";
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface ExtractResult {
  /** Mods in the player's preset that are not part of the base modpack. */
  clientMods: Mod[];
  /** DLCs in the player's preset that are not part of the base modpack. */
  clientDlcs: Dlc[];
  /** Base mods the player's preset does not contain (a required mod was deselected). */
  missingBaseMods: Mod[];
}

/** Computes the player's additions on top of a base modpack. */
export function extractClientMods(base: Preset, player: Preset): ExtractResult {
  const baseMods = new Set(base.mods.map(modKey));
  const playerMods = new Set(player.mods.map(modKey));
  const baseDlcs = new Set(base.dlcs.map(dlcKey));
  return {
    clientMods: player.mods.filter((m) => !baseMods.has(modKey(m))),
    clientDlcs: player.dlcs.filter((d) => !baseDlcs.has(dlcKey(d))),
    missingBaseMods: base.mods.filter((m) => !playerMods.has(modKey(m))),
  };
}

export interface MergeResult {
  preset: Preset;
  /** Client mods that are now part of the base modpack and were therefore not added again. */
  alreadyInBase: Mod[];
}

/** Appends client mods and DLCs to a base modpack, skipping anything the base already contains. */
export function mergePresets(base: Preset, client: Pick<Preset, "mods" | "dlcs">, name: string): MergeResult {
  const baseMods = new Set(base.mods.map(modKey));
  const baseDlcs = new Set(base.dlcs.map(dlcKey));
  const alreadyInBase = client.mods.filter((m) => baseMods.has(modKey(m)));
  return {
    preset: {
      name,
      mods: uniqueBy([...base.mods, ...client.mods], modKey),
      dlcs: [...base.dlcs, ...client.dlcs.filter((d) => !baseDlcs.has(dlcKey(d)))],
    },
    alreadyInBase,
  };
}

/** Workshop page of a Steam mod. */
export function steamUrl(steamId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${steamId}`;
}

/**
 * Serializes a preset in the exact layout the Arma 3 Launcher exports
 * (UTF-8 BOM, CRLF line endings, same markup and styles).
 */
export function serializePreset(preset: Preset): string {
  const name = escapeXml(preset.name);
  const modRows = preset.mods.map(serializeModRow).join("");
  const dlcTable = preset.dlcs.length
    ? `      <table>\n${preset.dlcs.map(serializeDlcRow).join("")}      </table>\n`
    : `      <table />\n`;

  const html = `<?xml version="1.0" encoding="utf-8"?>
<html>
  <!--Created by Arma 3 Launcher: https://arma3.com-->
  <head>
    <meta name="arma:Type" content="preset" />
    <meta name="arma:PresetName" content="${name}" />
    <meta name="generator" content="Arma 3 Launcher - https://arma3.com" />
    <title>Arma 3</title>
    <link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet" type="text/css" />
    <style>
${LAUNCHER_STYLE}</style>
  </head>
  <body>
    <h1>Arma 3  - Preset <strong>${name}</strong></h1>
    <p class="before-list">
      <em>To import this preset, drag this file onto the Launcher window. Or click the MODS tab, then PRESET in the top right, then IMPORT at the bottom, and finally select this file.</em>
    </p>
    <div class="mod-list">
      <table>
${modRows}      </table>
    </div>
    <div class="dlc-list">
${dlcTable}    </div>
    <div class="footer">
      <span>Created by Arma 3 Launcher by Bohemia Interactive.</span>
    </div>
  </body>
</html>`;

  return "﻿" + html.replace(/\r?\n/g, "\r\n");
}

function serializeModRow(mod: Mod): string {
  let sourceLabel: string;
  let link: string;
  if (mod.source === "steam" && mod.steamId) {
    const url = steamUrl(mod.steamId);
    sourceLabel = `<span class="from-steam">Steam</span>`;
    link = `<a href="${url}" data-type="Link">${url}</a>`;
  } else {
    const attrs = Object.entries(mod.localLink ?? { "data-type": "Link" })
      .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
      .join("");
    sourceLabel = `<span class="from-local">Local</span>`;
    link = `<span${attrs} />`;
  }
  return `        <tr data-type="ModContainer">
          <td data-type="DisplayName">${escapeXml(mod.name)}</td>
          <td>
            ${sourceLabel}
          </td>
          <td>
            ${link}
          </td>
        </tr>
`;
}

function serializeDlcRow(dlc: Dlc): string {
  const url = escapeXml(dlc.url ?? "");
  return `        <tr data-type="DlcContainer">
          <td data-type="DisplayName">${escapeXml(dlc.name)}</td>
          <td>
            <a href="${url}" data-type="Link">${url}</a>
          </td>
        </tr>
`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Copied verbatim from a launcher export, including its stray trailing tab.
const LAUNCHER_STYLE = `body {
	margin: 0;
	padding: 0;
	color: #fff;
	background: #000;\t
}

body, th, td {
	font: 95%/1.3 Roboto, Segoe UI, Tahoma, Arial, Helvetica, sans-serif;
}

td {
    padding: 3px 30px 3px 0;
}

h1 {
    padding: 20px 20px 0 20px;
    color: white;
    font-weight: 200;
    font-family: segoe ui;
    font-size: 3em;
    margin: 0;
}

em {
    font-variant: italic;
    color:silver;
}

.before-list {
    padding: 5px 20px 10px 20px;
}

.mod-list {
    background: #222222;
    padding: 20px;
}

.dlc-list {
    background: #222222;
    padding: 20px;
}

.footer {
    padding: 20px;
    color:gray;
}

.whups {
    color:gray;
}

a {
    color: #D18F21;
    text-decoration: underline;
}

a:hover {
    color:#F1AF41;
    text-decoration: none;
}

.from-steam {
    color: #449EBD;
}
.from-local {
    color: gray;
}

`;
