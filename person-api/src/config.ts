export type DbDriver = 'sqlite' | 'postgres';

function parseDriver(value: string | undefined): DbDriver {
  const driver = (value ?? 'sqlite').trim().toLowerCase();

  if (driver === 'sqlite' || driver === 'postgres') {
    return driver;
  }

  throw new Error(`[immich-people-plus-api] DB_DRIVER must be "sqlite" or "postgres", got "${value}"`);
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Which storage the HTTP API uses. The copy/verify tools open both regardless of this value. */
  dbDriver: parseDriver(process.env.DB_DRIVER),
  /** SQLite file (DB_DRIVER=sqlite, and the sqlite side of copy/verify). */
  databasePath: process.env.DATABASE_PATH ?? './data/person.db',
  /** Postgres connection string (DB_DRIVER=postgres, and the postgres side of copy/verify). */
  databaseUrl: process.env.DATABASE_URL ?? '',
  apiKey: process.env.API_KEY ?? '',
};
