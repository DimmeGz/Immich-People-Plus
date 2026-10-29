import { findPeopleLinks, getViewerAssetId } from './detail-panel-age';
import { isExtensionContextValid, loadImmeyesUrl } from './storage';

/**
 * Photographer block in Immich's info panel (DetailPanel.svelte), from Immeyes
 * (`GET <Immeyes URL>/api/photographers/asset/<assetId>`): the photographer, the camera body, the
 * camera fingerprint (a body without a serial, told apart by its maker note) and the author signature
 * of the open photo, each only when Immeyes knows it. Without "Immeyes URL" in the
 * options nothing is added and nothing is requested.
 */

const BLOCK_MARK = 'photographer';
const BLOCK_SELECTOR = `[data-immich-people-plus="${BLOCK_MARK}"]`;
const BLOCK_CLASS = 'immich-ext-photographer';
const BLOCK_AFTER_PEOPLE_CLASS = `${BLOCK_CLASS} ${BLOCK_CLASS}--after-people`;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_LINKS = 3;

type SourceKind = 'tag' | 'signature' | 'body' | 'fingerprint' | 'folder';

type PhotographerLink = { url: string; label: string | null };

type Attribution = {
  /** `private`: a person's own camera rather than a photographer (absent in older Immeyes: false). */
  photographer: { id: string; name: string; private: boolean; links: PhotographerLink[] } | null;
  source: string | null;
  make: string | null;
  model: string | null;
  serial: string | null;
  bodyKey: string | null;
  /** "make|model|hash" (see `fingerprintParts`); null for photos of cameras with a serial. */
  fingerprint: string | null;
  signature: string | null;
  signatureRaw: string | null;
  library: { body: number; fingerprint: number; signature: number };
  exifStatus: string | null;
};

/**
 * What Immeyes answered. `notSynced` is its 404 ("Asset not synced"); `unavailable` is everything
 * else that is not a usable answer (503 without a state database, other statuses, network errors,
 * timeouts, an unexpected body).
 */
type Outcome = { kind: 'data'; data: Attribution } | { kind: 'notSynced' } | { kind: 'unavailable' };

const SOURCE_MARKS: Readonly<Record<SourceKind, { text: string; title: string }>> = {
  tag: { text: 'тег', title: 'Фотографа визначено за тегом Immich' },
  signature: { text: 'підпис', title: 'Фотографа визначено за підписом автора в EXIF' },
  body: { text: 'корпус', title: 'Фотографа визначено за корпусом камери' },
  fingerprint: { text: 'відбиток', title: 'Фотографа визначено за відбитком камери без серійника' },
  folder: { text: 'тека', title: 'Фотографа визначено за текою, у якій лежить фото' },
};

const STATUS_TEXT: Readonly<Record<string, string>> = {
  pending: 'EXIF ще не прочитано',
  skipped: 'телефон або без камери, Immeyes не читає',
  error: 'файл не вдалось прочитати',
  done: 'фотограф невідомий',
};
const UNKNOWN_PHOTOGRAPHER_TEXT = STATUS_TEXT.done;
const NOT_SYNCED_TEXT = 'Immeyes ще не бачив це фото';
const UNAVAILABLE_TEXT = 'Immeyes недоступний';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseLinks(value: unknown): PhotographerLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const links: PhotographerLink[] = [];

  for (const item of value) {
    const url = asString((item as { url?: unknown } | null)?.url);

    if (url) {
      links.push({ url, label: asString((item as { label?: unknown }).label)?.trim() ?? null });
    }
  }

  return links;
}

function parseAttribution(value: unknown): Attribution | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const photographer = raw.photographer as Record<string, unknown> | null | undefined;
  const library = (raw.library ?? {}) as Record<string, unknown>;
  const photographerId = asString(photographer?.id);
  const photographerName = asString(photographer?.name);

  return {
    photographer:
      photographerId && photographerName
        ? {
            id: photographerId,
            name: photographerName,
            private: photographer?.private === true,
            links: parseLinks(photographer?.links),
          }
        : null,
    source: asString(raw.source),
    make: asString(raw.make),
    model: asString(raw.model),
    serial: asString(raw.serial),
    bodyKey: asString(raw.bodyKey),
    fingerprint: asString(raw.fingerprint),
    signature: asString(raw.signature),
    signatureRaw: asString(raw.signatureRaw),
    library: {
      body: asCount(library.body),
      fingerprint: asCount(library.fingerprint),
      signature: asCount(library.signature),
    },
    exifStatus: asString(raw.exifStatus),
  };
}

