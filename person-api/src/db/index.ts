import type { DbDriver } from '../config.js';
import { config } from '../config.js';
import { PostgresRepository, openPostgres } from './postgres.js';
import type { PersonRepository } from './repository.js';
import { SqliteRepository, openSqlite, type OpenSqliteOptions } from './sqlite.js';

export type OpenRepositoryOptions = {
  sqlite?: OpenSqliteOptions;
};

/** Open a repository for the given driver, applying migrations. Does not touch the shared instance. */
export async function openRepository(driver: DbDriver, options: OpenRepositoryOptions = {}): Promise<PersonRepository> {
  switch (driver) {
    case 'sqlite':
      return new SqliteRepository(openSqlite(config.databasePath, options.sqlite));
    case 'postgres':
      return new PostgresRepository(await openPostgres(config.databaseUrl));
  }
}

let instance: PersonRepository | null = null;

/** Open the repository the HTTP API uses (DB_DRIVER). Called once at startup. */
export async function initRepository(): Promise<PersonRepository> {
  if (!instance) {
    instance = await openRepository(config.dbDriver);
  }
  return instance;
}

export function getRepository(): PersonRepository {
  if (!instance) {
    throw new Error('[immich-people-plus-api] repository not initialised');
  }
  return instance;
}
