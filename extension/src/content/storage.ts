import { normalizeFolderPath } from './folder-utils';
import {
  FOLDER_FILTER_STORAGE_PREFIX,
  STORAGE_KEY,
  type FolderFilter,
  type PeopleSortMode,
} from './types';

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
