import fs from 'node:fs';
import path from 'node:path';
import { db } from './connection.js';

const migrationsDir = path.resolve(process.cwd(), 'migrations');

db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`);

const applied = new Set(
  db.prepare('SELECT id FROM _migrations').all().map((row) => (row as { id: string }).id),
);

const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));

for (const file of files) {
  if (applied.has(file)) {
    continue;
  }

  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const transaction = db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(file);
  });

  transaction();
  console.log(`[immich-people-plus-api] applied migration ${file}`);
}

export {};
