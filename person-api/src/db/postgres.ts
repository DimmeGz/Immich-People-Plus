import postgres, { type Sql, type TransactionSql } from 'postgres';
import type { PersonCard, Tag } from '../types.js';
import { createId, dedupeSocial, nowIso, parseSocial } from '../utils.js';
import { UUID_RE } from './normalize.js';
import {
  InvalidIdError,
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

/**
 * Everything lives in schema `people` of the database named by DATABASE_URL (the `immeyes`
 * database next to Immich). Column semantics mirror migrations/001_init.sql; the birth
 * checks mirror validateDateParts() in the persons route.
 */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      create table if not exists people.person (
        id uuid primary key,
        birth_year integer check (birth_year between 1800 and 3000),
        birth_month integer check (birth_month between 1 and 12),
        birth_day integer check (birth_day between 1 and 31),
        notes text,
        social jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists people.tag (
        id uuid primary key,
        name text not null unique,
        color text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists people.person_tag (
        person_id uuid not null references people.person (id) on delete cascade,
        tag_id uuid not null references people.tag (id) on delete cascade,
        primary key (person_id, tag_id)
      );

      create index if not exists idx_person_tag_person_id on people.person_tag (person_id);
      create index if not exists idx_person_tag_tag_id on people.person_tag (tag_id);
    `,
  },
];

export function connectPostgres(databaseUrl: string): Sql {
  if (!databaseUrl) {
    throw new Error(`${LOG} DATABASE_URL is required for the postgres driver`);
  }

  return postgres(databaseUrl, {
    max: 5,
    idle_timeout: 60,
    connect_timeout: 10,
    onnotice: () => {},
  });
}

/** Connect and apply pending migrations to schema `people`. */
export async function openPostgres(databaseUrl: string): Promise<Sql> {
  const sql = connectPostgres(databaseUrl);

  try {
    await runPostgresMigrations(sql);
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => {});
    throw error;
  }

  return sql;
}

export async function runPostgresMigrations(sql: Sql): Promise<void> {
  await sql`create schema if not exists people`;
  await sql`
    create table if not exists people.schema_migration (
      version integer primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql<{ version: number }[]>`select version from people.schema_migration`).map((row) => row.version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    await sql.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx`insert into people.schema_migration (version) values (${migration.version})`;
    });
    console.log(`${LOG} applied postgres migration ${migration.version}`);
  }
}

type PgPersonRow = {
  id: string;
  birth_year: number | null;
  birth_month: number | null;
  birth_day: number | null;
  notes: string | null;
  social: unknown;
  created_at: Date;
  updated_at: Date;
};

type PgTagRow = {
  id: string;
  name: string;
  color: string | null;
  created_at: Date;
  updated_at: Date;
};

type Db = Sql | TransactionSql;

function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

function assertUuid(id: string): void {
  if (!isUuid(id)) {
    throw new InvalidIdError(id);
  }
}

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
}

export class PostgresRepository implements PersonRepository {
  readonly driver = 'postgres' as const;

  constructor(private readonly sql: Sql) {}

  private async getPersonRow(db: Db, id: string): Promise<PgPersonRow | undefined> {
    if (!isUuid(id)) {
      return undefined;
    }
    const rows = await db<PgPersonRow[]>`select * from people.person where id = ${id}`;
    return rows[0];
  }

  private async getPersonTags(db: Db, personId: string): Promise<Tag[]> {
    if (!isUuid(personId)) {
      return [];
    }
    return db<Tag[]>`
      select t.id, t.name, t.color
      from people.tag t
      inner join people.person_tag pt on pt.tag_id = t.id
      where pt.person_id = ${personId}
      order by lower(t.name) asc, t.name asc
    `;
  }

