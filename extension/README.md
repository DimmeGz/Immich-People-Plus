# Chrome extension

Content scripts that add optional features to a self-hosted Immich web UI.

## Features

### People page sorting (`/people`)

Adds a **Sort** dropdown to the people list header:

- **Default** — Immich's built-in order (unchanged)
- **Name A→Z** — custom grid sorted by name
- **Name Z→A** — reverse name sort

Unnamed people are placed at the end. Your choice is saved in extension storage and restored on the next visit.

When switching back to **Default**, the page reloads to restore Immich's original grid and infinite scroll.

### Folder people filter (`/folders?path=...`)

When you open a folder with direct photo files (not subfolders), a **People** bar appears above the gallery:

- **Person chips** — avatar, name, and photo count in this folder
- **Other photos** — photos without assigned people
- **Tag chips** — optional, if person-api is configured
- **Show all** — resets the filter

Active filters render a custom justified gallery for matching photos. The filter bar and gallery state are preserved when you open and close a photo in the folder viewer.

The bar is shown only when the URL has a `path` query parameter and the folder has at least one recognized person or one “other” photo.

### Person card (`/people/{id}`) — optional

On a **person’s photo page** (`/people/<uuid>`), a **Person card** link appears on the same row as the Immich avatar and name (right side). Clicking it opens a modal with:

If Person API is configured, the modal includes:

- birth year / month / day
- notes
- multiple social links (label + URL)
- tag assignment (create tags with **Add tag** if none exist yet)

If Person API is not configured or unavailable, the extension keeps working without this panel.

## Person API settings

Open `chrome://extensions` → Immich People Plus → **Details** → **Extension options** and set:

- Person API base URL (e.g. `http://localhost:3001`)
- API key (`X-API-Key`)

This integration is optional. Existing features work without it.

## Install (development)

From the repository root:

```bash
cd extension
npm install
npm run build
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the **`extension/dist/`** folder

## Development

```bash
cd extension
npm run watch
```

After changes, click **Reload** on the extension card in `chrome://extensions`, then refresh the Immich tab.

**Note:** After reloading the extension, refresh any open Immich tabs to avoid “Extension context invalidated” errors.

## Project layout

```
extension/
  src/content/     Content scripts (people sort, folder filter)
  src/content.css  Injected styles
  dist/            Load this folder in Chrome
  manifest.json    Copied to dist on build
```
