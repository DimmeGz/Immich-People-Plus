import { fetchAllVisiblePeople } from './api';
import {
  getPeopleGrid,
  getScrollContainer,
  mountExtensionGrid,
  removeExtensionGrid,
  renderSortedGrid,
  setOriginalGridHidden,
} from './render';
import { reorderGridFromDom, sortModeToOrder, sortPeopleByName } from './sort';
import { isExtensionContextValid, loadPeopleSortMode, savePeopleSortMode } from './storage';
import { SEARCH_PARAM, type PeopleSortMode } from './types';
import { createSortControl, mountSortControl, unmountSortControl, type SortControl } from './ui';

class PeopleSortController {
  #mode: PeopleSortMode = 'standard';
  #control: SortControl | null = null;
  #applying = false;
  #disposed = false;
  #searchWatcherTimer: number | null = null;
  #lastSearchQuery = '';

  async init(): Promise<void> {
    if (!isExtensionContextValid()) {
      return;
    }

    this.#mode = await loadPeopleSortMode();
    this.#control = createSortControl(this.#mode);
    mountSortControl(this.#control);

    this.#control.onChange((mode) => {
      void this.#handleModeChange(mode);
    });

    this.#watchSearchChanges();

    if (this.#mode !== 'standard') {
      await this.#waitForGrid();

      if (this.#disposed || !isExtensionContextValid()) {
        return;
      }

      await this.applySort(this.#mode);
    }
  }

  dispose(): void {
    this.#disposed = true;

    if (this.#searchWatcherTimer !== null) {
      window.clearInterval(this.#searchWatcherTimer);
      this.#searchWatcherTimer = null;
    }

    this.#restoreOriginalView();

    if (this.#control) {
      unmountSortControl(this.#control);
      this.#control = null;
    }
  }

  async applySort(mode: PeopleSortMode): Promise<void> {
    const order = sortModeToOrder(mode);

    if (!order || this.#applying) {
      return;
    }

    this.#applying = true;
    this.#control?.setBusy(true);

    try {
      if (this.#isSearching()) {
        this.#restoreOriginalView();
        reorderGridFromDom(order);
        return;
      }

      const people = await fetchAllVisiblePeople();
      const sortedPeople = sortPeopleByName(people, order);

      setOriginalGridHidden(true);
      removeExtensionGrid();
      mountExtensionGrid(renderSortedGrid(sortedPeople));

      getScrollContainer()?.scrollTo(0, 0);
    } catch (error) {
      console.error('[Immich Extension] Failed to sort people:', error);
      this.#control?.setBusy(false, 'Sort failed');
      window.setTimeout(() => this.#control?.setBusy(false), 2000);
      return;
    } finally {
      this.#applying = false;
      this.#control?.setBusy(false);
    }
  }

  async #handleModeChange(mode: PeopleSortMode): Promise<void> {
    if (!isExtensionContextValid()) {
      return;
    }

    const previousMode = this.#mode;
    this.#mode = mode;
    await savePeopleSortMode(mode);

    if (mode === 'standard') {
      if (previousMode !== 'standard') {
        window.location.reload();
      }

      return;
    }

    await this.applySort(mode);
  }

  #restoreOriginalView(): void {
    removeExtensionGrid();
    setOriginalGridHidden(false);
  }

  #watchSearchChanges(): void {
    this.#lastSearchQuery = this.#getSearchQuery();

    this.#searchWatcherTimer = window.setInterval(() => {
      if (this.#disposed || this.#mode === 'standard' || !isExtensionContextValid()) {
        return;
      }

      const searchQuery = this.#getSearchQuery();

      if (searchQuery === this.#lastSearchQuery) {
        return;
      }

      this.#lastSearchQuery = searchQuery;
      void this.applySort(this.#mode);
    }, 300);
  }

  #getSearchQuery(): string {
    return new URLSearchParams(window.location.search).get(SEARCH_PARAM) ?? '';
  }

  #isSearching(): boolean {
    return this.#getSearchQuery().length > 0;
  }

  async #waitForGrid(timeoutMs = 10_000): Promise<void> {
    const startedAt = Date.now();

    while (!getPeopleGrid() && Date.now() - startedAt < timeoutMs) {
      if (this.#disposed || !isExtensionContextValid()) {
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }
}

export function isPeopleListPage(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return normalized === '/people';
}

export function createPeopleSortController(): PeopleSortController {
  return new PeopleSortController();
}

export type { PeopleSortController };
