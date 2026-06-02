import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import './db/migrate.js';
import { config } from './config.js';
import { requireApiKey } from './middleware/auth.js';
import { personsRouter } from './routes/persons.js';
import { tagsRouter } from './routes/tags.js';

const app = new Hono();

app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

app.use('/persons/*', requireApiKey);
app.use('/tags/*', requireApiKey);

app.route('/persons', personsRouter);
app.route('/tags', tagsRouter);

app.get('/export', requireApiKey, (c) => {
  // Lightweight backup endpoint.
  return c.json({ message: 'Export endpoint is reserved for future enhancement.' });
});

serve({ fetch: app.fetch, port: config.port });
console.log(`[immich-people-plus-api] listening on :${config.port}`);
