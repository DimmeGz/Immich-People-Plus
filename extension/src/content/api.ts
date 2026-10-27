import type { PeoplePageResponse, Person } from './types';

export async function fetchPeoplePage(page: number, size = 1000): Promise<PeoplePageResponse> {
  const response = await fetch(`/api/people?withHidden=true&page=${page}&size=${size}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch people (${response.status})`);
  }

  return response.json() as Promise<PeoplePageResponse>;
}

export async function fetchAllVisiblePeople(): Promise<Person[]> {
  const people: Person[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await fetchPeoplePage(page);
    people.push(...data.people);
    hasNextPage = data.hasNextPage;
    page += 1;
  }

  return people.filter((person) => !person.isHidden);
}

export type TakenDateRange = {
  /** ISO datetime, inclusive. */
  takenAfter?: string;
  /** ISO datetime, inclusive (Immich compares `fileCreatedAt <= takenBefore`). */
  takenBefore?: string;
};

export type AssetDates = {
  id: string;
  /** Immich groups the timeline by this (local wall-clock time stored as UTC). */
  localDateTime: string;
  /** Upload time; used when the timeline is ordered by "date added". */
  createdAt: string;
};

type AssetSearchResponse = {
  assets: {
    items: Array<{ id: string; localDateTime?: string; createdAt?: string; fileCreatedAt?: string }>;
    nextPage: string | null;
  };
};

/**
 * Ids and dates of every photo of one person taken inside the range, via the regular
 * `POST /api/search/metadata` (same endpoint and paging as the folder filter).
 */
export async function searchPersonAssetDates(personId: string, range: TakenDateRange): Promise<AssetDates[]> {
  const assets: AssetDates[] = [];
  let page = 1;

  while (page > 0) {
    const response = await fetch('/api/search/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personIds: [personId], ...range, size: 1000, page }),
    });

    if (!response.ok) {
      throw new Error(`Failed to search person assets (${response.status})`);
    }

    const data = (await response.json()) as AssetSearchResponse;

    for (const asset of data.assets.items) {
      const localDateTime = asset.localDateTime ?? asset.fileCreatedAt;

      if (localDateTime) {
        assets.push({ id: asset.id, localDateTime, createdAt: asset.createdAt ?? localDateTime });
      }
    }

    const nextPage = data.assets.nextPage ? Number(data.assets.nextPage) : 0;
    page = Number.isFinite(nextPage) && nextPage > page ? nextPage : 0;
  }

  return assets;
}

export type AssetPeople = {
  id: string;
  /** Local wall-clock time of the photo, stored as UTC; Immich computes ages from it. */
  localDateTime: string | null;
  /** People with a recognised face on the photo, hidden ones included, with Immich's `birthDate`. */
  people: Person[];
};

/** `GET /api/assets/<id>`: the same request Immich's viewer makes for the info panel. */
export async function fetchAssetPeople(assetId: string): Promise<AssetPeople> {
  const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch asset (${response.status})`);
  }

  const data = (await response.json()) as { id?: string; localDateTime?: string | null; people?: Person[] | null };

  return {
    id: data.id ?? assetId,
    localDateTime: data.localDateTime ?? null,
    people: Array.isArray(data.people) ? data.people : [],
  };
}
