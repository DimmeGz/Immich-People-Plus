import type { Context, Next } from 'hono';
import { config } from '../config.js';

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  const apiKey = c.req.header('x-api-key');

  if (!config.apiKey || !apiKey || apiKey !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
}
