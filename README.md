# Arma 3 Preset Merger

**Live:** https://eludage.github.io/arma3-preset-merger/

Many Arma 3 groups have a required **base modpack** plus a list of allowed **client-side mods**
that every player picks individually. Each time the base modpack changes, every player has to add
their client-side mods to the new preset again. This tool does that for you.

## Usage

1. Export your presets from the Arma 3 Launcher: **MODS → PRESET → select a preset → EXPORT**.
2. **Find your client-side mods:** upload the base modpack and your own preset (base modpack plus
   your client-side mods). The tool lists the difference and can download it as a preset containing
   only your client-side mods.
3. **Apply them to a new base modpack:** upload the new base modpack and download a preset with the
   new base plus your client-side mods.
4. Import the downloaded file in the launcher: drag it onto the launcher window, or
   **MODS → PRESET → IMPORT**.

Your client-side mods are remembered in your browser, so after the next base modpack update you
only need to upload the new base modpack.

If you already have a preset that contains only your client-side mods, upload it as "Your preset"
and leave "Base modpack" empty.

### Checking against a Steam Workshop collection

Some groups publish their allowed client-side mods as a Steam Workshop collection. Turn on
**Check against …** below your client-side mods to list every mod that is not part of the
collection. The available collections are configured in
[`collections.config.json`](collections.config.json); pull requests for other groups are welcome.

Steam's API cannot be called from the browser (no CORS), so
[`scripts/update-collections.mjs`](scripts/update-collections.mjs) downloads the collections at
build time into `public/collections/`. The site is rebuilt daily, so changes to a collection show
up within a day.

### What the tool takes care of

- Mods are matched by their Steam Workshop ID, so renamed mods are still recognized.
- Client-side mods that became part of the new base modpack are not added twice.
- Base modpack mods missing from your preset are reported (they stay required).
- DLCs and local mods are carried over.
- The generated file uses the exact format of the launcher's own export.

### Privacy

Everything runs in your browser. Preset files are never uploaded to a server.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev      # start the dev server
npm test         # run the unit tests
npm run build    # build the static site into dist/
npm run update-collections   # refresh the Steam Workshop collection snapshots
```

The core logic (parsing, diffing, merging and writing presets) lives in
[`src/preset.ts`](src/preset.ts) and is independent of the UI in [`src/main.ts`](src/main.ts).
The tests use real launcher exports from [`tests/fixtures/`](tests/fixtures/).

### Deployment

Every push to `main` is tested, built and deployed to GitHub Pages by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). In the repository settings, set
**Pages → Build and deployment → Source** to **GitHub Actions**.

## License

[MIT](LICENSE). Not affiliated with Bohemia Interactive.
