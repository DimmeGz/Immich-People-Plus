# Immich People Plus API

Sidecar service for extended person metadata keyed by Immich person UUIDs.

## Features

- Person card metadata (`birth_year`, `birth_month`, `birth_day`, `notes`)
- Multiple social links per person (`social` JSON array)
- Tags and person-to-tag mapping
- Bulk lookup and merge helpers for extension filters
- API key authentication via `X-API-Key`
- Two interchangeable storages: SQLite (default) or Postgres, with copy/verify tools to move between them

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Variables are read from the process environment only. Locally either export them
(`set -a && . ./.env && set +a`) or pass `.env` to Node: `node --env-file=.env --import tsx src/index.ts`.
Inside Docker, compose supplies them from `.env`.

## Run with Docker

Multi-stage image on `node:22-alpine`: native modules (`better-sqlite3`) are built in the builder stage with `python3`, `make`, and `g++`; the runtime stage contains only the app and dependencies.

```bash
cp .env.example .env
docker compose up -d --build
```

The compose file joins the Immich docker network (`IMMICH_NETWORK`, default `immich_default`) so
`DATABASE_URL` can name the Immich Postgres container directly. The network must already exist:
`docker network ls | grep immich`.

## Storage

| Variable        | Default            | Meaning                                                        |
| --------------- | ------------------ | -------------------------------------------------------------- |
| `DB_DRIVER`     | `sqlite`           | Storage used by the HTTP API: `sqlite` or `postgres`           |
| `DATABASE_PATH` | `./data/person.db` | SQLite file (inside the container `./data` is the volume)      |
| `DATABASE_URL`  | —                  | Postgres connection string, required when `DB_DRIVER=postgres` |

Both drivers implement the same repository interface (`src/db/repository.ts`); the HTTP contract does
not depend on the driver. `GET /health` reports which one is active.

### SQLite

`migrations/*.sql` are applied at startup (table `_migrations`). WAL mode, foreign keys on.

### Postgres

All tables live in schema `people` of the database named by `DATABASE_URL`. Migrations are
embedded in `src/db/postgres.ts` and applied at startup (table `people.schema_migration`). Tables
mirror the SQLite ones:

- `people.person` — `id uuid`, `birth_year/birth_month/birth_day integer` with range checks
  (1800..3000, 1..12, 1..31), `notes text`, `social jsonb`, `created_at/updated_at timestamptz`
- `people.tag` — `id uuid`, `name text unique` (case-sensitive, like SQLite), `color text`, timestamps
- `people.person_tag` — `(person_id, tag_id)` primary key, both `on delete cascade`, indexed

Next to Immich, `DATABASE_URL` points at the `immeyes` database in the Immich Postgres, e.g.
`postgres://immeyes:…@immich_postgres:5432/immeyes`. The `immeyes` role owns that database, so no
extra grants are needed: the service creates the schema itself on first start. Should the database
not exist yet:

```sql
create role immeyes login password '…';
create database immeyes owner immeyes;
```

Apply migrations without starting the server: `npm run migrate` (uses `DB_DRIVER`, or `--driver postgres`).

## Backup

Before any migration or upgrade take at least one of these. The SQLite file is the source of truth
until you switch `DB_DRIVER`; keep it even after switching.

```bash
# 1. raw copy of the file (stop the container first so the WAL is checkpointed)
docker compose stop
cp data/person.db data/person.db.bak-$(date +%F)

# 2. SQL dump (needs the sqlite3 CLI)
sqlite3 data/person.db .dump > data/person-$(date +%F).sql

# 3. JSON export of all three tables through the app (any driver)
npm run export                      # -> ./data/export-<timestamp>.json
npm run export -- ./backup.json
docker compose run --rm immich-people-plus-api npm run export   # inside the container
```

A JSON export can be restored into either driver with `npm run copy -- --from <file> --to sqlite|postgres`.

## Tools

All tools read `DATABASE_PATH` and `DATABASE_URL` from the environment and ignore `DB_DRIVER`
(except `export`/`migrate`, which default to it). Inside Docker prefix the command with
`docker compose run --rm immich-people-plus-api`.

