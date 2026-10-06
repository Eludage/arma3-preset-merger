import "./style.css";
import {
  collections,
  collectionUrl,
  loadCollection,
  modsNotInCollection,
  type CollectionConfig,
  type CollectionSnapshot,
} from "./collections";
import {
  extractClientMods,
  mergePresets,
  modKey,
  parsePreset,
  serializePreset,
  steamUrl,
  type Dlc,
  type Mod,
  type Preset,
} from "./preset";

type Slot = "oldBase" | "player" | "newBase";

interface ClientMods {
  mods: Mod[];
  dlcs: Dlc[];
}

interface SavedClientMods extends ClientMods {
  savedAt: string;
}

const STORAGE_KEY = "arma3-preset-merger:client-mods";
const CHECKS_STORAGE_KEY = "arma3-preset-merger:collection-checks";

const presets: Partial<Record<Slot, Preset>> = {};
let saved = loadSaved();

/** IDs of the collections the client-side mods are checked against. */
const enabledChecks = loadEnabledChecks();
const loadedCollections = new Map<string, CollectionSnapshot | Error>();
const pendingCollections = new Set<string>();

const step1 = document.getElementById("step1-result")!;
const step2 = document.getElementById("step2-result")!;

for (const zone of document.querySelectorAll<HTMLLabelElement>(".drop-zone")) {
  setUpDropZone(zone, zone.dataset.slot as Slot);
}
render();

// ---------------------------------------------------------------------------
// File input

function setUpDropZone(zone: HTMLLabelElement, slot: Slot): void {
  const input = zone.querySelector("input")!;
  input.addEventListener("change", () => {
    if (input.files?.[0]) void loadFile(zone, slot, input.files[0]);
    input.value = "";
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragging");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragging");
    const file = e.dataTransfer?.files[0];
    if (file) void loadFile(zone, slot, file);
  });
}

async function loadFile(zone: HTMLLabelElement, slot: Slot, file: File): Promise<void> {
  const label = zone.querySelector(".drop-file")!;
  zone.classList.remove("loaded", "error");
  try {
    const preset = parsePreset(await file.text());
    presets[slot] = preset;
    zone.classList.add("loaded");
    label.textContent = `${preset.name || file.name} · ${preset.mods.length} mods`;
    clearButton(zone, slot);
  } catch (err) {
    delete presets[slot];
    zone.classList.add("error");
    label.textContent = err instanceof Error ? `${file.name}: ${err.message}` : `Could not read ${file.name}`;
  }
  render();
}

function clearButton(zone: HTMLLabelElement, slot: Slot): void {
  zone.querySelector(".drop-clear")?.remove();
  const button = h("button", { class: "drop-clear", type: "button", title: "Remove file" }, "×");
  button.addEventListener("click", (e) => {
    e.preventDefault();
    delete presets[slot];
    zone.classList.remove("loaded", "error");
    zone.querySelector(".drop-file")!.textContent = "Drop file or click to choose";
    button.remove();
    render();
  });
  zone.append(button);
}

// ---------------------------------------------------------------------------
// Client mods: from the uploaded presets, or saved in this browser

function currentClientMods(): { client: ClientMods; missingBaseMods: Mod[]; fromStorage: boolean } | undefined {
  const { oldBase, player } = presets;
  if (player) {
    if (!oldBase) {
      return { client: { mods: player.mods, dlcs: player.dlcs }, missingBaseMods: [], fromStorage: false };
    }
    const { clientMods, clientDlcs, missingBaseMods } = extractClientMods(oldBase, player);
    return { client: { mods: clientMods, dlcs: clientDlcs }, missingBaseMods, fromStorage: false };
  }
  if (saved) return { client: saved, missingBaseMods: [], fromStorage: true };
  return undefined;
}

function loadSaved(): SavedClientMods | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedClientMods) : undefined;
  } catch {
    return undefined;
  }
}

function save(client: ClientMods): void {
  saved = { ...client, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage unavailable (private mode, blocked site data): saving is a convenience only.
  }
}

function forgetSaved(): void {
  saved = undefined;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore, see save().
  }
}

