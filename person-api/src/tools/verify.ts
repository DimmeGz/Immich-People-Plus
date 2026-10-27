/**
 * Compare two storages row by row and exit 1 on any difference.
 *
 *   npm run verify                                   (sqlite vs postgres)
 *   npm run verify -- --left sqlite --right ./data/export-....json
 *
 * Normalisation before comparing: ids lower-cased, `social` compared as parsed JSON with sorted
 * keys, timestamps compared as instants (SQLite's ISO and `YYYY-MM-DD HH:MM:SS` forms are both UTC).
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { canonicalJson, parseStoredTimestamp } from '../db/normalize.js';
import type { PersonRow, PersonTagRow, Snapshot, TagRow } from '../db/repository.js';
import { describeSnapshot, fail, isDriver, openSource, readExportFile } from './common.js';

type Comparable = Record<string, string | number | null>;

async function load(name: string): Promise<Snapshot> {
  if (isDriver(name)) {
    const repository = await openSource(name);
    try {
      return await repository.exportAll();
    } finally {
      await repository.close();
    }
  }
  if (!fs.existsSync(name)) {
    fail(`no such driver or file: ${name}`);
  }
  return readExportFile(name).tables;
}

function timestamp(value: string): string {
  const date = parseStoredTimestamp(value);
  return date ? date.toISOString() : `<unparsable> ${JSON.stringify(value)}`;
}

function social(value: string): string {
  try {
    return canonicalJson(JSON.parse(value));
  } catch {
    return `<invalid json> ${JSON.stringify(value)}`;
  }
}

function comparablePerson(row: PersonRow): Comparable {
  return {
    birth_year: row.birth_year,
    birth_month: row.birth_month,
    birth_day: row.birth_day,
    notes: row.notes,
    social: social(row.social),
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  };
}

function comparableTag(row: TagRow): Comparable {
  return {
    name: row.name,
    color: row.color,
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  };
}

function personTagKey(row: PersonTagRow): string {
  return `${row.person_id.toLowerCase()}/${row.tag_id.toLowerCase()}`;
}

type Side = { name: string; rows: Snapshot };

function compareTable<T>(
  table: string,
  left: Side,
  right: Side,
  pick: (snapshot: Snapshot) => T[],
  key: (row: T) => string,
  comparable: (row: T) => Comparable,
  differences: string[],
): void {
  const leftMap = new Map(pick(left.rows).map((row) => [key(row), row]));
  const rightMap = new Map(pick(right.rows).map((row) => [key(row), row]));

  for (const [id, leftRow] of leftMap) {
    const rightRow = rightMap.get(id);
    if (!rightRow) {
      differences.push(`${table} ${id}: only in ${left.name}`);
      continue;
    }
    const a = comparable(leftRow);
    const b = comparable(rightRow);
    for (const field of Object.keys(a)) {
      if (a[field] !== b[field]) {
        differences.push(
          `${table} ${id}.${field}: ${left.name}=${JSON.stringify(a[field])} ${right.name}=${JSON.stringify(b[field])}`,
        );
      }
    }
  }

  for (const id of rightMap.keys()) {
    if (!leftMap.has(id)) {
      differences.push(`${table} ${id}: only in ${right.name}`);
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      left: { type: 'string', default: 'sqlite' },
      right: { type: 'string', default: 'postgres' },
    },
  });

  const left: Side = { name: values.left ?? 'sqlite', rows: await load(values.left ?? 'sqlite') };
  const right: Side = { name: values.right ?? 'postgres', rows: await load(values.right ?? 'postgres') };

  console.log(`${left.name}: ${describeSnapshot(left.rows)}`);
  console.log(`${right.name}: ${describeSnapshot(right.rows)}`);

  const differences: string[] = [];
  compareTable('person', left, right, (s) => s.person, (row) => row.id.toLowerCase(), comparablePerson, differences);
  compareTable('tag', left, right, (s) => s.tag, (row) => row.id.toLowerCase(), comparableTag, differences);
  compareTable('person_tag', left, right, (s) => s.person_tag, personTagKey, () => ({}), differences);

  if (differences.length > 0) {
    console.error(`${differences.length} difference(s):`);
    for (const line of differences) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }

  console.log('OK: both storages hold the same rows');
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
