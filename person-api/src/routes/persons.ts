import { Hono } from 'hono';
import { getRepository } from '../db/index.js';
import { parseSocial, toNumberOrNull } from '../utils.js';

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

personsRouter.get('/bulk/list', async (c) => {
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

  const persons = await getRepository().bulkPersons(ids);
  return c.json({ persons });
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

  const person = await getRepository().mergePersons(into, from);
  return c.json(person);
});

personsRouter.get('/by-tag/:tagId', async (c) => {
  const { tagId } = c.req.param();
  const personIds = await getRepository().personsByTag(tagId);
  return c.json({ personIds });
});

personsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const person = await getRepository().getPerson(id);

  if (!person) {
    return c.json({ error: 'Person metadata not found' }, 404);
  }

  return c.json(person);
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

  const person = await getRepository().upsertPerson(id, { birthYear, birthMonth, birthDay, notes, social });
  return c.json(person);
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

  const tags = await getRepository().setPersonTags(id, tagIds);
  return c.json({ tags });
});

personsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  await getRepository().deletePerson(id);
  return c.json({ ok: true });
});
