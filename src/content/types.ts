export type PeopleSortMode = 'standard' | 'name-asc' | 'name-desc';

export type Person = {
  id: string;
  name: string;
  isHidden: boolean;
  updatedAt?: string;
  isFavorite?: boolean;
};

export type PeoplePageResponse = {
  people: Person[];
  hasNextPage: boolean;
  total: number;
  hidden: number;
};

export const STORAGE_KEY = 'immichExtension.peopleSortMode';

export const SEARCH_PARAM = 'searchedPeople';
