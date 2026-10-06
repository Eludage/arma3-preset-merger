/**
 * Steam Workshop collections that client-side mods can be checked against.
 *
 * Steam's API does not allow cross-origin requests, so the collections are downloaded at build time
 * by scripts/update-collections.mjs and served as JSON snapshots from public/collections/.
 */

import config from "../collections.config.json";
import type { Mod } from "./preset";

export interface CollectionConfig {
  id: string;
  label: string;
  collectionId: string;
}

export interface CollectionSnapshot extends CollectionConfig {
  title: string;
  updatedAt: string;
  items: { id: string; name: string }[];
}

export const collections: CollectionConfig[] = config;

export async function loadCollection(id: string): Promise<CollectionSnapshot> {
  const response = await fetch(`${import.meta.env.BASE_URL}collections/${id}.json`);
  if (!response.ok) throw new Error(`Could not load collection "${id}" (HTTP ${response.status})`);
  return (await response.json()) as CollectionSnapshot;
}

/** Returns the mods that are not part of the collection. Local mods can never be part of one. */
export function modsNotInCollection(mods: Mod[], collection: Pick<CollectionSnapshot, "items">): Mod[] {
  const ids = new Set(collection.items.map((item) => item.id));
  return mods.filter((mod) => !mod.steamId || !ids.has(mod.steamId));
}

export function collectionUrl(collection: CollectionConfig): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${collection.collectionId}`;
}
