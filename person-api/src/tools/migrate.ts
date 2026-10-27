/** Apply pending migrations for the configured driver (DB_DRIVER) or --driver and exit. */
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { openRepository } from '../db/index.js';
import { fail, isDriver } from './common.js';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { driver: { type: 'string' } } });
  const driver = values.driver ?? config.dbDriver;
  if (!isDriver(driver)) {
    fail(`--driver must be sqlite or postgres, got "${driver}"`);
  }

  const repository = await openRepository(driver);
  console.log(`${driver}: migrations are up to date`);
  await repository.close();
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
