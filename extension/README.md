# Chrome extension

Content scripts that add optional features to a self-hosted Immich web UI.

## Features

### People page sorting (`/people`)

Adds **Tag** (optional, requires Person API) and **Sort** dropdowns to the people list header:

- **Tag → All tags** — show everyone (Immich default when Sort is also Default)
- **Tag → …** — show only people assigned that tag in Person API
- **Sort → Default** — Immich's built-in order (unchanged when no tag filter)
- **Sort → Name A→Z / Z→A** — custom grid sorted by name

Tag and sort can be combined: filter by tag first, then apply name order on the custom grid.

Unnamed people are placed at the end when name sorting is active. Your choices are saved in extension storage and restored on the next visit.

When switching back to **Default** sort with **All tags**, the page reloads to restore Immich's original grid and infinite scroll.

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