  private async mapPerson(db: Db, row: PgPersonRow): Promise<PersonCard> {
    return {
      id: row.id,
      birthYear: row.birth_year,
      birthMonth: row.birth_month,
      birthDay: row.birth_day,
      notes: row.notes,
      social: parseSocial(row.social ?? []),
      tags: await this.getPersonTags(db, row.id),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async ensurePerson(db: Db, id: string): Promise<void> {
    assertUuid(id);
    const now = nowIso();
    await db`
      insert into people.person (id, social, created_at, updated_at)
      values (${id}, '[]'::jsonb, ${now}, ${now})
      on conflict (id) do nothing
    `;
  }

  async getPerson(id: string): Promise<PersonCard | null> {
    const row = await this.getPersonRow(this.sql, id);
    return row ? this.mapPerson(this.sql, row) : null;
  }

  async upsertPerson(id: string, input: PersonInput): Promise<PersonCard> {
    assertUuid(id);
    const now = nowIso();
    // Pass JSON values through sql.json(): a pre-serialised string with a ::jsonb cast would be
    // JSON-encoded a second time by the driver and stored as a jsonb string.
    const social = this.sql.json(input.social as unknown as postgres.JSONValue);

    return this.sql.begin(async (tx) => {
      await tx`
        insert into people.person (id, birth_year, birth_month, birth_day, notes, social, created_at, updated_at)
        values (${id}, ${input.birthYear}, ${input.birthMonth}, ${input.birthDay}, ${input.notes}, ${social}, ${now}, ${now})
        on conflict (id) do update set
          birth_year = excluded.birth_year,
          birth_month = excluded.birth_month,
          birth_day = excluded.birth_day,
          notes = excluded.notes,
          social = excluded.social,
          updated_at = excluded.updated_at
      `;
      const row = (await this.getPersonRow(tx, id))!;
      return this.mapPerson(tx, row);
    });
  }

  async deletePerson(id: string): Promise<void> {
    if (!isUuid(id)) {
      return;
    }
    await this.sql`delete from people.person where id = ${id}`;
  }

  async setPersonTags(id: string, tagIds: string[]): Promise<Tag[]> {
    assertUuid(id);
    for (const tagId of tagIds) {
      assertUuid(tagId);
    }

    return this.sql.begin(async (tx) => {
      await this.ensurePerson(tx, id);
      await tx`delete from people.person_tag where person_id = ${id}`;
      for (const tagId of tagIds) {
        await tx`
          insert into people.person_tag (person_id, tag_id) values (${id}, ${tagId})
          on conflict (person_id, tag_id) do nothing
        `;
      }
      await tx`update people.person set updated_at = ${nowIso()} where id = ${id}`;
      return this.getPersonTags(tx, id);
    });
  }

  async bulkPersons(ids: string[]): Promise<PersonCard[]> {
    const valid = ids.filter(isUuid);
    if (valid.length === 0) {
      return [];
    }

    const rows = await this.sql<PgPersonRow[]>`
      select * from people.person where id = any(${valid}::uuid[]) order by id
    `;
    const cards: PersonCard[] = [];
    for (const row of rows) {
      cards.push(await this.mapPerson(this.sql, row));
    }
    return cards;
  }

  async mergePersons(into: string, from: string[]): Promise<PersonCard> {
    assertUuid(into);

    return this.sql.begin(async (tx) => {
      await this.ensurePerson(tx, into);

      const target = (await this.getPersonRow(tx, into))!;
      const sourceRows: PgPersonRow[] = [];
      for (const id of from) {
        const row = await this.getPersonRow(tx, id);
        if (row) {
          sourceRows.push(row);
        }
      }

      const mergedSocial = dedupeSocial([
        ...parseSocial(target.social ?? []),
        ...sourceRows.flatMap((row) => parseSocial(row.social ?? [])),
      ]);

      const notes = target.notes || sourceRows.find((row) => row.notes)?.notes || null;
      const birthYear = target.birth_year ?? sourceRows.find((row) => row.birth_year !== null)?.birth_year ?? null;
      const birthMonth = target.birth_month ?? sourceRows.find((row) => row.birth_month !== null)?.birth_month ?? null;
      const birthDay = target.birth_day ?? sourceRows.find((row) => row.birth_day !== null)?.birth_day ?? null;

      for (const sourceId of from) {
        if (!isUuid(sourceId)) {
          continue;
        }
        await tx`
          insert into people.person_tag (person_id, tag_id)
          select ${into}, tag_id from people.person_tag where person_id = ${sourceId}
          on conflict (person_id, tag_id) do nothing
        `;
        await tx`delete from people.person where id = ${sourceId}`;
      }

      await tx`
        update people.person
        set birth_year = ${birthYear}, birth_month = ${birthMonth}, birth_day = ${birthDay},
            notes = ${notes}, social = ${this.sql.json(mergedSocial as unknown as postgres.JSONValue)}, updated_at = ${nowIso()}
        where id = ${into}
      `;

      const row = (await this.getPersonRow(tx, into))!;
      return this.mapPerson(tx, row);
    });
  }

  async personsByTag(tagId: string): Promise<string[]> {
    if (!isUuid(tagId)) {
      return [];
    }
    const rows = await this.sql<{ person_id: string }[]>`
      select person_id from people.person_tag where tag_id = ${tagId} order by person_id asc
    `;
    return rows.map((entry) => entry.person_id);
  }

  async listTags(): Promise<Tag[]> {
    return this.sql<Tag[]>`select id, name, color from people.tag order by lower(name) asc, name asc`;
  }

  async createTag(input: TagInput): Promise<Tag> {
    const id = createId();
    const now = nowIso();

    try {
      await this.sql`
        insert into people.tag (id, name, color, created_at, updated_at)
        values (${id}, ${input.name}, ${input.color}, ${now}, ${now})
      `;
    } catch (error) {
      if (pgCode(error) === '23505') {
        throw new TagNameConflictError(input.name);
      }
      throw error;
    }

    return { id, name: input.name, color: input.color };
  }

  async deleteTag(id: string): Promise<boolean> {
    if (!isUuid(id)) {
      return false;
    }
    const result = await this.sql`delete from people.tag where id = ${id}`;
    return result.count > 0;
  }

  async exportAll(): Promise<Snapshot> {
    const persons = await this.sql<PgPersonRow[]>`
      select id, birth_year, birth_month, birth_day, notes, social, created_at, updated_at
      from people.person order by id
    `;
    const tags = await this.sql<PgTagRow[]>`
      select id, name, color, created_at, updated_at from people.tag order by id
    `;
    const personTags = await this.sql<PersonTagRow[]>`
      select person_id, tag_id from people.person_tag order by person_id, tag_id
    `;

    const person: PersonRow[] = persons.map((row) => ({
      id: row.id,
      birth_year: row.birth_year,
      birth_month: row.birth_month,
      birth_day: row.birth_day,
      notes: row.notes,
      social: JSON.stringify(row.social),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    }));

    const tag: TagRow[] = tags.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    }));

