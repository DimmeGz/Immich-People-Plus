# Immich Extension

Tools for a self-hosted [Immich](https://immich.app/) instance: a Chrome extension and (planned) a person metadata API.

## Repository layout

```
extension/     Chrome extension (content scripts)
person-api/    Person cards, tags, and metadata API (planned)
```

## Chrome extension

Adds optional UI on top of Immich: people sorting and folder filtering by person.

See [extension/README.md](extension/README.md) for features, install, and development.

Quick start:

```bash
cd extension
npm install
npm run build
```

Load **`extension/dist/`** as an unpacked extension in Chrome (`chrome://extensions`).

## Person API

The `person-api/` service will store extended person data (birth year, notes, social links, tags) keyed by Immich person IDs. Not implemented yet.

## Requirements

- A running self-hosted Immich instance
- You must be logged in to Immich in the browser — the extension uses your existing session cookies
