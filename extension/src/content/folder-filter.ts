import { fetchFolderAssets } from './folder-api';
import {
  clearFilteredGallery,
  resetFilteredGalleryState,
  showFilteredGallery,
  waitForGalleryAssets,
} from './folder-gallery';
import { PersonApiClient } from './person-api-client';
import {
  buildPersonSummaries,
  countOtherPhotos,
  getFolderPathFromUrl,
  getVisibleAssetIds,
  isFoldersPage,
} from './folder-utils';
import { isExtensionContextValid, loadFolderFilter, saveFolderFilter } from './storage';
import { createFolderFilterBar, mountFolderFilterBar, unmountFolderFilterBar, type FolderFilterBar } from './folder-ui';
import type { FolderAsset, FolderFilter } from './types';

type DisposeOptions = {
  preserveGallery?: boolean;
};

class FolderFilterController {
  #folderPath: string;
  #assets: FolderAsset[] = [];
  #filter: FolderFilter = { type: 'all' };
  #bar: FolderFilterBar | null = null;
  #disposed = false;
  #personApiClient: PersonApiClient | null = null;
  #tagPersonIds = new Map<string, Set<string>>();
  #tagCounts: Array<{ id: string; name: string; count: number }> = [];

  constructor(folderPath: string) {
    this.#folderPath = folderPath;
  }

  async init(): Promise<void> {
    const hasGallery = await waitForGalleryAssets();

    if ((!hasGallery && !document.querySelector('[data-immich-people-plus="filtered-gallery"]')) || this.#disposed || !isExtensionContextValid()) {
      return;
    }

    this.#personApiClient = await PersonApiClient.create();

    try {
      this.#assets = await fetchFolderAssets(this.#folderPath);
    } catch (error) {
      console.error('[Immich People Plus] Failed to load folder people:', error);
      return;
    }

    if (this.#disposed) {
      return;
    }

    const people = buildPersonSummaries(this.#assets);
    const otherPhotosCount = countOtherPhotos(this.#assets);
    await this.#loadTagData(people.map((summary) => summary.person.id));

    if (people.length === 0 && otherPhotosCount === 0) {
      return;
    }

    this.#bar = createFolderFilterBar({
      people,
      otherPhotosCount,
      tags: this.#tagCounts,
      onFilterChange: (filter) => {
        this.#setFilter(filter);
      },
    });

    mountFolderFilterBar(this.#bar);
    this.#restoreSavedFilter();
  }

  setBarVisible(visible: boolean): void {
    if (!this.#bar) {
      return;
    }

    if (visible && !this.#bar.root.isConnected) {
      mountFolderFilterBar(this.#bar);
    }

    this.#bar.setVisible(visible);
  }

  dispose(options: DisposeOptions = {}): void {
    this.#disposed = true;

    if (this.#bar) {
      unmountFolderFilterBar(this.#bar);
      this.#bar = null;
    }

    if (!options.preserveGallery) {
      resetFilteredGalleryState();
    } else {
      clearFilteredGallery();
    }
  }

  #restoreSavedFilter(): void {
    const savedFilter = loadFolderFilter(this.#folderPath);

    if (!savedFilter || savedFilter.type === 'all') {
      return;
    }

    const visibleAssetIds =
      savedFilter.type === 'tag'
        ? this.#getVisibleIdsByTag(savedFilter.tagId)
        : getVisibleAssetIds(this.#assets, savedFilter);

    if (visibleAssetIds.size === 0) {
      saveFolderFilter(this.#folderPath, { type: 'all' });
      return;
    }

    this.#filter = savedFilter;
    this.#bar?.setFilter(savedFilter);
    this.#applyCurrentFilter();
  }

  #setFilter(filter: FolderFilter): void {
    this.#filter = filter;
    saveFolderFilter(this.#folderPath, filter);
    this.#bar?.setFilter(filter);
    this.#applyCurrentFilter();
  }

  #applyCurrentFilter(): void {
    if (this.#filter.type === 'all') {
      clearFilteredGallery();
      return;
    }

    const visibleAssetIds =
      this.#filter.type === 'tag'
        ? this.#getVisibleIdsByTag(this.#filter.tagId)
        : getVisibleAssetIds(this.#assets, this.#filter);
    const visibleAssets = this.#assets.filter((asset) => visibleAssetIds.has(asset.id));

    if (visibleAssets.length === 0) {
      clearFilteredGallery();
      return;
    }

    showFilteredGallery(visibleAssets, this.#folderPath);
  }

  #getVisibleIdsByTag(tagId: string): Set<string> {
    const peopleWithTag = this.#tagPersonIds.get(tagId);

    if (!peopleWithTag || peopleWithTag.size === 0) {
      return new Set();
    }

    return new Set(
      this.#assets
        .filter((asset) => asset.people.some((person) => peopleWithTag.has(person.id)))
        .map((asset) => asset.id),
    );
  }

  async #loadTagData(personIds: string[]): Promise<void> {
    if (!this.#personApiClient || personIds.length === 0) {
      this.#tagPersonIds.clear();
      this.#tagCounts = [];
      return;
    }

    try {
      const response = await this.#personApiClient.getBulkPersons(personIds);
      const tagsMap = new Map<string, { id: string; name: string; personIds: Set<string> }>();

      for (const person of response.persons) {
        for (const tag of person.tags) {
          let entry = tagsMap.get(tag.id);

          if (!entry) {
            entry = { id: tag.id, name: tag.name, personIds: new Set<string>() };
            tagsMap.set(tag.id, entry);
          }

          entry.personIds.add(person.id);
        }
      }

      this.#tagPersonIds.clear();
      this.#tagCounts = [];

      for (const entry of tagsMap.values()) {
        this.#tagPersonIds.set(entry.id, entry.personIds);
        const count = this.#assets.filter((asset) =>
          asset.people.some((person) => entry!.personIds.has(person.id)),
        ).length;

        if (count > 0) {
          this.#tagCounts.push({ id: entry.id, name: entry.name, count });
        }
      }
    } catch (error) {
      console.error('[Immich People Plus] Failed to load person-api tags:', error);
      this.#tagPersonIds.clear();
      this.#tagCounts = [];
    }
  }
}

export function isFolderAssetsPage(): boolean {
  if (!isFoldersPage(window.location.pathname)) {
    return false;
  }

  return getFolderPathFromUrl() !== null;
}

export function isFolderPhotoViewerPage(): boolean {
  return /\/folders\/photos\//.test(window.location.pathname) && getFolderPathFromUrl() !== null;
}

export function createFolderFilterController(folderPath: string): FolderFilterController {
  return new FolderFilterController(folderPath);
}

export type { FolderFilterController };
