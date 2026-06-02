import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { createId, nowIso } from '../utils.js';

type TagRow = {
  id: string;
  name: string;
  color: string | null;
};

function readTags(): TagRow[] {
  return db.prepare('SELECT id, name, color FROM tag ORDER BY name COLLATE NOCASE ASC').all() as TagRow[];
}

export const tagsRouter = new Hono();

tagsRouter.get('/', (c) => c.json({ tags: readTags() }));

tagsRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const color = typeof body?.color === 'string' ? body.color.trim() : null;

  if (!name) {
    return c.json({ error: 'Tag name is required' }, 400);
  }

  const id = createId();
  const updatedAt = nowIso();

  try {
    db.prepare('INSERT INTO tag (id, name, color, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, name, color, updatedAt);
  } catch {
    return c.json({ error: 'Tag name must be unique' }, 409);
  }

  return c.json({ id, name, color }, 201);
});

tagsRouter.delete('/:id', (c) => {
  const { id } = c.req.param();
  const result = db.prepare('DELETE FROM tag WHERE id = ?').run(id);

  if (result.changes === 0) {
    return c.json({ error: 'Tag not found' }, 404);
  }

  return c.json({ ok: true });
});
