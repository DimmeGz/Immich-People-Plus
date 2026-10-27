/**
 * Dump all three tables of the configured driver (or --driver) into one JSON file.
 *
 *   npm run export                       -> ./data/export-<timestamp>.json
 *   npm run export -- ./backup.json
 *   npm run export -- --driver postgres ./pg.json
 *
 * The file can be restored with `npm run copy -- --from <file> --to sqlite|postgres`.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { EXPORT_FORMAT, describeSnapshot, fail, isDriver, openSource, writeExportFile } from './common.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { driver: { type: 'string' } },
  });

  const driver = values.driver ?? config.dbDriver;
  if (!isDriver(driver)) {
    fail(`--driver must be sqlite or postgres, got "${driver}"`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.resolve(positionals[0] ?? path.join(path.dirname(config.databasePath), `export-${stamp}.json`));

  const repository = await openSource(driver);
  try {
    const tables = await repository.exportAll();
    writeExportFile(filePath, { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), driver, tables });
    console.log(`exported ${describeSnapshot(tables)} from ${driver} to ${filePath}`);
  } finally {
    await repository.close();
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
