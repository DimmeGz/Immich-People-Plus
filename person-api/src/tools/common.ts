import fs from 'node:fs';
import path from 'node:path';
import type { DbDriver } from '../config.js';
import { openRepository } from '../db/index.js';
import type { PersonRepository, Snapshot } from '../db/repository.js';

export const EXPORT_FORMAT = 'immich-people-plus-export';

export type ExportFile = {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  driver: DbDriver;
  tables: Snapshot;
};

export function isDriver(value: string): value is DbDriver {
  return value === 'sqlite' || value === 'postgres';
}

/** Open a driver as a *source*: a missing SQLite file is an error, never an empty database. */
export function openSource(driver: DbDriver): Promise<PersonRepository> {
  return openRepository(driver, { sqlite: { mustExist: true } });
}

/** Open a driver as a *target*: a missing SQLite file is created (with a note). */
export function openTarget(driver: DbDriver, sqlitePath: string): Promise<PersonRepository> {
  if (driver === 'sqlite' && !fs.existsSync(sqlitePath)) {
    console.log(`creating new SQLite database ${sqlitePath}`);
  }
  return openRepository(driver);
}

export function readExportFile(filePath: string): ExportFile {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ExportFile>;

  if (raw.format !== EXPORT_FORMAT || raw.version !== 1 || !raw.tables) {
    throw new Error(`${filePath} is not a ${EXPORT_FORMAT} v1 file`);
  }

  for (const table of ['person', 'tag', 'person_tag'] as const) {
    if (!Array.isArray(raw.tables[table])) {
      throw new Error(`${filePath}: tables.${table} is missing`);
    }
  }

  return raw as ExportFile;
}

export function writeExportFile(filePath: string, file: ExportFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

export function describeSnapshot(snapshot: Snapshot): string {
  return `${snapshot.person.length} persons, ${snapshot.tag.length} tags, ${snapshot.person_tag.length} person-tag links`;
}

export function isEmptySnapshot(snapshot: Snapshot): boolean {
  return snapshot.person.length === 0 && snapshot.tag.length === 0 && snapshot.person_tag.length === 0;
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
