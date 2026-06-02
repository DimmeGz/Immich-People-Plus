import { fetchAllVisiblePeople } from './api';
import { PersonApiClient } from './person-api-client';
import {
  getPeopleGrid,
  getScrollContainer,
  mountExtensionGrid,
  removeExtensionGrid,
  renderSortedGrid,
  setOriginalGridHidden,
} from './render';
import { reorderGridFromDom, sortModeToOrder, sortPeopleByName } from './sort';
import {
  isExtensionContextValid,
  loadPeopleSortMode,
  loadPeopleTagFilter,
  savePeopleSortMode,
  savePeopleTagFilter,
} from './storage';
import { SEARCH_PARAM, type PeopleSortMode } from './types';
import {
  createSortControl,
  createTagFilterControl,
  mountPeopleToolbarControls,
  unmountSortControl,
  unmountTagFilterControl,
  type SortControl,
  type TagFilterControl,
} from './ui';

class PeopleSortController {
  #mode: PeopleSortMode = 'standard';
  #tagId: string | null = null;
  #apiClient: PersonApiClient | null = null;
  #control: SortControl | null = null;
  #tagControl: TagFilterControl | null = null;
  #applying = false;
  #disposed = false;
  #searchWatcherTimer: number | null = null;
  #lastSearchQuery = '';

  async init(): Promise<void> {
    if (!isExtensionContextValid()) {
      return;
    }

    this.#apiClient = await PersonApiClient.create();
    this.#mode = await loadPeopleSortMode();
    this.#tagId = await loadPeopleTagFilter();

    this.#control = createSortControl(this.#mode);
    const toolbarControls = [this.#control.root];

    if (this.#apiClient) {
      this.#tagControl = createTagFilterControl(this.#tagId);
      toolbarControls.unshift(this.#tagControl.root);

      try {
        const { tags } = await this.#apiClient.getTags();
        this.#tagControl.setTags(tags);

        if (this.#tagId && !tags.some((tag) => tag.id === this.#tagId)) {
          this.#tagId = null;
          await savePeopleTagFilter(null);
          this.#tagControl.setValue(null);
        }
      } catch (error) {
        console.warn('[Immich People Plus] Failed to load tags for people filter:', error);
      }
    }

    mountPeopleToolbarControls(toolbarControls);

    this.#control.onChange((mode) => {
      void this.#handleModeChange(mode);
    });

    this.#tagControl?.onChange((tagId) => {
      void this.#handleTagChange(tagId);
    });

    this.#watchSearchChanges();

    if (this.#needsCustomGrid()) {
      await this.#waitForGrid();

      if (this.#disposed || !isExtensionContextValid()) {
        return;
      }

      await this.applyView();
    }
  }

  dispose(): void {
    this.#disposed = true;

    if (this.#searchWatcherTimer !== null) {
      window.clearInterval(this.#searchWatcherTimer);
      this.#searchWatcherTimer = null;
    }

    this.#restoreOriginalView();

    if (this.#tagControl) {
      unmountTagFilterControl(this.#tagControl);
      this.#tagControl = null;
    }

    if (this.#control) {
      unmountSortControl(this.#control);
      this.#control = null;
    }
  }

  async applySort(mode: PeopleSortMode): Promise<void> {
    this.#mode = mode;
    await this.applyView();
  }

  async applyView(): Promise<void> {
    const order = sortModeToOrder(this.#mode);
    const hasTagFilter = this.#tagId !== null;

    if (!this.#needsCustomGrid()) {
      this.#restoreOriginalView();
      return;
    }

    if (this.#applying) {
      return;
    }

    this.#applying = true;
    this.#control?.setBusy(true);
    this.#tagControl?.setBusy(true);

    try {
      if (this.#isSearching()) {
        this.#restoreOriginalView();

        if (order) {
          reorderGridFromDom(order);
        }

        return;
      }

      let people = await fetchAllVisiblePeople();

      if (hasTagFilter) {
        if (!this.#apiClient) {
          return;
        }

        const { personIds } = await this.#apiClient.getPeopleByTag(this.#tagId!);
        const allowedIds = new Set(personIds);
        people = people.filter((person) => allowedIds.has(person.id));
      }

      if (order) {
        people = sortPeopleByName(people, order);
      }

      setOriginalGridHidden(true);
      removeExtensionGrid();
      mountExtensionGrid(renderSortedGrid(people));

      getScrollContainer()?.scrollTo(0, 0);
    } catch (error) {
      console.error('[Immich People Plus] Failed to update people view:', error);
      this.#control?.setBusy(false, 'Update failed');
      this.#tagControl?.setBusy(false, 'Update failed');
      window.setTimeout(() => {
        this.#control?.setBusy(false);
        this.#tagControl?.setBusy(false);
      }, 2000);
      return;
    } finally {
      this.#applying = false;
      this.#control?.setBusy(false);
      this.#tagControl?.setBusy(false);
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
      if (this.#tagId === null) {
        if (previousMode !== 'standard') {
          window.location.reload();
        }

        return;
      }

      await this.applyView();
      return;
    }

    await this.applyView();
  }

  async #handleTagChange(tagId: string | null): Promise<void> {
    if (!isExtensionContextValid()) {
      return;
    }

    this.#tagId = tagId;
    await savePeopleTagFilter(tagId);

    if (tagId === null && this.#mode === 'standard') {
      window.location.reload();
      return;
    }

    await this.applyView();
  }

  #needsCustomGrid(): boolean {
    return this.#mode !== 'standard' || this.#tagId !== null;
  }

  #restoreOriginalView(): void {
    removeExtensionGrid();
    setOriginalGridHidden(false);
  }

  #watchSearchChanges(): void {
    this.#lastSearchQuery = this.#getSearchQuery();

    this.#searchWatcherTimer = window.setInterval(() => {
      if (this.#disposed || !this.#needsCustomGrid() || !isExtensionContextValid()) {
        return;
      }

      const searchQuery = this.#getSearchQuery();

      if (searchQuery === this.#lastSearchQuery) {
        return;
      }

      this.#lastSearchQuery = searchQuery;
      void this.applyView();
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
