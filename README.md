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

After changes, click **Reload** on the extension card in `chrome://extensions`, then refresh Immich.

## Requirements

- A running Immich instance (any self-hosted URL)
- You must be logged in — the extension uses your existing Immich session cookies for `/api/people`

## Project layout

```
src/content/     Content script (people sort)
dist/            Load this folder in Chrome
manifest.json    Extension manifest (copied to dist on build)
```
