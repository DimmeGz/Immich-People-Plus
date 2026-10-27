import { Hono } from 'hono';
import { getRepository } from '../db/index.js';
import { TagNameConflictError } from '../db/repository.js';

export const tagsRouter = new Hono();

tagsRouter.get('/', async (c) => c.json({ tags: await getRepository().listTags() }));

tagsRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const color = typeof body?.color === 'string' ? body.color.trim() : null;

  if (!name) {
    return c.json({ error: 'Tag name is required' }, 400);
  }

  try {
    const tag = await getRepository().createTag({ name, color });
    return c.json(tag, 201);
  } catch (error) {
    if (error instanceof TagNameConflictError) {
      return c.json({ error: 'Tag name must be unique' }, 409);
    }
    throw error;
  }
});

tagsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const deleted = await getRepository().deleteTag(id);

  if (!deleted) {
    return c.json({ error: 'Tag not found' }, 404);
  }

  return c.json({ ok: true });
});
