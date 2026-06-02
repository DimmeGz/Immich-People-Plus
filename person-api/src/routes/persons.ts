import { Hono } from 'hono';
import { db } from '../db/connection.js';
import type { PersonCard, Tag } from '../types.js';
import { dedupeSocial, nowIso, parseSocial, toNumberOrNull } from '../utils.js';

type PersonRow = {
  id: string;
  birth_year: number | null;
  birth_month: number | null;
  birth_day: number | null;
  notes: string | null;
  social: string;
  created_at: string;
  updated_at: string;
};

function getPersonTags(personId: string): Tag[] {
  return db
    .prepare(
      `
        SELECT t.id, t.name, t.color
        FROM tag t
        INNER JOIN person_tag pt ON pt.tag_id = t.id
        WHERE pt.person_id = ?
        ORDER BY t.name COLLATE NOCASE ASC
      `,
    )
    .all(personId) as Tag[];
}

function mapPerson(row: PersonRow): PersonCard {
  return {
    id: row.id,
    birthYear: row.birth_year,
    birthMonth: row.birth_month,
    birthDay: row.birth_day,
    notes: row.notes,
    social: parseSocial(JSON.parse(row.social ?? '[]')),
    tags: getPersonTags(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getPersonById(id: string): PersonRow | undefined {
  return db.prepare('SELECT * FROM person WHERE id = ?').get(id) as PersonRow | undefined;
}

function validateDateParts(birthYear: number | null, birthMonth: number | null, birthDay: number | null): string | null {
  if (birthYear !== null && (birthYear < 1800 || birthYear > 3000)) {
    return 'birthYear must be between 1800 and 3000';
  }

  if (birthMonth !== null && (birthMonth < 1 || birthMonth > 12)) {
    return 'birthMonth must be between 1 and 12';
  }

  if (birthDay !== null && (birthDay < 1 || birthDay > 31)) {
    return 'birthDay must be between 1 and 31';
  }

  return null;
}

export const personsRouter = new Hono();

personsRouter.get('/bulk/list', (c) => {
  const idsParam = c.req.query('ids');

  if (!idsParam) {
    return c.json({ persons: [] });
  }

  const ids = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (ids.length === 0) {
    return c.json({ persons: [] });
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM person WHERE id IN (${placeholders})`)
    .all(...ids) as PersonRow[];

  return c.json({ persons: rows.map(mapPerson) });
});

personsRouter.post('/merge', async (c) => {
  const body = await c.req.json().catch(() => null);
  const into = typeof (body as { into?: unknown })?.into === 'string' ? (body as { into: string }).into : '';
  const from = Array.isArray((body as { from?: unknown })?.from)
    ? ((body as { from: unknown[] }).from.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
    : [];

  if (!into || from.length === 0) {
    return c.json({ error: 'into and from are required' }, 400);
  }

  if (!getPersonById(into)) {
    db.prepare('INSERT INTO person (id, social, updated_at) VALUES (?, ?, ?)').run(into, '[]', nowIso());
  }

  const target = getPersonById(into)!;
  const sourceRows = from
    .map((id) => getPersonById(id))
    .filter((row): row is PersonRow => Boolean(row));

  const mergedSocial = dedupeSocial([
    ...parseSocial(JSON.parse(target.social ?? '[]')),
    ...sourceRows.flatMap((row) => parseSocial(JSON.parse(row.social ?? '[]'))),
  ]);

  const notes = target.notes || sourceRows.find((row) => row.notes)?.notes || null;
  const birthYear = target.birth_year ?? sourceRows.find((row) => row.birth_year !== null)?.birth_year ?? null;
  const birthMonth = target.birth_month ?? sourceRows.find((row) => row.birth_month !== null)?.birth_month ?? null;
  const birthDay = target.birth_day ?? sourceRows.find((row) => row.birth_day !== null)?.birth_day ?? null;

  const tx = db.transaction(() => {
    const insertTag = db.prepare('INSERT OR IGNORE INTO person_tag (person_id, tag_id) VALUES (?, ?)');
    for (const sourceId of from) {
      const sourceTags = db.prepare('SELECT tag_id FROM person_tag WHERE person_id = ?').all(sourceId) as Array<{ tag_id: string }>;
      for (const sourceTag of sourceTags) {
        insertTag.run(into, sourceTag.tag_id);
      }
      db.prepare('DELETE FROM person WHERE id = ?').run(sourceId);
    }

    db.prepare(
      `
        UPDATE person
        SET birth_year = ?, birth_month = ?, birth_day = ?, notes = ?, social = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(birthYear, birthMonth, birthDay, notes, JSON.stringify(mergedSocial), nowIso(), into);
  });

  tx();
  return c.json(mapPerson(getPersonById(into)!));
});

personsRouter.get('/by-tag/:tagId', (c) => {
  const { tagId } = c.req.param();
  const personIds = db
    .prepare('SELECT person_id FROM person_tag WHERE tag_id = ? ORDER BY person_id ASC')
    .all(tagId) as Array<{ person_id: string }>;
  return c.json({ personIds: personIds.map((entry) => entry.person_id) });
});

personsRouter.get('/:id', (c) => {
  const { id } = c.req.param();
  const person = getPersonById(id);

  if (!person) {
    return c.json({ error: 'Person metadata not found' }, 404);
  }

  return c.json(mapPerson(person));
});

personsRouter.put('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const birthYear = toNumberOrNull((body as { birthYear?: unknown }).birthYear);
  const birthMonth = toNumberOrNull((body as { birthMonth?: unknown }).birthMonth);
  const birthDay = toNumberOrNull((body as { birthDay?: unknown }).birthDay);
  const notesRaw = (body as { notes?: unknown }).notes;
  const notes = typeof notesRaw === 'string' ? notesRaw.trim() : null;
  const social = parseSocial((body as { social?: unknown }).social ?? []);

  const validationError = validateDateParts(birthYear, birthMonth, birthDay);

  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const updatedAt = nowIso();
  const existing = getPersonById(id);

  if (!existing) {
    db.prepare(
      `
        INSERT INTO person (
          id, birth_year, birth_month, birth_day, notes, social, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(id, birthYear, birthMonth, birthDay, notes, JSON.stringify(social), updatedAt);
  } else {
    db.prepare(
      `
        UPDATE person
        SET birth_year = ?, birth_month = ?, birth_day = ?, notes = ?, social = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(birthYear, birthMonth, birthDay, notes, JSON.stringify(social), updatedAt, id);
  }

  return c.json(mapPerson(getPersonById(id)!));
});

personsRouter.put('/:id/tags', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);

  const tagIds = Array.isArray((body as { tagIds?: unknown })?.tagIds)
    ? ((body as { tagIds: unknown[] }).tagIds.filter(
        (tagId): tagId is string => typeof tagId === 'string' && tagId.trim().length > 0,
      ))
    : null;

  if (!tagIds) {
    return c.json({ error: 'tagIds array is required' }, 400);
  }

  if (!getPersonById(id)) {
    db.prepare('INSERT INTO person (id, social, updated_at) VALUES (?, ?, ?)').run(id, '[]', nowIso());
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM person_tag WHERE person_id = ?').run(id);
    const insert = db.prepare('INSERT OR IGNORE INTO person_tag (person_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds) {
      insert.run(id, tagId);
    }
    db.prepare('UPDATE person SET updated_at = ? WHERE id = ?').run(nowIso(), id);
  });

  tx();
  return c.json({ tags: getPersonTags(id) });
});

personsRouter.delete('/:id', (c) => {
  const { id } = c.req.param();
  db.prepare('DELETE FROM person WHERE id = ?').run(id);
  return c.json({ ok: true });
});