    return { person, tag, person_tag: personTags.map((row) => ({ person_id: row.person_id, tag_id: row.tag_id })) };
  }

  async importAll(snapshot: Snapshot, options: ImportOptions = {}): Promise<ImportResult> {
    return this.sql.begin(async (tx) => {
      const pruned = { person: 0, tag: 0, person_tag: 0 };

      if (options.prune) {
        const keepPersonTag = snapshot.person_tag.map((row) => `${row.person_id}/${row.tag_id}`);
        pruned.person_tag = (
          await tx`
            delete from people.person_tag
            where (person_id::text || '/' || tag_id::text) <> all(${keepPersonTag}::text[])
          `
        ).count;
        pruned.person = (
          await tx`delete from people.person where id <> all(${snapshot.person.map((row) => row.id)}::uuid[])`
        ).count;
        pruned.tag = (
          await tx`delete from people.tag where id <> all(${snapshot.tag.map((row) => row.id)}::uuid[])`
        ).count;
      }

      for (const row of snapshot.person) {
        await tx`
          insert into people.person (id, birth_year, birth_month, birth_day, notes, social, created_at, updated_at)
          values (${row.id}, ${row.birth_year}, ${row.birth_month}, ${row.birth_day}, ${row.notes},
                  ${this.sql.json(JSON.parse(row.social))}, ${row.created_at}::timestamptz, ${row.updated_at}::timestamptz)
          on conflict (id) do update set
            birth_year = excluded.birth_year,
            birth_month = excluded.birth_month,
            birth_day = excluded.birth_day,
            notes = excluded.notes,
            social = excluded.social,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `;
      }

      for (const row of snapshot.tag) {
        await tx`
          insert into people.tag (id, name, color, created_at, updated_at)
          values (${row.id}, ${row.name}, ${row.color}, ${row.created_at}::timestamptz, ${row.updated_at}::timestamptz)
          on conflict (id) do update set
            name = excluded.name,
            color = excluded.color,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `;
      }

      for (const row of snapshot.person_tag) {
        await tx`
          insert into people.person_tag (person_id, tag_id) values (${row.person_id}, ${row.tag_id})
          on conflict (person_id, tag_id) do nothing
        `;
      }

      return {
        person: snapshot.person.length,
        tag: snapshot.tag.length,
        person_tag: snapshot.person_tag.length,
        pruned,
      };
    });
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
