/**
 * Shared by the content script (isolated world, src/content) and the page script (main world,
 * src/page) of the `/photos` age filter. No chrome.* APIs here: the page script cannot use them.
 *
 * Flow: the content script stores the filter in sessionStorage and reloads the page. At
 * document_start the page script sees the key, wraps `window.fetch` and holds Immich's timeline
 * requests. The content script computes the matching asset ids and posts them; the page script then
 * answers Immich's own timeline requests with only those assets, so Immich keeps its native
 * timeline (day groups, year scrubber, viewer navigation).
 */

/** sessionStorage key holding the active `/photos` age filter as `{ from, to }`. */
export const PHOTOS_AGE_FILTER_KEY = 'immichPeoplePlus.photosAgeFilter';

export const MESSAGE_SOURCE = 'immich-people-plus:age-filter';

/** Matching asset: id and the month keys (`YYYY-MM`) Immich files it under, by taken date and by upload date. */
export type AllowedAsset = [id: string, takenMonth: string, createdMonth: string];

export type ContentMessage =
  /** Content script is alive and computing; also asks the page script for its state. */
  | { source: typeof MESSAGE_SOURCE; from: 'content'; type: 'started' }
  | { source: typeof MESSAGE_SOURCE; from: 'content'; type: 'result'; assets: AllowedAsset[] }
  | { source: typeof MESSAGE_SOURCE; from: 'content'; type: 'failed' };

export type PageFilterState =
  /** Holding timeline requests until the content script sends the result. */
  | 'waiting'
  /** Timeline requests are being filtered. */
  | 'applied'
  /** The content script reported a failure: the timeline is shown unfiltered. */
  | 'failed'
  /** No answer from the content script in time: the timeline is shown unfiltered. */
  | 'timeout'
  /** Immich answered in an unexpected format: the timeline is shown unfiltered. */
  | 'unsupported'
  /** Left `/photos`: filter switched off for this page load. */
  | 'off';

export type PageMessage = {
  source: typeof MESSAGE_SOURCE;
  from: 'page';
  type: 'state';
  state: PageFilterState;
  detail?: string;
};

export function isPhotosPath(pathname: string): boolean {
  return /^\/photos(?:\/|$)/.test(pathname);
}

/** `YYYY-MM` of an ISO datetime in UTC, the way Immich truncates `localDateTime` / `createdAt` into months. */
export function monthKeyOf(isoDateTime: string): string | null {
  const date = new Date(isoDateTime);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export type AllowedIndex = {
  ids: Set<string>;
  takenCounts: Map<string, number>;
  createdCounts: Map<string, number>;
};

export function buildAllowedIndex(assets: readonly AllowedAsset[]): AllowedIndex {
  const index: AllowedIndex = { ids: new Set(), takenCounts: new Map(), createdCounts: new Map() };

  for (const [id, takenMonth, createdMonth] of assets) {
    if (index.ids.has(id)) {
      continue;
    }

    index.ids.add(id);
    index.takenCounts.set(takenMonth, (index.takenCounts.get(takenMonth) ?? 0) + 1);
    index.createdCounts.set(createdMonth, (index.createdCounts.get(createdMonth) ?? 0) + 1);
  }

  return index;
}

export class UnknownTimelineFormatError extends Error {}

type TimeBucket = { timeBucket: string; count: number };

function isTimeBucket(value: unknown): value is TimeBucket {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as TimeBucket).timeBucket === 'string' &&
    typeof (value as TimeBucket).count === 'number'
  );
}

/**
 * `GET /api/timeline/buckets`: `[{ timeBucket: 'YYYY-MM-DD', count }]`. Keeps months that contain
 * matching assets and replaces the count (capped by Immich's own count: Immich shows only the
 * primary asset of a stack, the search counts every stacked asset).
 */
export function filterTimeBuckets(data: unknown, index: AllowedIndex, orderBy: string | null): TimeBucket[] {
  if (!Array.isArray(data)) {
    throw new UnknownTimelineFormatError('timeline/buckets: expected an array');
  }

  const counts = orderBy === 'createdAt' ? index.createdCounts : index.takenCounts;
  const result: TimeBucket[] = [];

  for (const bucket of data) {
    if (!isTimeBucket(bucket)) {
      throw new UnknownTimelineFormatError('timeline/buckets: unexpected item');
    }

    const match = /^(\d{4,})-(\d{2})/.exec(bucket.timeBucket.replace(/^[+-]/, ''));

    if (!match) {
      throw new UnknownTimelineFormatError(`timeline/buckets: unexpected timeBucket "${bucket.timeBucket}"`);
    }

    const count = Math.min(counts.get(`${match[1]}-${match[2]}`) ?? 0, bucket.count);

    if (count > 0) {
      result.push({ ...bucket, count });
    }
  }

  return result;
}

/**
 * `GET /api/timeline/bucket`: one month in columnar form (`{ id: [...], ratio: [...], ... }`, every
 * array indexed like `id`). Keeps only the positions whose id is allowed, in every column, so columns
 * Immich adds later are filtered too.
 */
export function filterTimeBucketAssets(data: unknown, index: AllowedIndex): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { id?: unknown }).id)) {
    throw new UnknownTimelineFormatError('timeline/bucket: expected an object with an id array');
  }

  const ids = (data as { id: unknown[] }).id;
  const keep = ids.map((id) => typeof id === 'string' && index.ids.has(id));
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) {
      result[key] = value;
      continue;
    }

    if (value.length !== ids.length) {
      throw new UnknownTimelineFormatError(
        `timeline/bucket: column "${key}" has ${value.length} items, id has ${ids.length}`,
      );
    }

    result[key] = value.filter((_, position) => keep[position]);
  }

  return result;
}
