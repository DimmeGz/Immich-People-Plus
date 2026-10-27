import type { TakenDateRange } from './api';
import type { PersonApiClient } from './person-api-client';
import type { AgeFilter, BirthDate, Person, PersonCard } from './types';

export const MAX_AGE_YEARS = 150;

function isValidYear(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9999;
}

function isValidMonth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
}

function isValidDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

/** Immich stores `birthDate` as `YYYY-MM-DD` (or null). */
export function parseImmichBirthDate(value: string | null | undefined): BirthDate | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!isValidYear(year) || !isValidMonth(month) || !isValidDay(day)) {
    return null;
  }

  return { year, month, day, precision: 'day', source: 'immich' };
}

/** person-api keeps year / month / day as separate optional integers. */
export function birthDateFromPersonCard(card: Pick<PersonCard, 'birthYear' | 'birthMonth' | 'birthDay'>): BirthDate | null {
  const year = card.birthYear;

  if (!isValidYear(year)) {
    return null;
  }

  if (!isValidMonth(card.birthMonth)) {
    return { year, month: 1, day: 1, precision: 'year', source: 'person-api' };
  }

  if (!isValidDay(card.birthDay)) {
    return { year, month: card.birthMonth, day: 1, precision: 'month', source: 'person-api' };
  }

  return { year, month: card.birthMonth, day: card.birthDay, precision: 'day', source: 'person-api' };
}

/** person-api accepts at most 100 ids per bulk request. */
const PERSON_API_BULK_LIMIT = 100;

export type BirthDates = {
  byPersonId: Map<string, BirthDate>;
  /** person-api is configured but did not answer; people without an Immich date were skipped. */
  personApiFailed: boolean;
};

/**
 * Birth dates for the given people: Immich's `birthDate` first, person-api (`birthYear` /
 * `birthMonth` / `birthDay`) for the rest. People with neither are simply absent from the map.
 */
export async function resolveBirthDates(people: readonly Person[], client: PersonApiClient | null): Promise<BirthDates> {
  const byPersonId = new Map<string, BirthDate>();
  const missing: string[] = [];
  let personApiFailed = false;

  for (const person of people) {
    const birthDate = parseImmichBirthDate(person.birthDate);

    if (birthDate) {
      byPersonId.set(person.id, birthDate);
    } else {
      missing.push(person.id);
    }
  }

  if (!client) {
    return { byPersonId, personApiFailed };
  }

  for (let offset = 0; offset < missing.length; offset += PERSON_API_BULK_LIMIT) {
    try {
      const { persons } = await client.getBulkPersons(missing.slice(offset, offset + PERSON_API_BULK_LIMIT));

      for (const card of persons) {
        const birthDate = birthDateFromPersonCard(card);

        if (birthDate) {
          byPersonId.set(card.id, birthDate);
        }
      }
    } catch (error) {
      console.warn('[Immich People Plus] person-api bulk request failed:', error);
      personApiFailed = true;
    }
  }

  return { byPersonId, personApiFailed };
}

function birthdayPlusYears(birthDate: BirthDate, years: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(birthDate.year + years, birthDate.month - 1, birthDate.day);
  return date;
}

/**
 * `takenAfter` = birthday + `from` years; `takenBefore` = the last instant before
 * birthday + (`to` + 1) years, so "to 5" keeps the whole last day at age 5 (Immich compares both
 * bounds inclusively against `fileCreatedAt`). An empty bound leaves that side open.
 */
export function buildAgeDateRange(birthDate: BirthDate, filter: AgeFilter): TakenDateRange {
  const range: TakenDateRange = {};

  if (filter.from !== null) {
    range.takenAfter = birthdayPlusYears(birthDate, filter.from).toISOString();
  }

  if (filter.to !== null) {
    range.takenBefore = new Date(birthdayPlusYears(birthDate, filter.to + 1).getTime() - 1).toISOString();
  }

  return range;
}

export function isSameAgeFilter(left: AgeFilter | null, right: AgeFilter | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return left.from === right.from && left.to === right.to;
}