function loadEnabledChecks(): Set<string> {
  try {
    const ids = JSON.parse(localStorage.getItem(CHECKS_STORAGE_KEY) ?? "[]") as string[];
    return new Set(ids.filter((id) => collections.some((c) => c.id === id)));
  } catch {
    return new Set();
  }
}

function saveEnabledChecks(): void {
  try {
    localStorage.setItem(CHECKS_STORAGE_KEY, JSON.stringify([...enabledChecks]));
  } catch {
    // Ignore, see save().
  }
}

// ---------------------------------------------------------------------------
// Collection checks

function collectionChecks(mods: Mod[]): HTMLElement {
  const container = h("div", { class: "checks" });
  for (const collection of collections) {
    const toggle = h("input", { type: "checkbox", role: "switch" });
    toggle.checked = enabledChecks.has(collection.id);
    toggle.addEventListener("change", () => {
      if (toggle.checked) enabledChecks.add(collection.id);
      else enabledChecks.delete(collection.id);
      saveEnabledChecks();
      render();
    });
    container.append(h("label", { class: "switch" }, toggle, h("span", {}, `Check against ${collection.label}`)));
    if (toggle.checked) container.append(collectionCheckResult(collection, mods));
  }
  return container;
}

function collectionCheckResult(collection: CollectionConfig, mods: Mod[]): HTMLElement {
  const loaded = loadedCollections.get(collection.id);
  if (!loaded) {
    if (!pendingCollections.has(collection.id)) {
      pendingCollections.add(collection.id);
      void loadCollection(collection.id)
        .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
        .then((result) => {
          pendingCollections.delete(collection.id);
          loadedCollections.set(collection.id, result);
          render();
        });
    }
    return h("p", { class: "note subtle" }, "Loading collection…");
  }
  if (loaded instanceof Error) {
    return h("div", { class: "callout warning" }, h("p", {}, loaded.message));
  }

  const link = h("a", { href: collectionUrl(collection), target: "_blank", rel: "noopener" }, loaded.title || collection.label);
  const source = h("p", { class: "source" }, "Steam collection ", link, ` (${loaded.items.length} mods, as of ${formatDate(loaded.updatedAt)})`);
  const outside = modsNotInCollection(mods, loaded);
  if (!outside.length) {
    return h("div", { class: "callout ok" }, h("p", {}, "All your client-side mods are in the collection."), source);
  }
  return h(
    "div",
    { class: "callout warning" },
    h("p", {}, `${outside.length} of your client-side mod(s) are not in the collection:`),
    modList(outside),
    source,
  );
}

// ---------------------------------------------------------------------------
// Rendering

function render(): void {
  const current = currentClientMods();
  if (current && !current.fromStorage) save(current.client);
  renderStep1(current);
  renderStep2(current?.client);
}

function renderStep1(current: ReturnType<typeof currentClientMods>): void {
  step1.replaceChildren();
  step1.hidden = !current;
  if (!current) return;

  const { client, missingBaseMods, fromStorage } = current;
  const { oldBase, player } = presets;

  if (fromStorage && saved) {
    const forget = h("button", { type: "button", class: "link-button" }, "Forget");
    forget.addEventListener("click", () => {
      forgetSaved();
      render();
    });
    step1.append(
      h("p", { class: "note" }, `Using ${countLabel(client)} saved in this browser on ${formatDate(saved.savedAt)}. `, forget),
    );
  } else if (player && !oldBase) {
    step1.append(
      h("p", { class: "note" }, "No base modpack given: all mods of your preset are treated as client-side mods."),
    );
  }

  if (missingBaseMods.length) {
    step1.append(
      warning(
        `Your preset is missing ${missingBaseMods.length} mod(s) of the base modpack. They are required, so they will be included again in step 2.`,
        missingBaseMods,
      ),
    );
  }

  step1.append(h("h3", {}, `Your client-side mods (${client.mods.length})`));
  if (client.mods.length) {
    step1.append(modList(client.mods));
  } else {
    step1.append(h("p", { class: "empty" }, "Your preset contains no mods besides the base modpack."));
  }
  if (client.dlcs.length) {
    step1.append(h("h3", {}, `Additional DLCs (${client.dlcs.length})`), dlcList(client.dlcs));
  }
  if (client.mods.length && collections.length) {
    step1.append(collectionChecks(client.mods));
  }
  if (!fromStorage) {
    step1.append(h("p", { class: "note subtle" }, "Saved in this browser, so next time you only need the new base modpack."));
  }

  const defaultName = `${player?.name || "Preset"}_ClientMods`;
  step1.append(downloadRow(defaultName, "Download client mods only", (name) => ({ name, ...client })));
}

