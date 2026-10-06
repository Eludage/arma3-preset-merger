// Downloads the Steam Workshop collections listed in collections.config.json and writes
// one JSON file per collection to public/collections/. Steam's API does not allow
// cross-origin requests, so the site cannot query it directly and uses these snapshots.
//
// Usage: node scripts/update-collections.mjs [--keep-on-error]
//   --keep-on-error  keep the existing snapshot instead of failing when Steam is unreachable

import { readFile, writeFile } from "node:fs/promises";

const API = "https://api.steampowered.com/ISteamRemoteStorage";
const COLLECTION_FILE_TYPE = 2;
const keepOnError = process.argv.includes("--keep-on-error");

const config = JSON.parse(await readFile(new URL("../collections.config.json", import.meta.url), "utf-8"));

async function post(method, params) {
  const response = await fetch(`${API}/${method}/v1/`, { method: "POST", body: new URLSearchParams(params) });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  return (await response.json()).response;
}

function idParams(ids, countKey) {
  const params = { [countKey]: String(ids.length) };
  ids.forEach((id, i) => (params[`publishedfileids[${i}]`] = id));
  return params;
}

/** Returns the IDs of all items in a collection, following nested collections. */
async function collectionItems(collectionId, seen = new Set()) {
  seen.add(collectionId);
  const { collectiondetails } = await post("GetCollectionDetails", idParams([collectionId], "collectioncount"));
  const details = collectiondetails?.[0];
  if (details?.result !== 1) throw new Error(`Collection ${collectionId} not found or not public`);

  const ids = [];
  for (const child of details.children ?? []) {
    if (child.filetype === COLLECTION_FILE_TYPE) {
      if (!seen.has(child.publishedfileid)) ids.push(...(await collectionItems(child.publishedfileid, seen)));
    } else {
      ids.push(child.publishedfileid);
    }
  }
  return [...new Set(ids)];
}

async function fileTitles(ids) {
  const titles = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { publishedfiledetails } = await post("GetPublishedFileDetails", idParams(batch, "itemcount"));
    for (const file of publishedfiledetails ?? []) titles.set(file.publishedfileid, file.title ?? "");
  }
  return titles;
}

let failed = false;
for (const entry of config) {
  const target = new URL(`../public/collections/${entry.id}.json`, import.meta.url);
  try {
    const ids = await collectionItems(entry.collectionId);
    const titles = await fileTitles([entry.collectionId, ...ids]);
    const snapshot = {
      id: entry.id,
      label: entry.label,
      collectionId: entry.collectionId,
      title: titles.get(entry.collectionId) ?? "",
      updatedAt: new Date().toISOString(),
      items: ids.map((id) => ({ id, name: titles.get(id) ?? "" })),
    };
    await writeFile(target, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`${entry.id}: ${ids.length} items`);
  } catch (err) {
    console.error(`${entry.id}: ${err.message}`);
    if (!keepOnError) failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
