import {
  MESSAGE_SOURCE,
  isPhotosPath,
  monthKeyOf,
  type AllowedAsset,
  type ContentMessage,
  type PageFilterState,
  type PageMessage,
} from '../shared/age-filter';
import { createAgeFilterControl, type AgeFilterControl } from './age-filter-control';
import { fetchAllVisiblePeople, searchPersonAssetDates } from './api';
import { buildAgeDateRange, isSameAgeFilter, resolveBirthDates } from './birth-date';
import { PersonApiClient } from './person-api-client';
import { isExtensionContextValid, loadPhotosAgeFilter, savePhotosAgeFilter } from './storage';
import type { AgeFilter } from './types';

/** Parallel person searches; enough for ~100 people without hammering the server. */
const SEARCH_CONCURRENCY = 4;
/** How long to wait for the page script to answer before reporting that it did not start. */
const PAGE_SCRIPT_REPLY_MS = 3_000;

export const PHOTOS_AGE_FILTER_TEXT = {
  loadingPeople: 'Фільтрую: завантажую людей…',
  searching: (done: number, total: number) => `Фільтрую: ${done} з ${total} людей…`,
  summary: (photos: number, withDate: number, total: number) =>
    `Фото: ${photos} · людей з датою народження: ${withDate} з ${total}`,
  approximate: (count: number) => `у ${count} відомий лише рік або місяць (±1 рік)`,
  personApiFailed: 'person-api недоступний',
  failed: 'Не вдалося відфільтрувати — показано всі фото',
  timeout: 'Фільтр не встиг застосуватися — показано всі фото',
  unsupported: 'Immich повернув таймлайн у незнайомому форматі — показано всі фото',
  noPageScript: 'Фільтр не запустився: онови сторінку (після оновлення розширення це потрібно)',
};

type CollectedAssets = {
  assets: AllowedAsset[];
  peopleTotal: number;
  peopleWithDate: number;
  peopleApproximate: number;
  personApiFailed: boolean;
};

async function runWithConcurrency<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;

  const run = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

/**
 * Every timeline photo where at least one visible person with a known birth date had an age inside
 * the filter. People without a birth date (in Immich or person-api) are skipped.
 */
async function collectMatchingAssets(
  filter: AgeFilter,
  onProgress: (done: number, total: number) => void,
): Promise<CollectedAssets> {
  const [people, client] = await Promise.all([fetchAllVisiblePeople(), PersonApiClient.create()]);
  const { byPersonId, personApiFailed } = await resolveBirthDates(people, client);
  const entries = [...byPersonId];
  const assets = new Map<string, AllowedAsset>();
  let done = 0;

  onProgress(0, entries.length);

  await runWithConcurrency(entries, SEARCH_CONCURRENCY, async ([personId, birthDate]) => {
    for (const asset of await searchPersonAssetDates(personId, buildAgeDateRange(birthDate, filter))) {
      const takenMonth = monthKeyOf(asset.localDateTime);
      const createdMonth = monthKeyOf(asset.createdAt);

      if (!assets.has(asset.id) && takenMonth && createdMonth) {
        assets.set(asset.id, [asset.id, takenMonth, createdMonth]);
      }
    }

    done += 1;
    onProgress(done, entries.length);
  });

  return {
    assets: [...assets.values()],
    peopleTotal: people.length,
    peopleWithDate: entries.length,
    peopleApproximate: entries.filter(([, birthDate]) => birthDate.precision !== 'day').length,
    personApiFailed,
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function postToPage(message: DistributiveOmit<ContentMessage, 'source' | 'from'>): void {
  window.postMessage({ source: MESSAGE_SOURCE, from: 'content', ...message }, window.location.origin);
}

function isPageMessage(value: unknown): value is PageMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PageMessage).source === MESSAGE_SOURCE &&
    (value as PageMessage).from === 'page' &&
    (value as PageMessage).type === 'state'
  );
}

/** First section of Immich's virtual timeline: holds the memories carousel (and the empty placeholder). */
function findTimelineTopSection(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#asset-grid > #virtual-timeline > section');
}

/**
 * Age bar above the memories on `/photos`. Applying stores the filter for this tab and reloads;
 * after the reload the page script holds Immich's timeline requests until this controller sends the
 * matching asset ids, then Immich renders only those in its own timeline.
 */
class PhotosAgeFilterController {
  readonly #filter: AgeFilter | null;
  readonly #control: AgeFilterControl;
  #disposed = false;
  #pageState: PageFilterState | null = null;
  #summary = '';
  #replyTimer: number | null = null;

