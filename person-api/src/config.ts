export const config = {
  port: Number(process.env.PORT ?? 3001),
  databasePath: process.env.DATABASE_PATH ?? './data/person.db',
  apiKey: process.env.API_KEY ?? '',
};

if (!config.apiKey) {
  console.warn('[immich-people-plus-api] API_KEY is empty; all authenticated routes will reject requests.');
}