async function requestOutcome(immeyesUrl: string, assetId: string): Promise<Outcome> {
  try {
    const response = await fetch(`${immeyesUrl}/api/photographers/asset/${encodeURIComponent(assetId)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404) {
      return { kind: 'notSynced' };
    }

    if (!response.ok) {
      return { kind: 'unavailable' };
    }

    const data = parseAttribution(await response.json());
    return data ? { kind: 'data', data } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * Answers per photo for the life of the page. Only what Immeyes actually said (an attribution or its
 * 404) is kept; "unavailable" is not, so a service that was down is asked again when the photo is
 * opened the next time.
 */
const cache = new Map<string, Outcome>();

async function loadOutcome(immeyesUrl: string, assetId: string): Promise<Outcome> {
  const key = `${immeyesUrl}\n${assetId}`;
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const outcome = await requestOutcome(immeyesUrl, assetId);

  if (outcome.kind !== 'unavailable') {
    cache.set(key, outcome);
  }

  return outcome;
}

/**
 * Camera name for the "Корпус" row: EXIF `Model` often repeats the make ("Canon" + "Canon EOS R",
 * "NIKON CORPORATION" + "NIKON D850"), in which case the model alone is the name.
 */
export function cameraName(make: string | null, model: string | null): string {
  const trimmedMake = make?.trim() ?? '';
  const trimmedModel = model?.trim() ?? '';
  const makeWord = trimmedMake.split(/\s+/)[0] ?? '';

  if (!trimmedModel || !trimmedMake) {
    return trimmedModel || trimmedMake;
  }

  const modelHasMake = trimmedModel.toLowerCase().startsWith(makeWord.toLowerCase());

  return modelHasMake ? trimmedModel : `${trimmedMake} ${trimmedModel}`;
}

/** "Canon EOS R · 0123456789AB": camera name and serial of a body (the serial is left out when unknown). */
export function describeBody(body: {
  make: string | null;
  model: string | null;
  serial: string | null;
  bodyKey: string;
}): string {
  // `bodyKey` is "make|model|serial"; its first two parts are the fallback when EXIF fields are empty.
  const camera =
    cameraName(body.make, body.model) || body.bodyKey.split('|').slice(0, 2).filter(Boolean).join(' ');

  return [camera || 'камера невідома', body.serial].filter(Boolean).join(' · ');
}

/**
 * A camera fingerprint is "make|model|hash": the hash is the last `|` segment, the model everything
 * between it and the make (a model may itself contain `|`). `make` and `model` given by Immeyes next
 * to the key win; the key fills in what they lack.
 */
export function fingerprintParts(
  fingerprint: string,
  make: string | null = null,
  model: string | null = null,
  hash: string | null = null,
): { camera: string; hash: string } {
  const segments = fingerprint.split('|');
  const keyHash = segments.length > 1 ? (segments.at(-1) ?? '') : fingerprint;
  const keyMake = segments.length > 1 ? segments[0] : '';
  const keyModel = segments.slice(1, -1).join('|');

  return {
    camera: cameraName(make ?? (keyMake || null), model ?? (keyModel || null)) || 'камера невідома',
    hash: hash ?? keyHash,
  };
}

/** Only http(s) goes into an `href`: the links come from Immeyes' database, not from this extension. */
function linkText(link: PhotographerLink): { href: string; text: string } | null {
  let url: URL;

  try {
    url = new URL(link.url);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  return { href: url.href, text: link.label || url.hostname.replace(/^www\./i, '') };
}

function createAnchor(href: string, text: string, title?: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.textContent = text;

  if (title) {
    anchor.title = title;
  }

  return anchor;
}

function createRow(label: string | null, muted = false): HTMLParagraphElement {
  const row = document.createElement('p');
  row.className = muted ? `${BLOCK_CLASS}__row ${BLOCK_CLASS}__row--muted` : `${BLOCK_CLASS}__row`;

  if (label) {
    row.append(`${label}: `);
  }

  return row;
}

function photographerRow(immeyesUrl: string, data: Attribution): HTMLElement | null {
  const { photographer } = data;

  if (!photographer) {
    return null;
  }

  // A private camera is a person's own camera, not a photographer: the label says so.
  const row = createRow(photographer.private ? 'Камера' : 'Фотограф');
  row.appendChild(
    createAnchor(
      `${immeyesUrl}/photographers/${encodeURIComponent(photographer.id)}`,
      photographer.name,
      photographer.private ? 'Приватна камера в Immeyes' : 'Фотограф в Immeyes',
    ),
  );

  const mark = data.source ? SOURCE_MARKS[data.source as SourceKind] : undefined;

  if (mark) {
    const small = document.createElement('small');
    small.className = `${BLOCK_CLASS}__source`;
    small.textContent = mark.text;
    small.title = mark.title;
    row.append(' ', small);
  }

  const links = photographer.links.flatMap((link) => linkText(link) ?? []).slice(0, MAX_LINKS);

  if (links.length > 0) {
    const list = document.createElement('span');
    list.className = `${BLOCK_CLASS}__links`;

    links.forEach(({ href, text }, index) => {
      // The no-break space keeps the dot with the link before it when the line wraps.
      list.append(index > 0 ? '\u00a0· ' : '', createAnchor(href, text));
    });

    row.append(' ', list);
  }

  return row;
}

function bodyRow(immeyesUrl: string, data: Attribution): HTMLElement | null {
  if (!data.bodyKey) {
    return null;
  }

  const row = createRow('Корпус');
  row.appendChild(
    createAnchor(
      `${immeyesUrl}/photographers?tab=bodies&open=${encodeURIComponent(data.bodyKey)}`,
      `${describeBody({ ...data, bodyKey: data.bodyKey })} (${data.library.body} фото)`,
      'Усі фото з цього корпусу в Immeyes',
    ),
  );
  return row;
}

function fingerprintRow(immeyesUrl: string, data: Attribution): HTMLElement | null {
  if (!data.fingerprint) {
    return null;
  }

  const { camera, hash } = fingerprintParts(data.fingerprint, data.make, data.model);
  const row = createRow('Відбиток');
  row.appendChild(
    createAnchor(
      `${immeyesUrl}/photographers?tab=fingerprints&open=${encodeURIComponent(data.fingerprint)}`,
      `${camera} · ${hash} (${data.library.fingerprint} фото)`,
      'Усі фото з цим відбитком камери в Immeyes',
    ),
  );
  return row;
}

function signatureRow(immeyesUrl: string, data: Attribution): HTMLElement | null {
  if (!data.signature) {
    return null;
  }

  const row = createRow('Підпис');
  row.appendChild(
    createAnchor(
      `${immeyesUrl}/photographers?tab=signatures&open=${encodeURIComponent(data.signature)}`,
      `${data.signatureRaw ?? data.signature} (${data.library.signature} фото)`,
      'Усі фото з цим підписом в Immeyes',
    ),
  );
  return row;
}

function statusLine(text: string): HTMLElement {
  const row = createRow(null, true);
  row.textContent = text;
  return row;
}

function createBlock(immeyesUrl: string, assetId: string, outcome: Outcome): HTMLElement {
  const block = document.createElement('div');
  block.className = BLOCK_CLASS;
  block.dataset.immichPeoplePlus = BLOCK_MARK;
  block.dataset.assetId = assetId;

  if (outcome.kind === 'unavailable') {
    block.appendChild(statusLine(UNAVAILABLE_TEXT));
    return block;
  }

  if (outcome.kind === 'notSynced') {
    block.appendChild(statusLine(NOT_SYNCED_TEXT));
    return block;
  }

  const rows = [
    photographerRow(immeyesUrl, outcome.data),
    bodyRow(immeyesUrl, outcome.data),
    fingerprintRow(immeyesUrl, outcome.data),
    signatureRow(immeyesUrl, outcome.data),
  ].flatMap((row) => row ?? []);

  if (rows.length === 0) {
    rows.push(statusLine(STATUS_TEXT[outcome.data.exifStatus ?? ''] ?? UNKNOWN_PHOTOGRAPHER_TEXT));
  }

  block.append(...rows);
  return block;
}

/** `/search?query={"make":…,"model":…}` or `{"lensModel":…}`: Immich's links on the camera and lens rows. */
function isHardwareSearchLink(link: HTMLAnchorElement): boolean {
  let url: URL;

  try {
    url = new URL(link.href, window.location.origin);
  } catch {
    return false;
  }

  if (url.pathname.replace(/\/+$/, '') !== '/search') {
    return false;
  }

  try {
    const query = JSON.parse(url.searchParams.get('query') ?? '') as Record<string, unknown> | null;
    return Boolean(query && ('make' in query || 'model' in query || 'lensModel' in query));
  } catch {
    return false;
  }
}

type Placement = { anchor: HTMLElement; afterPeople: boolean };

/**
 * Where the block goes. Wanted: right under the camera / lens rows of the "Details" part of the
 * panel. Immich 3.0.x renders those rows as anonymous `div.flex.gap-4.py-4` (no id, no data
 * attribute, shown only when the photo has that EXIF), so they are found through the one thing in
 * them that is stable: the search links Immich puts on the camera (`make`/`model`) and lens
 * (`lensModel`) text. The last such row (the lens, else the camera) is the anchor.
 *
 * A photo without camera or lens text has no such row; then the block goes right after the "People"
 * block (found through its `/people/<id>` links, like in detail-panel-age.ts), which sits just above
 * "Details". Neither anchor (no camera EXIF and nobody recognised, or the viewer of a shared link,
 * which has no People block) means the block is not shown; guessing a position inside Immich's
 * layout would break whenever its markup changes.
 */
function findPlacement(): Placement | null {
  const panel = document.getElementById('detail-panel');

  if (!panel) {
    return null;
  }

  let hardware: HTMLElement | null = null;

  for (const link of panel.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (isHardwareSearchLink(link)) {
      hardware = link.closest<HTMLElement>('div.py-4') ?? hardware;
    }
  }

  if (hardware) {
    return { anchor: hardware, afterPeople: false };
  }

  const people = findPeopleLinks()[0]?.link.closest<HTMLElement>('section');

  return people && panel.contains(people) ? { anchor: people, afterPeople: true } : null;
}

function removeBlocks(except?: HTMLElement): void {
  for (const node of document.querySelectorAll(BLOCK_SELECTOR)) {
    if (node !== except) {
      node.remove();
    }
  }
}

/** Idempotent: moves or inserts the one block only when it is not already in the right place. */
function placeBlock(block: HTMLElement): void {
  // Duplicates (an earlier mount into the panel that Immich re-rendered, another photo's block).
  removeBlocks(block);

  const placement = findPlacement();

  if (!placement) {
    block.remove();
    return;
  }

  const className = placement.afterPeople ? BLOCK_AFTER_PEOPLE_CLASS : BLOCK_CLASS;

  if (block.className !== className) {
    block.className = className;
  }

  if (placement.anchor.nextElementSibling !== block) {
    placement.anchor.after(block);
  }
}

/** The photo the block was built for; dropped as soon as another photo opens. */
let shown: { assetId: string; block: HTMLElement | null } | null = null;
let loadingAssetId: string | null = null;

export function syncDetailPanelPhotographer(): void {
  const assetId = isExtensionContextValid() ? getViewerAssetId(window.location.pathname) : null;

  if (!assetId) {
    shown = null;
    loadingAssetId = null;
    removeBlocks();
    return;
  }

  if (shown?.assetId === assetId) {
    if (shown.block) {
      placeBlock(shown.block);
    }

    return;
  }

  // Another photo: the previous photographer must not stay under the new photo while it loads.
  shown = null;
  removeBlocks();

  // Info panel closed, or already on its way.
  if (loadingAssetId === assetId || !document.getElementById('detail-panel')) {
    return;
  }

  loadingAssetId = assetId;

  void (async () => {
    const immeyesUrl = await loadImmeyesUrl();
    const outcome = immeyesUrl ? await loadOutcome(immeyesUrl, assetId) : null;

    return immeyesUrl && outcome ? createBlock(immeyesUrl, assetId, outcome) : null;
  })()
    .catch((error: unknown) => {
      console.warn('[Immich People Plus] Photographer in the info panel failed:', error);
      return null;
    })
    .then((block) => {
      if (loadingAssetId === assetId) {
        loadingAssetId = null;
      }

      // The viewer moved on while the answer was on its way: this answer is not for the open photo.
      if (getViewerAssetId(window.location.pathname) !== assetId) {
        return;
      }

      shown = { assetId, block };

      if (block) {
        placeBlock(block);
      }
    });
}
