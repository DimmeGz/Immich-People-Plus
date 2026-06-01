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

export const FOLDER_FILTER_STORAGE_PREFIX = 'immichExtension.folderFilter.';

export const SEARCH_PARAM = 'searchedPeople';

export const FOLDER_PATH_PARAM = 'path';

export type FolderAsset = {
  id: string;
  originalPath: string;
  originalFileName: string;
  width: number;
  height: number;
  thumbhash?: string | null;
  people: Person[];
};

export type FolderPersonSummary = {
  person: Person;
  assetCount: number;
};

export type FolderFilter =
  | { type: 'all' }
  | { type: 'person'; personId: string }
  | { type: 'others' };
