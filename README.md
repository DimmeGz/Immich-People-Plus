# Immich People Plus

Tools for a self-hosted [Immich](https://immich.app/) instance: a Chrome extension and a sidecar person metadata API.

## Repository layout

```
extension/     Chrome extension (content scripts)
person-api/    Person cards, tags, and metadata API (SQLite)
```

## Chrome extension

Adds optional UI on top of Immich: people sorting, folder filtering by person, an age filter for the main timeline and links to Immeyes.

See [extension/README.md](extension/README.md) for features, install, and development.

Quick start:

```bash
cd extension
npm install
npm run build
```

Load **`extension/dist/`** as an unpacked extension in Chrome (`chrome://extensions`).

## Person API (immich-people-plus-api)

The `person-api/` service stores extended person data (birth year/month/day, notes, multiple social links, tags) keyed by Immich person IDs.

Quick start:

```bash
cd person-api
npm install
cp .env.example .env
npm start
```

## Manual test checklist

- Start API and verify `GET /health` returns `ok: true`
- Open extension options and set Person API URL + API key
- On `/people`, use Tag and Sort dropdowns (tag filter needs Person API)
- On `/people/{id}`, edit person card fields and save
- On `/photos`, filter the timeline with **Вік від … до …** (needs birth dates), open a photo, reset; leave `/photos` and come back to the plain timeline
- Set **Immeyes URL** in the options and check the **Схожі персони** / **Порівняти** links on `/people/{id}`
- On `/folders?path=...`, use person and tag filters; try **Tag other photos** on a folder with unrecognized faces
- Open and close a photo viewer and confirm active filter persists
- Clear API settings and verify extension still works without person-api (the age filter still works with Immich birth dates)

The full step-by-step list is in [extension/README.md](extension/README.md#manual-test-checklist).

## Requirements

- A running self-hosted Immich instance
- You must be logged in to Immich in the browser — the extension uses your existing session cookies
