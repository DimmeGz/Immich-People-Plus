import { fetchFolderAssets } from './folder-api';
import { clearFilteredGallery, showFilteredGallery, waitForGalleryAssets } from './folder-gallery';
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

  constructor(folderPath: string) {
    this.#folderPath = folderPath;
  }

  async init(): Promise<void> {
    const hasGallery = await waitForGalleryAssets();

    if ((!hasGallery && !document.querySelector('[data-immich-extension="filtered-gallery"]')) || this.#disposed || !isExtensionContextValid()) {
      return;
    }

    try {
      this.#assets = await fetchFolderAssets(this.#folderPath);
    } catch (error) {
      console.error('[Immich Extension] Failed to load folder people:', error);
      return;
    }

    if (this.#disposed) {
      return;
    }

    const people = buildPersonSummaries(this.#assets);
    const otherPhotosCount = countOtherPhotos(this.#assets);

    if (people.length === 0 && otherPhotosCount === 0) {
      return;
    }

    this.#bar = createFolderFilterBar({
      people,
      otherPhotosCount,
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
      clearFilteredGallery();
    }
  }

  #restoreSavedFilter(): void {
    const savedFilter = loadFolderFilter(this.#folderPath);

    if (!savedFilter || savedFilter.type === 'all') {
      return;
    }

    const visibleAssetIds = getVisibleAssetIds(this.#assets, savedFilter);

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

    const visibleAssetIds = getVisibleAssetIds(this.#assets, this.#filter);
    const visibleAssets = this.#assets.filter((asset) => visibleAssetIds.has(asset.id));

    if (visibleAssets.length === 0) {
      clearFilteredGallery();
      return;
    }

    showFilteredGallery(visibleAssets, this.#folderPath);
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
