/**
 * Page-world script (manifest: "world": "MAIN", "run_at": "document_start") for the `/photos` age
 * filter. It is inert everywhere except on `/photos` with an active filter in sessionStorage; there
 * it wraps `window.fetch` before Immich's own scripts run (SvelteKit and the Immich SDK keep the
 * reference they see at startup) and filters the two timeline endpoints. See src/shared/age-filter.ts.
 */
import {
  MESSAGE_SOURCE,
  PHOTOS_AGE_FILTER_KEY,
  UnknownTimelineFormatError,
  buildAllowedIndex,
  filterTimeBucketAssets,
  filterTimeBuckets,
  isPhotosPath,
  type AllowedAsset,
  type AllowedIndex,
  type ContentMessage,
  type PageFilterState,
  type PageMessage,
} from '../shared/age-filter';

/** The content script runs at document_idle; this is how long the timeline waits for it to show up. */
const CONTENT_START_TIMEOUT_MS = 20_000;
/** Searching ~100 people takes seconds; this is only a safety net so the timeline never hangs. */
const RESULT_TIMEOUT_MS = 5 * 60_000;

type TimelineRequest = { kind: 'buckets'; orderBy: string | null } | { kind: 'bucket' };

function isFilterRequested(): boolean {
  try {
    return isPhotosPath(window.location.pathname) && sessionStorage.getItem(PHOTOS_AGE_FILTER_KEY) !== null;
  } catch {
    return false;
  }
}

function isContentMessage(value: unknown): value is ContentMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ContentMessage).source === MESSAGE_SOURCE &&
    (value as ContentMessage).from === 'content'
  );
}

function isAllowedAssetList(value: unknown): value is AllowedAsset[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) && item.length === 3 && item.every((part: unknown) => typeof part === 'string'),
    )
  );
}

function installTimelineFilter(): void {
  const nativeFetch = window.fetch;
  let active = true;
  let state: PageFilterState = 'waiting';
  let resolveIndex: (index: AllowedIndex | null) => void = () => undefined;
  const indexReady = new Promise<AllowedIndex | null>((resolve) => {
    resolveIndex = resolve;
  });

  const post = (detail?: string) => {
    const message: PageMessage = { source: MESSAGE_SOURCE, from: 'page', type: 'state', state, detail };
    window.postMessage(message, window.location.origin);
  };

  const setState = (next: PageFilterState, detail?: string) => {
    state = next;
    post(detail);
  };

  /** Show Immich's unfiltered timeline from now on (already loaded months stay as they are). */
  const passThrough = (next: PageFilterState, detail?: string) => {
    active = false;
    resolveIndex(null);
    window.clearTimeout(timer);
    setState(next, detail);
  };

  let timer = window.setTimeout(() => passThrough('timeout'), CONTENT_START_TIMEOUT_MS);

  window.addEventListener('message', (event) => {
    if (event.source !== window || !isContentMessage(event.data)) {
      return;
    }

    const message = event.data;

    if (message.type === 'started') {
      if (state === 'waiting') {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => passThrough('timeout'), RESULT_TIMEOUT_MS);
      }

      post();
      return;
    }

    if (state !== 'waiting') {
      return;
    }

    if (message.type === 'failed') {
      passThrough('failed');
      return;
    }

    if (message.type === 'result' && isAllowedAssetList(message.assets)) {
      window.clearTimeout(timer);
      resolveIndex(buildAllowedIndex(message.assets));
      setState('applied');
    }
  });

  const switchOffOutsidePhotos = () => {
    if (!active || isPhotosPath(window.location.pathname)) {
      return;
    }

    try {
      sessionStorage.removeItem(PHOTOS_AGE_FILTER_KEY);
    } catch {
      // ignore
    }

    passThrough('off');
  };

  // Same-document navigations (SvelteKit uses history.pushState); Chrome has the Navigation API.
  (window as unknown as { navigation?: EventTarget }).navigation?.addEventListener(
    'currententrychange',
    switchOffOutsidePhotos,
  );
  window.addEventListener('popstate', switchOffOutsidePhotos);

  const classify = (input: RequestInfo | URL, init?: RequestInit): TimelineRequest | null => {
    if (!active || !isPhotosPath(window.location.pathname)) {
      return null;
    }

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (method !== 'GET') {
      return null;
    }

    let url: URL;

    try {
      url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    } catch {
      return null;
    }

    if (url.origin !== window.location.origin) {
      return null;
    }

    if (url.pathname === '/api/timeline/buckets') {
      return { kind: 'buckets', orderBy: url.searchParams.get('orderBy') };
    }

    if (url.pathname === '/api/timeline/bucket') {
      return { kind: 'bucket' };
    }

    return null;
  };

  const toJsonResponse = (body: unknown, original: Response): Response => {
    const headers = new Headers(original.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json; charset=utf-8');

    return new Response(JSON.stringify(body), {
      status: original.status,
      statusText: original.statusText,
      headers,
    });
  };

  const filtered = async (request: TimelineRequest, input: RequestInfo | URL, init?: RequestInit) => {
    const responsePromise = nativeFetch.call(window, input, init);
    // Rejections (e.g. Immich aborting a month load) surface below; avoid an "unhandled" warning meanwhile.
    responsePromise.catch(() => undefined);

    const index = await indexReady;
    const response = await responsePromise;

    if (!index || !active || !response.ok) {
      return response;
    }

    let data: unknown;

    try {
      data = await response.clone().json();
    } catch {
      return response;
    }

    try {
      const body =
        request.kind === 'buckets' ? filterTimeBuckets(data, index, request.orderBy) : filterTimeBucketAssets(data, index);
      return toJsonResponse(body, response);
    } catch (error) {
      if (error instanceof UnknownTimelineFormatError) {
        console.error('[Immich People Plus] Age filter switched off:', error.message);
        passThrough('unsupported', error.message);
        return response;
      }

      throw error;
    }
  };

  window.fetch = function fetchWithAgeFilter(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = classify(input, init);
    return request ? filtered(request, input, init) : nativeFetch.call(window, input, init);
  };
}

if (isFilterRequested()) {
  installTimelineFilter();
}
