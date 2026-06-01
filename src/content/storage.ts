import { STORAGE_KEY, type PeopleSortMode } from './types';

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
