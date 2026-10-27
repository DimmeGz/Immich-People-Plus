import type { PersonCard, SocialLink, Tag } from '../types.js';

/** Input accepted by PUT /persons/:id after validation in the route. */
export type PersonInput = {
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
  notes: string | null;
  social: SocialLink[];
};

export type TagInput = {
  name: string;
  color: string | null;
};

/**
 * Raw table rows, driver independent. This is the exchange format of the export, copy and
 * verify tools: `social` is the JSON text as stored, timestamps are strings as stored
 * (SQLite) or ISO-8601 UTC (Postgres).
 */
export type PersonRow = {
  id: string;
  birth_year: number | null;
  birth_month: number | null;
  birth_day: number | null;
  notes: string | null;
  social: string;
  created_at: string;
  updated_at: string;
};

export type TagRow = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
};

export type PersonTagRow = {
  person_id: string;
  tag_id: string;
};

export type Snapshot = {
  person: PersonRow[];
  tag: TagRow[];
  person_tag: PersonTagRow[];
};

export type ImportOptions = {
  /** Also delete rows that exist in the target but not in the snapshot. Default: false (pure upsert). */
  prune?: boolean;
};

export type ImportResult = {
  person: number;
  tag: number;
  person_tag: number;
  pruned: { person: number; tag: number; person_tag: number };
};

/** Thrown by createTag when the name is already taken. Routes answer 409. */
export class TagNameConflictError extends Error {
  constructor(name: string) {
    super(`Tag name must be unique: ${name}`);
    this.name = 'TagNameConflictError';
  }
}

/** Thrown by the Postgres driver when a write uses an id that is not a UUID. Routes answer 400. */
export class InvalidIdError extends Error {
  constructor(id: string) {
    super(`id must be a UUID: ${id}`);
    this.name = 'InvalidIdError';
  }
}

export interface PersonRepository {
  readonly driver: 'sqlite' | 'postgres';

  getPerson(id: string): Promise<PersonCard | null>;
  /** Insert or update the card (PUT /persons/:id). Returns the stored card. */
  upsertPerson(id: string, input: PersonInput): Promise<PersonCard>;
  deletePerson(id: string): Promise<void>;
  /** Replace the person's tag set, creating an empty card first if needed. Returns the new tag list. */
  setPersonTags(id: string, tagIds: string[]): Promise<Tag[]>;
  bulkPersons(ids: string[]): Promise<PersonCard[]>;
  /** Merge cards `from` into `into` (created if missing); sources are deleted. Returns the merged card. */
  mergePersons(into: string, from: string[]): Promise<PersonCard>;
  personsByTag(tagId: string): Promise<string[]>;

  listTags(): Promise<Tag[]>;
  createTag(input: TagInput): Promise<Tag>;
  /** Returns false when no tag had that id. */
  deleteTag(id: string): Promise<boolean>;

  /** All rows of all three tables, ordered by primary key. */
  exportAll(): Promise<Snapshot>;
  /** Upsert every row of the snapshot in one transaction. Rows are written exactly as given. */
  importAll(snapshot: Snapshot, options?: ImportOptions): Promise<ImportResult>;

  close(): Promise<void>;
}
