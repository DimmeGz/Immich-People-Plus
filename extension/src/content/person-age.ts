import type { BirthDate } from './types';

/** Languages the age label is written in; anything else falls back to English, like Immich does. */
export type AgeLanguage = 'uk' | 'en';

export type CalendarDate = { year: number; month: number; day: number };

function utcDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function daysInMonth(year: number, month: number): number {
  return utcDate(year, month, 0).getUTCDate();
}

function compareDates(left: CalendarDate, right: CalendarDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

function addMonthsClamped(date: CalendarDate, months: number): CalendarDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/**
 * Whole months from `birth` to `date`, counted like Immich (luxon `diff`): a month is complete on the
 * same day of the month, clamped to the month's last day (born 31 Jan: one month on 28/29 Feb).
 * Negative before the birth date.
 */
export function completedMonths(birth: CalendarDate, date: CalendarDate): number {
  let months = (date.year - birth.year) * 12 + (date.month - birth.month);

  if (compareDates(addMonthsClamped(birth, months), date) > 0) {
    months -= 1;
  }

  return months;
}

/**
 * Calendar day of a photo from Immich's `localDateTime`: the wall-clock time where the photo was
 * taken, stored as if it were UTC, so its date part is the local date.
 */
export function photoDateFromLocalDateTime(value: string | null | undefined): CalendarDate | null {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;

  if (!match) {
    return null;
  }

  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= 31 ? date : null;
}

const ukPlural = new Intl.PluralRules('uk');
const enPlural = new Intl.PluralRules('en');

function ukMonths(count: number): string {
  switch (ukPlural.select(count)) {
    case 'one':
      return 'місяць';
    case 'few':
      return 'місяці';
    default:
      return 'місяців';
  }
}

function enMonths(count: number): string {
  return enPlural.select(count) === 'one' ? 'month' : 'months';
}

/** Same wording as Immich's `age_months`, `age_year_months` and `age_years` (i18n/uk.json, en.json). */
const AGE_TEXT = {
  uk: {
    months: (n: number) => `Вік ${n} ${ukMonths(n)}`,
    yearMonths: (n: number) => `Вік 1 рік, ${n} ${ukMonths(n)}`,
    years: (n: number) => `Вік ${n}`,
    monthsRange: (from: number, to: number) => `Вік ${from}–${to} ${ukMonths(to)}`,
    yearsRange: (from: number, to: number) => `Вік ${from}–${to}`,
    yearOnly: 'відомий лише рік',
    monthOnly: 'відомі лише рік і місяць',
  },
  en: {
    months: (n: number) => `Age ${n} ${enMonths(n)}`,
    yearMonths: (n: number) => `Age 1 year, ${n} ${enMonths(n)}`,
    years: (n: number) => `Age ${n}`,
    monthsRange: (from: number, to: number) => `Age ${from}–${to} ${enMonths(to)}`,
    yearsRange: (from: number, to: number) => `Age ${from}–${to}`,
    yearOnly: 'year only',
    monthOnly: 'year and month only',
  },
} satisfies Record<AgeLanguage, unknown>;

/** Immich's rules in DetailPanelPeople.svelte, including its quirk that exactly 12 months reads "Age 1". */
function exactAgeLabel(months: number, language: AgeLanguage): string {
  const text = AGE_TEXT[language];

  if (months < 12) {
    return text.months(months);
  }

  if (months > 12 && months < 24) {
    return text.yearMonths(months - 12);
  }

  return text.years(Math.floor(months / 12));
}

function earliestBirthDay(birth: BirthDate): CalendarDate {
  return {
    year: birth.year,
    month: birth.precision === 'year' ? 1 : birth.month,
    day: birth.precision === 'day' ? birth.day : 1,
  };
}

function latestBirthDay(birth: BirthDate): CalendarDate {
  if (birth.precision === 'day') {
    return { year: birth.year, month: birth.month, day: birth.day };
  }

  const month = birth.precision === 'month' ? birth.month : 12;
  return { year: birth.year, month, day: daysInMonth(birth.year, month) };
}

/**
 * Age on the photo in Immich's wording ("Вік 5", "Вік 3 місяці"), or null when the person was not
 * born yet. When person-api knows only the year (or year and month) and the age is not certain,
 * it is a range: "Вік 4–5", or "Вік 0–7 місяців" for babies.
 */
export function formatAgeOnPhoto(birth: BirthDate, photo: CalendarDate, language: AgeLanguage): string | null {
  const maxMonths = completedMonths(earliestBirthDay(birth), photo);

  if (maxMonths < 0) {
    return null;
  }

  const minMonths = Math.max(0, completedMonths(latestBirthDay(birth), photo));
  const label = exactAgeLabel(maxMonths, language);

  if (exactAgeLabel(minMonths, language) === label) {
    return label;
  }

  const text = AGE_TEXT[language];

  if (maxMonths < 12) {
    return text.monthsRange(minMonths, maxMonths);
  }

  const minYears = Math.floor(minMonths / 12);
  const maxYears = Math.floor(maxMonths / 12);
  return minYears === maxYears ? text.years(maxYears) : text.yearsRange(minYears, maxYears);
}

/** Tooltip for the age, like Immich's (the birth date), plus where the date came from. */
export function describeBirthDate(birth: BirthDate, language: AgeLanguage, locale?: string): string {
  const options: Intl.DateTimeFormatOptions =
    birth.precision === 'day'
      ? { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
      : birth.precision === 'month'
        ? { year: 'numeric', month: 'long', timeZone: 'UTC' }
        : { year: 'numeric', timeZone: 'UTC' };
  const date = utcDate(birth.year, birth.month - 1, birth.day);
  let formatted: string;

  try {
    formatted = new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    formatted = new Intl.DateTimeFormat(undefined, options).format(date);
  }

  const text = AGE_TEXT[language];
  const note = birth.precision === 'year' ? text.yearOnly : birth.precision === 'month' ? text.monthOnly : '';
  return `${formatted} · ${birth.source}${note ? `, ${note}` : ''}`;
}

/** Immich keeps its settings in localStorage through svelte-persisted-store (JSON strings). */
function readImmichSetting(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);

    if (raw === null) {
      return null;
    }

    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === 'string' ? value : null;
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

/** Immich's interface language (`lang`), or the browser's when Immich has not stored one. */
export function immichAgeLanguage(): AgeLanguage {
  const language = readImmichSetting('lang') ?? navigator.language;
  return /^uk(?:\b|[-_])/i.test(language) ? 'uk' : 'en';
}

/** Immich's date format locale (`locale`); "default" means the browser's. */
export function immichDateLocale(): string | undefined {
  const locale = readImmichSetting('locale');
  return locale && locale !== 'default' ? locale : undefined;
}
