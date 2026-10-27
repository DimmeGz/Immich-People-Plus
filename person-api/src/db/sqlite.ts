import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { PersonCard, Tag } from '../types.js';
import { createId, dedupeSocial, nowIso, parseSocial } from '../utils.js';
import {
  TagNameConflictError,
  type ImportOptions,
  type ImportResult,
  type PersonInput,
  type PersonRepository,
  type PersonRow,
  type PersonTagRow,
  type Snapshot,
  type TagInput,
  type TagRow,
} from './repository.js';

const LOG = '[immich-people-plus-api]';

export type OpenSqliteOptions = {
  /** Fail instead of creating an empty database when the file is missing (used by copy/verify sources). */
  mustExist?: boolean;
  /** Directory with the numbered `*.sql` migrations. Default: `<cwd>/migrations`. */
  migrationsDir?: string;
};

/** Open (or create) the SQLite file, enable WAL + foreign keys and apply pending migrations. */
export function openSqlite(databasePath: string, options: OpenSqliteOptions = {}): Database.Database {
  if (options.mustExist && !fs.existsSync(databasePath)) {
    throw new Error(`${LOG} SQLite database not found: ${databasePath}`);
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runSqliteMigrations(db, options.migrationsDir ?? path.resolve(process.cwd(), 'migrations'));
  return db;
}

export function runSqliteMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
  `);

  const applied = new Set(
    db.prepare('SELECT id FROM _migrations').all().map((row) => (row as { id: string }).id),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(file);
    })();
    console.log(`${LOG} applied sqlite migration ${file}`);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export class SqliteRepository implements PersonRepository {
  readonly driver = 'sqlite' as const;

  constructor(private readonly db: Database.Database) {}

  private getPersonRow(id: string): PersonRow | undefined {
    return this.db.prepare('SELECT * FROM person WHERE id = ?').get(id) as PersonRow | undefined;
  }

  private getPersonTags(personId: string): Tag[] {
    return this.db
      .prepare(
        `
          SELECT t.id, t.name, t.color
          FROM tag t
          INNER JOIN person_tag pt ON pt.tag_id = t.id
          WHERE pt.person_id = ?
          ORDER BY t.name COLLATE NOCASE ASC
        `,
      )
      .all(personId) as Tag[];
  }

  private mapPerson(row: PersonRow): PersonCard {
    return {
      id: row.id,
      birthYear: row.birth_year,
      birthMonth: row.birth_month,
      birthDay: row.birth_day,
      notes: row.notes,
      social: parseSocial(JSON.parse(row.social ?? '[]')),
      tags: this.getPersonTags(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private ensurePerson(id: string): void {
    if (!this.getPersonRow(id)) {
      this.db.prepare('INSERT INTO person (id, social, updated_at) VALUES (?, ?, ?)').run(id, '[]', nowIso());
    }
  }

  async getPerson(id: string): Promise<PersonCard | null> {
    const row = this.getPersonRow(id);
    return row ? this.mapPerson(row) : null;
  }

  async upsertPerson(id: string, input: PersonInput): Promise<PersonCard> {
    const updatedAt = nowIso();
    const social = JSON.stringify(input.social);

    if (!this.getPersonRow(id)) {
      this.db
        .prepare(
          `
            INSERT INTO person (
              id, birth_year, birth_month, birth_day, notes, social, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(id, input.birthYear, input.birthMonth, input.birthDay, input.notes, social, updatedAt);
    } else {
      this.db
        .prepare(
          `
            UPDATE person
            SET birth_year = ?, birth_month = ?, birth_day = ?, notes = ?, social = ?, updated_at = ?
            WHERE id = ?
          `,
        )
        .run(input.birthYear, input.birthMonth, input.birthDay, input.notes, social, updatedAt, id);
    }

    return this.mapPerson(this.getPersonRow(id)!);
  }

  async deletePerson(id: string): Promise<void> {
    this.db.prepare('DELETE FROM person WHERE id = ?').run(id);
  }

  async setPersonTags(id: string, tagIds: string[]): Promise<Tag[]> {
    this.ensurePerson(id);

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM person_tag WHERE person_id = ?').run(id);
      const insert = this.db.prepare('INSERT OR IGNORE INTO person_tag (person_id, tag_id) VALUES (?, ?)');
      for (const tagId of tagIds) {
        insert.run(id, tagId);
      }
      this.db.prepare('UPDATE person SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    })();

    return this.getPersonTags(id);
  }

  async bulkPersons(ids: string[]): Promise<PersonCard[]> {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM person WHERE id IN (${placeholders})`).all(...ids) as PersonRow[];
    return rows.map((row) => this.mapPerson(row));
  }

  async mergePersons(into: string, from: string[]): Promise<PersonCard> {
    this.ensurePerson(into);

    const target = this.getPersonRow(into)!;
    const sourceRows = from
      .map((id) => this.getPersonRow(id))
      .filter((row): row is PersonRow => Boolean(row));

    const mergedSocial = dedupeSocial([
      ...parseSocial(JSON.parse(target.social ?? '[]')),
      ...sourceRows.flatMap((row) => parseSocial(JSON.parse(row.social ?? '[]'))),
    ]);

    const notes = target.notes || sourceRows.find((row) => row.notes)?.notes || null;
    const birthYear = target.birth_year ?? sourceRows.find((row) => row.birth_year !== null)?.birth_year ?? null;
    const birthMonth = target.birth_month ?? sourceRows.find((row) => row.birth_month !== null)?.birth_month ?? null;
    const birthDay = target.birth_day ?? sourceRows.find((row) => row.birth_day !== null)?.birth_day ?? null;

    this.db.transaction(() => {
      const insertTag = this.db.prepare('INSERT OR IGNORE INTO person_tag (person_id, tag_id) VALUES (?, ?)');
      for (const sourceId of from) {
        const sourceTags = this.db
          .prepare('SELECT tag_id FROM person_tag WHERE person_id = ?')
          .all(sourceId) as Array<{ tag_id: string }>;
        for (const sourceTag of sourceTags) {
          insertTag.run(into, sourceTag.tag_id);
        }
        this.db.prepare('DELETE FROM person WHERE id = ?').run(sourceId);
      }

      this.db
        .prepare(
          `
            UPDATE person
            SET birth_year = ?, birth_month = ?, birth_day = ?, notes = ?, social = ?, updated_at = ?
            WHERE id = ?
          `,
        )
        .run(birthYear, birthMonth, birthDay, notes, JSON.stringify(mergedSocial), nowIso(), into);
    })();

    return this.mapPerson(this.getPersonRow(into)!);
  }

  async personsByTag(tagId: string): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT person_id FROM person_tag WHERE tag_id = ? ORDER BY person_id ASC')
      .all(tagId) as Array<{ person_id: string }>;
    return rows.map((entry) => entry.person_id);
  }

  async listTags(): Promise<Tag[]> {
    return this.db.prepare('SELECT id, name, color FROM tag ORDER BY name COLLATE NOCASE ASC').all() as Tag[];
  }

  async createTag(input: TagInput): Promise<Tag> {
    const id = createId();
    const updatedAt = nowIso();

    try {
      this.db
        .prepare('INSERT INTO tag (id, name, color, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, input.name, input.color, updatedAt);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TagNameConflictError(input.name);
      }
      throw error;
    }

    return { id, name: input.name, color: input.color };
  }

  async deleteTag(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM tag WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async exportAll(): Promise<Snapshot> {
    return {
      person: this.db
        .prepare(
          'SELECT id, birth_year, birth_month, birth_day, notes, social, created_at, updated_at FROM person ORDER BY id',
        )
        .all() as PersonRow[],
      tag: this.db.prepare('SELECT id, name, color, created_at, updated_at FROM tag ORDER BY id').all() as TagRow[],
      person_tag: this.db
        .prepare('SELECT person_id, tag_id FROM person_tag ORDER BY person_id, tag_id')
        .all() as PersonTagRow[],
    };
  }

  async importAll(snapshot: Snapshot, options: ImportOptions = {}): Promise<ImportResult> {
    const upsertPerson = this.db.prepare(
      `
        INSERT INTO person (id, birth_year, birth_month, birth_day, notes, social, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          birth_year = excluded.birth_year,
          birth_month = excluded.birth_month,
          birth_day = excluded.birth_day,
          notes = excluded.notes,
          social = excluded.social,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
    );
    const upsertTag = this.db.prepare(
      `
        INSERT INTO tag (id, name, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          color = excluded.color,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
    );
    const upsertPersonTag = this.db.prepare(
      'INSERT INTO person_tag (person_id, tag_id) VALUES (?, ?) ON CONFLICT (person_id, tag_id) DO NOTHING',
    );

    return this.db.transaction((): ImportResult => {
      const pruned = { person: 0, tag: 0, person_tag: 0 };

      if (options.prune) {
        pruned.person_tag = this.pruneTable(
          'person_tag',
          "person_id || '/' || tag_id",
          snapshot.person_tag.map((row) => `${row.person_id}/${row.tag_id}`),
        );
        pruned.person = this.pruneTable('person', 'id', snapshot.person.map((row) => row.id));
        pruned.tag = this.pruneTable('tag', 'id', snapshot.tag.map((row) => row.id));
      }

      for (const row of snapshot.person) {
        upsertPerson.run(
          row.id,
          row.birth_year,
          row.birth_month,
          row.birth_day,
          row.notes,
          row.social,
          row.created_at,
          row.updated_at,
        );
      }
      for (const row of snapshot.tag) {
        upsertTag.run(row.id, row.name, row.color, row.created_at, row.updated_at);
      }
      for (const row of snapshot.person_tag) {
        upsertPersonTag.run(row.person_id, row.tag_id);
      }

      return {
        person: snapshot.person.length,
        tag: snapshot.tag.length,
        person_tag: snapshot.person_tag.length,
        pruned,
      };
    })();
  }

  /** Delete rows of `table` whose key expression is not in `keep`. Returns the number deleted. */
  private pruneTable(table: 'person' | 'tag' | 'person_tag', keyExpr: string, keep: string[]): number {
    const tmp = `_keep_${table}`;
    this.db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${tmp} (k TEXT PRIMARY KEY)`);
    this.db.exec(`DELETE FROM ${tmp}`);
    const insert = this.db.prepare(`INSERT OR IGNORE INTO ${tmp} (k) VALUES (?)`);
    for (const key of keep) {
      insert.run(key);
    }
    const result = this.db.prepare(`DELETE FROM ${table} WHERE ${keyExpr} NOT IN (SELECT k FROM ${tmp})`).run();
    this.db.exec(`DROP TABLE ${tmp}`);
    return result.changes;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
