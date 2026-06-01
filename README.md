# Immich Extension

Chrome extension that adds optional features to a self-hosted [Immich](https://immich.app/) instance.

## Features

### People page sorting (`/people`)

Adds a **Sort** dropdown to the people list header:

- **Default** — Immich's built-in order (unchanged)
- **Name A→Z** — sort visible people by name
- **Name Z→A** — reverse name sort

Unnamed people are placed at the end. Your choice is saved in extension storage and restored on the next visit.

When switching back to **Default**, the page reloads to restore Immich's original order and infinite scroll behavior.

### Folder people filter (`/folders?path=...`)

When you open a folder that contains photos (direct files only, not subfolders), a **People** bar appears above the gallery:

- **Person chips** — avatar, name, and photo count in this folder; click to show only their photos
- **Other photos** — photos without assigned people (landscapes, unassigned faces, etc.)
- **Show all** — appears when a filter is active; resets the gallery

Filtering hides non-matching thumbnails in the gallery. Because Immich uses a fixed justified layout, empty gaps may remain where hidden photos were.

The filter bar is shown only when:

- the URL contains a `path` query parameter, and
- the folder has photos, and
- there is at least one recognized person or at least one “other” photo

## Install (development)

1. Build the extension:

```bash
npm install
npm run build
```

2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `dist/` folder

## Development

```bash
npm run watch
```

After changes, click **Reload** on the extension card in `chrome://extensions`, then refresh the Immich tab.

**Note:** After reloading the extension, refresh any open Immich tabs to avoid “Extension context invalidated” errors.

## Requirements

- A running Immich instance (any self-hosted URL)
- You must be logged in — the extension uses your existing Immich session cookies

## Project layout

```
src/content/     Content scripts (people sort, folder filter)
dist/            Load this folder in Chrome
manifest.json    Extension manifest (copied to dist on build)
```
