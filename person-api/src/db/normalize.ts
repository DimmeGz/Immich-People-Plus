import type { PersonRow, PersonTagRow, Snapshot, TagRow } from './repository.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a timestamp as stored by either driver. SQLite holds two formats, both UTC:
 * ISO-8601 from `nowIso()` (`2024-05-01T12:34:56.789Z`) and `YYYY-MM-DD HH:MM:SS` from the
 * `CURRENT_TIMESTAMP` column default. Postgres rows are exported as ISO-8601.
 * Returns null when the text is not one of those.
 */
export function parseStoredTimestamp(text: string): Date | null {
  if (typeof text !== 'string') {
    return null;
  }

  const value = text.trim();
  let candidate: string | null = null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    candidate = value;
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(value)) {
    candidate = `${value.replace(' ', 'T')}Z`;
  }

  if (!candidate) {
    return null;
  }

  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** JSON.stringify with object keys sorted recursively, so jsonb re-ordering does not count as a change. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
}

export type Problem = { table: keyof Snapshot; key: string; field: string; message: string };

/**
 * Check that every row can be stored by either driver: ids are UUIDs, `social` is valid JSON,
 * timestamps parse, birth parts fit the Postgres check constraints.
 */
export function validateSnapshot(snapshot: Snapshot): Problem[] {
  const problems: Problem[] = [];

  for (const row of snapshot.person) {
    const key = row.id;
    if (!UUID_RE.test(row.id)) {
      problems.push({ table: 'person', key, field: 'id', message: 'not a UUID' });
    }
    try {
      JSON.parse(row.social);
    } catch (error) {
      problems.push({ table: 'person', key, field: 'social', message: `invalid JSON: ${(error as Error).message}` });
    }
    checkTimestamp(problems, 'person', key, 'created_at', row.created_at);
    checkTimestamp(problems, 'person', key, 'updated_at', row.updated_at);
    checkRange(problems, key, 'birth_year', row.birth_year, 1800, 3000);
    checkRange(problems, key, 'birth_month', row.birth_month, 1, 12);
    checkRange(problems, key, 'birth_day', row.birth_day, 1, 31);
  }

  for (const row of snapshot.tag) {
    const key = row.id;
    if (!UUID_RE.test(row.id)) {
      problems.push({ table: 'tag', key, field: 'id', message: 'not a UUID' });
    }
    if (typeof row.name !== 'string' || row.name.length === 0) {
      problems.push({ table: 'tag', key, field: 'name', message: 'empty' });
    }
    checkTimestamp(problems, 'tag', key, 'created_at', row.created_at);
    checkTimestamp(problems, 'tag', key, 'updated_at', row.updated_at);
  }

  const personIds = new Set(snapshot.person.map((row) => row.id.toLowerCase()));
  const tagIds = new Set(snapshot.tag.map((row) => row.id.toLowerCase()));

  for (const row of snapshot.person_tag) {
    const key = `${row.person_id}/${row.tag_id}`;
    if (!UUID_RE.test(row.person_id)) {
      problems.push({ table: 'person_tag', key, field: 'person_id', message: 'not a UUID' });
    }
    if (!UUID_RE.test(row.tag_id)) {
      problems.push({ table: 'person_tag', key, field: 'tag_id', message: 'not a UUID' });
    }
    if (!personIds.has(row.person_id.toLowerCase())) {
      problems.push({ table: 'person_tag', key, field: 'person_id', message: 'no such person in the snapshot' });
    }
    if (!tagIds.has(row.tag_id.toLowerCase())) {
      problems.push({ table: 'person_tag', key, field: 'tag_id', message: 'no such tag in the snapshot' });
    }
  }

  return problems;
}

function checkTimestamp(problems: Problem[], table: keyof Snapshot, key: string, field: string, value: string): void {
  if (!parseStoredTimestamp(value)) {
    problems.push({ table, key, field, message: `unrecognised timestamp: ${JSON.stringify(value)}` });
  }
}

function checkRange(problems: Problem[], key: string, field: string, value: number | null, min: number, max: number): void {
  if (value === null) {
    return;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push({ table: 'person', key, field, message: `${value} is outside ${min}..${max}` });
  }
}

/**
 * Canonical form of a snapshot: ids lower-cased, `social` re-serialised with sorted keys,
 * timestamps as ISO-8601 UTC. Only valid for a snapshot that passed validateSnapshot.
 * Copy writes this form; verify compares this form.
 */
export function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  const person: PersonRow[] = snapshot.person.map((row) => ({
    id: row.id.toLowerCase(),
    birth_year: row.birth_year,
    birth_month: row.birth_month,
    birth_day: row.birth_day,
    notes: row.notes,
    social: canonicalJson(JSON.parse(row.social)),
    created_at: parseStoredTimestamp(row.created_at)!.toISOString(),
    updated_at: parseStoredTimestamp(row.updated_at)!.toISOString(),
  }));

  const tag: TagRow[] = snapshot.tag.map((row) => ({
    id: row.id.toLowerCase(),
    name: row.name,
    color: row.color,
    created_at: parseStoredTimestamp(row.created_at)!.toISOString(),
    updated_at: parseStoredTimestamp(row.updated_at)!.toISOString(),
  }));

  const person_tag: PersonTagRow[] = snapshot.person_tag.map((row) => ({
    person_id: row.person_id.toLowerCase(),
    tag_id: row.tag_id.toLowerCase(),
  }));

  return { person, tag, person_tag };
}

export function formatProblems(problems: Problem[]): string {
  return problems.map((p) => `  ${p.table} ${p.key} ${p.field}: ${p.message}`).join('\n');
}