| Command                                                   | What it does                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run export [-- path] [-- --driver postgres]`         | Writes `person`, `tag`, `person_tag` to one JSON file                                                    |
| `npm run copy -- --from sqlite --to postgres`             | Upserts every row of the source into the target in one transaction. Idempotent.                          |
| `npm run copy -- --from postgres --to sqlite`             | Same, the other way round                                                                                |
| `npm run copy -- --from ./data/export-….json --to sqlite` | Restore a JSON export                                                                                    |
| `… --prune`                                               | Also delete target rows that are absent from the source, so the target becomes an exact mirror           |
| `… --allow-empty`                                         | Needed to copy from a source with no rows at all (guards against copying from the wrong, empty database) |
| `npm run verify`                                          | Compares SQLite and Postgres row by row; exit code 1 and a list of differences when they differ          |
| `npm run verify -- --left sqlite --right ./export.json`   | Either side can also be a JSON export                                                                    |
| `npm run migrate [-- --driver postgres]`                  | Apply pending migrations and exit                                                                        |

`copy` validates every source row before writing anything: `social` that is not valid JSON, a
timestamp in an unknown format, an id that is not a UUID or a birth part outside the Postgres
check ranges stops the copy with a list of the offending rows. Nothing is skipped silently.

`verify` normalises before comparing: `social` as parsed JSON with sorted keys (jsonb reorders
keys), timestamps as instants (SQLite holds both `2024-05-01T12:34:56.789Z` from the app and
`2024-05-01 12:34:56` from the `CURRENT_TIMESTAMP` default, both UTC), ids lower-cased.

## Switching from SQLite to Postgres

1. Back up (see above).
2. Set `DATABASE_URL` in `.env` (keep `DB_DRIVER=sqlite` for now) and rebuild so the image has
   the tools: `docker compose build`.
3. Stop the API so nothing writes to SQLite during the copy: `docker compose stop`.
4. Copy and verify:

   ```bash
   docker compose run --rm immich-people-plus-api npm run copy -- --from sqlite --to postgres
   docker compose run --rm immich-people-plus-api npm run verify
   ```

   `verify` must print `OK: both storages hold the same rows`. If it lists differences, fix the
   cause and re-run `copy` (it is idempotent); `--prune` makes Postgres an exact mirror.
5. Set `DB_DRIVER=postgres` in `.env` and start: `docker compose up -d`.
6. `curl http://localhost:3001/health` → `{"ok":true,"driver":"postgres"}`.

Leave the SQLite file and its volume in place. It is the rollback target and is not touched by the
Postgres driver.

## Rolling back to SQLite

1. `docker compose stop`
2. Copy the Postgres rows back over SQLite. With `--prune` rows deleted while on Postgres are also
   removed from SQLite; without it they would reappear.

   ```bash
   docker compose run --rm immich-people-plus-api npm run copy -- --from postgres --to sqlite --prune
   docker compose run --rm immich-people-plus-api npm run verify
   ```

3. Set `DB_DRIVER=sqlite` in `.env` and `docker compose up -d`.

The Postgres schema `people` is left as is; drop it manually if you no longer need it
(`drop schema people cascade;` in the `immeyes` database).

## Manual checklist

Run against a fresh database with `API_KEY=test`, e.g. `API_KEY=test DATABASE_PATH=/tmp/t.db npm start`.
Expected status codes in brackets; `<tag>` is the id returned by the first `POST /tags`.

```bash
H='-H X-API-Key:test -H Content-Type:application/json'
curl -s localhost:3001/persons/11111111-1111-4111-8111-111111111111 $H                   # [404]
curl -s -XPOST localhost:3001/tags $H -d '{"name":"Family","color":"#f00"}'               # [201] {id,name,color}
curl -s -XPOST localhost:3001/tags $H -d '{"name":"Family"}'                              # [409]
curl -s localhost:3001/tags $H                                                            # [200] sorted case-insensitively
curl -s -XPUT localhost:3001/persons/11111111-1111-4111-8111-111111111111 $H \
  -d '{"birthYear":1990,"birthMonth":5,"birthDay":17,"notes":" hi ","social":[{"url":"https://x.com/a","label":"X"},{"url":"ftp://no"}]}'
                                                                                          # [200] notes trimmed, ftp link dropped
curl -s -XPUT localhost:3001/persons/11111111-1111-4111-8111-111111111111 $H -d '{"birthYear":1700}'   # [400]
curl -s -XPUT localhost:3001/persons/11111111-1111-4111-8111-111111111111/tags $H -d '{"tagIds":["<tag>"]}'  # [200] {tags:[…]}
curl -s -XPUT localhost:3001/persons/22222222-2222-4222-8222-222222222222/tags $H -d '{"tagIds":["<tag>"]}'  # [200] card created
curl -s "localhost:3001/persons/bulk/list?ids=11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222" $H  # [200] 2 persons
curl -s localhost:3001/persons/by-tag/<tag> $H                                            # [200] both ids, sorted
curl -s -XPOST localhost:3001/persons/merge $H \
  -d '{"into":"22222222-2222-4222-8222-222222222222","from":["11111111-1111-4111-8111-111111111111"]}'
                                                                                          # [200] merged card; source gone (next line 404)
curl -s localhost:3001/persons/11111111-1111-4111-8111-111111111111 $H                   # [404]
curl -s -XDELETE localhost:3001/tags/<tag> $H                                             # [200]; again → [404]
curl -s -XDELETE localhost:3001/persons/22222222-2222-4222-8222-222222222222 $H          # [200]; GET → [404]
curl -s localhost:3001/tags                                                               # [401] without key
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
