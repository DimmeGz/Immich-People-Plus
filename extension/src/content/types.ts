export type PeopleSortMode = 'standard' | 'name-asc' | 'name-desc';

export type Person = {
  id: string;
  name: string;
  isHidden: boolean;
  updatedAt?: string;
  isFavorite?: boolean;
};

export type SocialLink = {
  label?: string | null;
  url: string;
};

export type PersonTag = {
  id: string;
  name: string;
  color?: string | null;
};

export type PersonCard = {
  id: string;
  birthYear?: number | null;
  birthMonth?: number | null;
  birthDay?: number | null;
  notes?: string | null;
  social: SocialLink[];
  tags: PersonTag[];
};

export type PeoplePageResponse = {
  people: Person[];
  hasNextPage: boolean;
  total: number;
  hidden: number;
};

export const STORAGE_KEY = 'immichPeoplePlus.peopleSortMode';

export const FOLDER_FILTER_STORAGE_PREFIX = 'immichPeoplePlus.folderFilter.';
export const PERSON_API_SETTINGS_KEY = 'immichPeoplePlus.personApiSettings';

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
  | { type: 'others' }
  | { type: 'tag'; tagId: string };