  constructor() {
    this.#filter = loadPhotosAgeFilter();
    this.#control = createAgeFilterControl({ onApply: (filter) => this.#apply(filter) });
    this.#control.root.classList.add('immich-ext-age-bar');
    this.#control.root.dataset.immichPeoplePlus = 'photos-age-filter';
    this.#control.setValue(this.#filter);
    window.addEventListener('message', this.#onMessage);
  }

  start(): void {
    if (!this.#filter) {
      return;
    }

    const filter = this.#filter;
    this.#control.setBusy(true);
    this.#control.setStatus(PHOTOS_AGE_FILTER_TEXT.loadingPeople);
    postToPage({ type: 'started' });

    this.#replyTimer = window.setTimeout(() => {
      this.#replyTimer = null;

      if (!this.#disposed && this.#pageState === null) {
        this.#control.setBusy(false);
        this.#control.setStatus(PHOTOS_AGE_FILTER_TEXT.noPageScript, 'error');
      }
    }, PAGE_SCRIPT_REPLY_MS);

    void this.#compute(filter);
  }

  /** Mounts the bar once Immich has rendered the timeline (and again if Immich re-rendered it). */
  sync(): void {
    if (this.#disposed || this.#control.root.isConnected) {
      return;
    }

    findTimelineTopSection()?.prepend(this.#control.root);
  }

  dispose(): void {
    this.#disposed = true;
    window.removeEventListener('message', this.#onMessage);

    if (this.#replyTimer !== null) {
      window.clearTimeout(this.#replyTimer);
      this.#replyTimer = null;
    }

    this.#control.root.remove();
  }

  async #compute(filter: AgeFilter): Promise<void> {
    try {
      const result = await collectMatchingAssets(filter, (done, total) => {
        if (!this.#disposed && this.#pageState !== 'unsupported' && this.#pageState !== 'timeout') {
          this.#control.setStatus(PHOTOS_AGE_FILTER_TEXT.searching(done, total));
        }
      });

      if (this.#disposed) {
        return;
      }

      postToPage({ type: 'result', assets: result.assets });

      const parts = [PHOTOS_AGE_FILTER_TEXT.summary(result.assets.length, result.peopleWithDate, result.peopleTotal)];

      if (result.peopleApproximate > 0) {
        parts.push(PHOTOS_AGE_FILTER_TEXT.approximate(result.peopleApproximate));
      }

      if (result.personApiFailed) {
        parts.push(PHOTOS_AGE_FILTER_TEXT.personApiFailed);
      }

      this.#summary = parts.join(' · ');
      this.#renderStatus();
    } catch (error) {
      console.error('[Immich People Plus] Age filter failed:', error);
      postToPage({ type: 'failed' });

      if (!this.#disposed) {
        this.#control.setStatus(PHOTOS_AGE_FILTER_TEXT.failed, 'error');
      }
    } finally {
      if (!this.#disposed) {
        this.#control.setBusy(false);
      }
    }
  }

  #renderStatus(): void {
    switch (this.#pageState) {
      case 'timeout':
        this.#control.setStatus(PHOTOS_AGE_FILTER_TEXT.timeout, 'error');
        return;
      case 'unsupported':
        this.#control.setStatus(PHOTOS_AGE_FILTER_TEXT.unsupported, 'error');
        return;
      case 'failed':
        this.#control.setStatus(PHOTOS_AGE_FILTER_TEXT.failed, 'error');
        return;
      default:
        if (this.#summary) {
          this.#control.setStatus(this.#summary);
        }
    }
  }

  #onMessage = (event: MessageEvent): void => {
    if (event.source !== window || !isPageMessage(event.data)) {
      return;
    }

    this.#pageState = event.data.state;

    if (this.#replyTimer !== null) {
      window.clearTimeout(this.#replyTimer);
      this.#replyTimer = null;
    }

    if (event.data.state === 'timeout' || event.data.state === 'unsupported') {
      this.#control.setBusy(false);
    }

    this.#renderStatus();
  };

  #apply(filter: AgeFilter | null): void {
    // Re-applying the same window is a no-op, unless the last attempt fell back to the full timeline.
    const unchanged = isSameAgeFilter(filter, this.#filter) && (filter === null || this.#pageState === 'applied');

    if (!isExtensionContextValid() || unchanged) {
      this.#control.setValue(this.#filter);
      this.#renderStatus();
      return;
    }

    savePhotosAgeFilter(filter);
    // Immich keeps loaded months in memory; a reload is the only reliable way to refetch them.
    window.location.reload();
  }
}

let controller: PhotosAgeFilterController | null = null;

export function syncPhotosAgeFilter(): void {
  if (!isExtensionContextValid() || !isPhotosPath(window.location.pathname)) {
    if (controller) {
      controller.dispose();
      controller = null;
    }

    // Leaving /photos ends the filter; the next visit starts with the plain timeline.
    if (!isPhotosPath(window.location.pathname)) {
      savePhotosAgeFilter(null);
    }

    return;
  }

  if (!controller) {
    controller = new PhotosAgeFilterController();
    controller.start();
  }

  controller.sync();
}
