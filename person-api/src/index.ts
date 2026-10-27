import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { initRepository } from './db/index.js';
import { InvalidIdError } from './db/repository.js';
import { requireApiKey } from './middleware/auth.js';
import { personsRouter } from './routes/persons.js';
import { tagsRouter } from './routes/tags.js';

if (!config.apiKey) {
  console.warn('[immich-people-plus-api] API_KEY is empty; all authenticated routes will reject requests.');
}

const repository = await initRepository();
console.log(`[immich-people-plus-api] storage: ${repository.driver}`);

const app = new Hono();

app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true, driver: repository.driver }));

app.use('/persons/*', requireApiKey);
app.use('/tags/*', requireApiKey);

app.route('/persons', personsRouter);
app.route('/tags', tagsRouter);

app.get('/export', requireApiKey, (c) => {
  // Lightweight backup endpoint.
  return c.json({ message: 'Export endpoint is reserved for future enhancement.' });
});

app.onError((error, c) => {
  if (error instanceof InvalidIdError) {
    return c.json({ error: error.message }, 400);
  }

  console.error('[immich-people-plus-api] unhandled error', error);
  return c.text('Internal Server Error', 500);
});

serve({ fetch: app.fetch, port: config.port });
console.log(`[immich-people-plus-api] listening on :${config.port}`);