function renderStep2(client: ClientMods | undefined): void {
  step2.replaceChildren();
  const { newBase, oldBase } = presets;
  step2.hidden = !newBase;
  if (!newBase) return;

  if (!client) {
    step2.append(h("p", { class: "empty" }, "Complete step 1 first to know which client-side mods to add."));
    return;
  }

  const { preset, alreadyInBase } = mergePresets(newBase, client, newBase.name);
  const added = preset.mods.length - newBase.mods.length;

  step2.append(
    h(
      "p",
      { class: "summary" },
      h("strong", {}, String(newBase.mods.length)),
      " base mods + ",
      h("strong", {}, String(added)),
      " client-side mods = ",
      h("strong", {}, String(preset.mods.length)),
      " mods",
    ),
  );

  if (alreadyInBase.length) {
    step2.append(
      info(`${alreadyInBase.length} of your client-side mod(s) are now part of the base modpack:`, alreadyInBase),
    );
  }

  if (oldBase) {
    const { clientMods: newInBase, missingBaseMods: removedFromBase } = extractClientMods(oldBase, newBase);
    const promoted = new Set(alreadyInBase.map(modKey));
    const reallyNew = newInBase.filter((m) => !promoted.has(modKey(m)));
    if (reallyNew.length || removedFromBase.length) {
      const details = h("details", { class: "changes" }, h("summary", {}, "What changed in the base modpack"));
      if (reallyNew.length) details.append(h("h4", {}, `Added (${reallyNew.length})`), modList(reallyNew));
      if (removedFromBase.length) details.append(h("h4", {}, `Removed (${removedFromBase.length})`), modList(removedFromBase));
      step2.append(details);
    }
  }

  step2.append(
    downloadRow(`${newBase.name}_Custom`, "Download new preset", (name) => ({ ...preset, name }), true),
  );
}

function downloadRow(defaultName: string, label: string, build: (name: string) => Preset, primary = false): HTMLElement {
  const input = h("input", { type: "text", value: defaultName, "aria-label": "Preset name", spellcheck: "false" });
  const button = h("button", { type: "button", class: primary ? "primary" : "secondary" }, label);
  button.addEventListener("click", () => {
    const name = input.value.trim() || defaultName;
    download(`Arma 3 Preset ${name}.html`, serializePreset(build(name)));
  });
  return h("div", { class: "download-row" }, h("label", {}, "Preset name", input), button);
}

function download(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
  const a = h("a", { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function modList(mods: Mod[]): HTMLElement {
  return h(
    "ul",
    { class: "mod-list" },
    ...mods.map((mod) =>
      h(
        "li",
        {},
        mod.steamId
          ? h("a", { href: steamUrl(mod.steamId), target: "_blank", rel: "noopener" }, mod.name)
          : h("span", {}, mod.name, h("span", { class: "tag" }, "local")),
      ),
    ),
  );
}

function dlcList(dlcs: Dlc[]): HTMLElement {
  return h("ul", { class: "mod-list" }, ...dlcs.map((dlc) => h("li", {}, dlc.name)));
}

function warning(text: string, mods: Mod[]): HTMLElement {
  return h("div", { class: "callout warning" }, h("p", {}, text), modList(mods));
}

function info(text: string, mods: Mod[]): HTMLElement {
  return h("div", { class: "callout info" }, h("p", {}, text), modList(mods));
}

function countLabel(client: ClientMods): string {
  const mods = `${client.mods.length} client-side mod${client.mods.length === 1 ? "" : "s"}`;
  return client.dlcs.length ? `${mods} and ${client.dlcs.length} DLC(s)` : mods;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Minimal element builder; strings become text nodes, so mod names are never parsed as HTML. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.append(...children);
  return el;
}
