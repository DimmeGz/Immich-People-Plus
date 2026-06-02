# Immich People Plus API

Sidecar service for extended person metadata keyed by Immich person UUIDs.

## Features

- Person card metadata (`birth_year`, `birth_month`, `birth_day`, `notes`)
- Multiple social links per person (`social` JSON array)
- Tags and person-to-tag mapping
- Bulk lookup and merge helpers for extension filters
- API key authentication via `X-API-Key`

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

## Run with Docker

The image uses Debian slim so `better-sqlite3` can install from prebuilt binaries (no `apk`/`apt` build tools during a normal build). If `npm ci` fails with `node-gyp`, add to the builder stage: `apt-get update && apt-get install -y python3 make g++`.

```bash
cp .env.example .env
docker compose up -d --build
```

## Endpoints

- `GET /health` (public)
- `GET /persons/:id`
- `PUT /persons/:id`
- `DELETE /persons/:id`
- `PUT /persons/:id/tags`
- `GET /persons/bulk/list?ids=id1,id2`
- `POST /persons/merge`
- `GET /persons/by-tag/:tagId`
- `GET /tags`
- `POST /tags`
- `DELETE /tags/:id`

All endpoints except `/health` require `X-API-Key: <API_KEY>`.
