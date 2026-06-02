import { normalizeFolderPath } from './folder-utils';
import {
  FOLDER_FILTER_STORAGE_PREFIX,
  PEOPLE_TAG_FILTER_KEY,
  PERSON_API_SETTINGS_KEY,
  STORAGE_KEY,
  type FolderFilter,
  type PeopleSortMode,
} from './types';

export type PersonApiSettings = {
  baseUrl: string;
  apiKey: string;
};

function getFolderFilterStorageKey(folderPath: string): string {
  return `${FOLDER_FILTER_STORAGE_PREFIX}${normalizeFolderPath(folderPath)}`;
}

function parseFolderFilter(value: unknown): FolderFilter | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const filter = value as FolderFilter;

  if (filter.type === 'all' || filter.type === 'others') {
    return filter;
  }

  if (filter.type === 'person' && typeof filter.personId === 'string') {
    return filter;
  }

  if (filter.type === 'tag' && typeof filter.tagId === 'string') {
    return filter;
  }

  return null;
}

function parseMode(value: unknown): PeopleSortMode | null {
  if (value === 'standard' || value === 'name-asc' || value === 'name-desc') {
    return value;
  }

  return null;
}

export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export async function loadPeopleSortMode(): Promise<PeopleSortMode> {
  const sessionMode = parseMode(sessionStorage.getItem(STORAGE_KEY));

  if (sessionMode) {
    return sessionMode;
  }

  if (!isExtensionContextValid()) {
    return 'standard';
  }

  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const mode = parseMode(stored[STORAGE_KEY]);

    if (mode) {
      sessionStorage.setItem(STORAGE_KEY, mode);
      return mode;
    }
  } catch {
    // Extension was reloaded while this tab stayed open.
  }

  return 'standard';
}

export async function savePeopleSortMode(mode: PeopleSortMode): Promise<void> {
  sessionStorage.setItem(STORAGE_KEY, mode);

  if (!isExtensionContextValid()) {
    return;
  }

  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: mode });
  } catch {
    // Keep working in this tab via sessionStorage only.
  }
}

function parseTagFilter(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function loadPeopleTagFilter(): Promise<string | null> {
  const sessionTagId = parseTagFilter(sessionStorage.getItem(PEOPLE_TAG_FILTER_KEY));

  if (sessionTagId) {
    return sessionTagId;
  }

  if (!isExtensionContextValid()) {
    return null;
  }

  try {
    const stored = await chrome.storage.local.get(PEOPLE_TAG_FILTER_KEY);
    const tagId = parseTagFilter(stored[PEOPLE_TAG_FILTER_KEY]);

    if (tagId) {
      sessionStorage.setItem(PEOPLE_TAG_FILTER_KEY, tagId);
      return tagId;
    }
  } catch {
    // Extension was reloaded while this tab stayed open.
  }

  return null;
}

export async function savePeopleTagFilter(tagId: string | null): Promise<void> {
  if (tagId) {
    sessionStorage.setItem(PEOPLE_TAG_FILTER_KEY, tagId);
  } else {
    sessionStorage.removeItem(PEOPLE_TAG_FILTER_KEY);
  }

  if (!isExtensionContextValid()) {
    return;
  }

  try {
    await chrome.storage.local.set({ [PEOPLE_TAG_FILTER_KEY]: tagId ?? '' });
  } catch {
    // Keep working in this tab via sessionStorage only.
  }
}

export function loadFolderFilter(folderPath: string): FolderFilter | null {
  const raw = sessionStorage.getItem(getFolderFilterStorageKey(folderPath));

  if (!raw) {
    return null;
  }

  try {
    return parseFolderFilter(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveFolderFilter(folderPath: string, filter: FolderFilter): void {
  const key = getFolderFilterStorageKey(folderPath);

  if (filter.type === 'all') {
    sessionStorage.removeItem(key);
    return;
  }

  sessionStorage.setItem(key, JSON.stringify(filter));
}

function parsePersonApiSettings(value: unknown): PersonApiSettings | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const settings = value as Partial<PersonApiSettings>;

  if (typeof settings.baseUrl !== 'string' || typeof settings.apiKey !== 'string') {
    return null;
  }

  return {
    baseUrl: settings.baseUrl.trim(),
    apiKey: settings.apiKey.trim(),
  };
}

export async function loadPersonApiSettings(): Promise<PersonApiSettings | null> {
  const sessionRaw = sessionStorage.getItem(PERSON_API_SETTINGS_KEY);

  if (sessionRaw) {
    try {
      const parsed = parsePersonApiSettings(JSON.parse(sessionRaw));
      if (parsed) {
        return parsed;
      }
    } catch {
      // ignore invalid session value
    }
  }

  if (!isExtensionContextValid()) {
    return null;
  }

  try {
    const stored = await chrome.storage.local.get(PERSON_API_SETTINGS_KEY);
    const parsed = parsePersonApiSettings(stored[PERSON_API_SETTINGS_KEY]);

    if (!parsed) {
      return null;
    }

    sessionStorage.setItem(PERSON_API_SETTINGS_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return null;
  }
}

export async function savePersonApiSettings(settings: PersonApiSettings): Promise<void> {
  const normalized: PersonApiSettings = {
    baseUrl: settings.baseUrl.trim().replace(/\/$/, ''),
    apiKey: settings.apiKey.trim(),
  };

  sessionStorage.setItem(PERSON_API_SETTINGS_KEY, JSON.stringify(normalized));

  if (!isExtensionContextValid()) {
    return;
  }

  await chrome.storage.local.set({ [PERSON_API_SETTINGS_KEY]: normalized });
}
