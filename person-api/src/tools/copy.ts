/**
 * Copy every row from one storage to another (idempotent upsert in one transaction).
 *
 *   npm run copy -- --from sqlite --to postgres
 *   npm run copy -- --from postgres --to sqlite
 *   npm run copy -- --from ./data/export-....json --to sqlite
 *
 * Options:
 *   --prune        also delete target rows that are absent from the source (makes the target a mirror)
 *   --allow-empty  proceed even when the source has no rows at all
 *
 * Nothing is written when any source row cannot be stored by the target driver (invalid JSON in
 * `social`, unparsable timestamp, non-UUID id, birth part out of range): every problem is listed
 * and the exit code is 1.
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { formatProblems, normalizeSnapshot, validateSnapshot } from '../db/normalize.js';
import type { Snapshot } from '../db/repository.js';
import { describeSnapshot, fail, isDriver, isEmptySnapshot, openSource, openTarget, readExportFile } from './common.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      prune: { type: 'boolean', default: false },
      'allow-empty': { type: 'boolean', default: false },
    },
  });

  const from = values.from ?? '';
  const to = values.to ?? '';

  if (!from || !to) {
    fail('usage: npm run copy -- --from <sqlite|postgres|file.json> --to <sqlite|postgres> [--prune] [--allow-empty]');
  }
  if (!isDriver(to)) {
    fail(`--to must be sqlite or postgres, got "${to}"`);
  }
  if (from === to) {
    fail('--from and --to must differ');
  }

  let snapshot: Snapshot;
  let sourceLabel: string;

  if (isDriver(from)) {
    const source = await openSource(from);
    try {
      snapshot = await source.exportAll();
    } finally {
      await source.close();
    }
    sourceLabel = from === 'sqlite' ? `sqlite ${config.databasePath}` : 'postgres';
  } else {
    if (!fs.existsSync(from)) {
      fail(`--from: no such driver or file: ${from}`);
    }
    snapshot = readExportFile(from).tables;
    sourceLabel = `file ${from}`;
  }

  console.log(`source: ${sourceLabel}: ${describeSnapshot(snapshot)}`);

  const problems = validateSnapshot(snapshot);
  if (problems.length > 0) {
    fail(`${problems.length} row(s) cannot be copied, nothing was written:\n${formatProblems(problems)}`);
  }

  if (isEmptySnapshot(snapshot) && !values['allow-empty']) {
    fail('source is empty; pass --allow-empty if that is intended');
  }

  const target = await openTarget(to, config.databasePath);
  try {
    const result = await target.importAll(normalizeSnapshot(snapshot), { prune: values.prune });
    const targetLabel = to === 'sqlite' ? `sqlite ${config.databasePath}` : 'postgres';
    console.log(
      `copied to ${targetLabel}: ${result.person} persons, ${result.tag} tags, ${result.person_tag} person-tag links` +
        (values.prune
          ? ` (pruned ${result.pruned.person} persons, ${result.pruned.tag} tags, ${result.pruned.person_tag} links)`
          : ''),
    );
  } finally {
    await target.close();
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
