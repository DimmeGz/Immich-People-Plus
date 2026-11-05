/**
 * "В інших джерелах" on the person page: where else this person was recognised, from Immeyes'
 * external-source probe (a face from Flickr, a Telegram channel or a website matched against the library's
 * people, with a cosine distance).
 *
 * - The button is mounted next to the Immeyes links once `GET <Immeyes URL>/api/flickr/persons/<id>/count`
 *   answers; an Immeyes without the Flickr feature (404, network error) gets no button at all.
 * - The popup, opened by that button, lists confirmed and new matches
 *   (`.../matches?max=0.5&show=yes|new`) and saves the user's «так» / «ні» verdict at once. It has two
 *   display modes, «порівняння» (cards with both pictures) and «плитка» (Flickr tiles), over the same lists.
 * - Next to the faces there are the copies: external photos that are near-duplicates of library photos with this
 *   person on them (`.../copies?show=yes|new`). They are a second list in the same popup, switched by «Обличчя» /
 *   «Копії» (the switch only exists when there is a copy), with the same cards, tiles, filters and verdicts.
 *   An Immeyes without the copies feature answers no count for them and the popup is what it was.
 */

const MODAL_SELECTOR = '[data-immich-people-plus="sources-modal"]';
const TITLE_ID = 'immich-ext-sources-title';
/** The usual cut for "same person"; fixed, the popup has no control for it. */
const MAX_DISTANCE = 0.5;
const MODE_STORAGE_KEY = 'immich-people-plus.sources-mode';
const FILTER_STORAGE_KEY = 'immich-people-plus.sources-filter';
const COUNT_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 60_000;
const VERDICT_TIMEOUT_MS = 15_000;

type Verdict = 'yes' | 'no' | null;
/** Fractions 0..1 of the picture. */
type Box = { x1: number; y1: number; x2: number; y2: number };

type Tally = { confirmed: number; new: number; rejected: number };
/** `photos`: distinct photos (of any source), `matches`: faces, `copies`: copies of the person's library photos (zeros from an older Immeyes). */
type Count = { photos: Tally; matches: Tally; copies: Tally };

/** The two lists of the popup: the person's faces found elsewhere, and copies of the person's library photos. */
type Kind = 'faces' | 'copies';

/** Where a photo comes from: Flickr, a Telegram channel, a website. Rows without the field are Flickr's (older Immeyes). */
type Source = 'flickr' | 'telegram' | 'site';

const SOURCE_LABELS: Record<Source, string> = { flickr: 'Flickr', telegram: 'Telegram', site: 'Сайт' };

/** Hover text of the owner link, per source. */
const OWNER_TITLES: Record<Source, string> = {
  flickr: 'Фотопотік автора на Flickr',
  telegram: 'Канал автора в Telegram',
  site: 'Сайт автора',
};

/** What a website's `ownerName` has to look like (its host) to be linked as `https://<host>/`. */
const HOST_NAME = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

type Match = {
  id: number;
  distance: number;
  verdict: Verdict;
  photo: {
    source: Source;
    /** `ownerName ?? pathAlias ?? owner` */
    ownerLabel: string;
    /** The owner's photostream / channel; null when there is none to open (a private Telegram channel). */
    ownerUrl: string | null;
    takenAt: Date | null;
    pageUrl: string;
    /** The picture itself, for a website photo (Immeyes keeps the address it downloaded it from); null for Flickr and Telegram, and from an older Immeyes. */
    imageUrl: string | null;
    /** Absolute: a path on Immeyes (a Telegram thumbnail) is already joined to the Immeyes URL. */
    thumbUrl: string;
    /** The Immeyes source (a Flickr user, a channel, a site) the photo was found by; null: deleted, or an older Immeyes. */
    sourceId: number | null;
    sourceName: string | null;
  };
  /** Where the face is on the external picture; null for a copy (the whole picture is the match). */
  face: Box | null;
  asset: { id: string; box: Box | null };
};

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Only `http(s)` addresses: the values come from JSON and end up in `href` / `src`. */
function asHttpUrl(value: unknown): string | null {
  const text = asString(value);

  if (!text) {
    return null;
  }

  try {
    const { protocol } = new URL(text);
    return protocol === 'https:' || protocol === 'http:' ? text : null;
  } catch {
    return null;
  }
}

/**
 * A picture address: absolute `http(s)`, or a path on Immeyes itself (`/api/flickr/thumb/<id>`, the thumbnail
 * of a Telegram or website photo), which becomes `<Immeyes URL><path>`. `//host/…` is not a path on Immeyes
 * and is refused.
 */
function asImageUrl(value: unknown, immeyesUrl: string): string | null {
  const text = asString(value);

  if (text && text.startsWith('/') && !text.startsWith('//') && !text.startsWith('/\\')) {
    return asHttpUrl(`${immeyesUrl.replace(/\/+$/, '')}${text}`);
  }

  return asHttpUrl(text);
}

/** A missing or unknown value is Flickr, the source every Immeyes has. */
function asSource(value: unknown): Source {
  return value === 'telegram' || value === 'site' ? value : 'flickr';
}

/** The id of an Immeyes source: an integer, anything else (a string, a fraction, absent) is "none". */
function asSourceId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/**
 * The owner's page: a Flickr photostream, a Telegram channel by its username (none for a private one),
 * a website by its host (the `ownerName`, when it looks like one).
 */
function ownerPageUrl(
  source: Source,
  owner: string,
  ownerName: string | null,
  pathAlias: string | null,
): string | null {
  if (source === 'telegram') {
    return pathAlias ? `https://t.me/${encodeURIComponent(pathAlias)}` : null;
  }

  if (source === 'site') {
    return ownerName && HOST_NAME.test(ownerName) ? `https://${ownerName}/` : null;
  }

  return `https://www.flickr.com/photos/${encodeURIComponent(owner).replace(/%40/g, '@')}/`;
}

function asDate(value: unknown): Date | null {
  const text = asString(value);
  const date = text ? new Date(text) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function asBox(value: unknown): Box | null {
  const raw = asRecord(value);
  const coordinates = [raw?.x1, raw?.y1, raw?.x2, raw?.y2];

  if (!coordinates.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return null;
  }

  const [x1, y1, x2, y2] = (coordinates as number[]).map((item) => Math.min(1, Math.max(0, item)));
  return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null;
}

function asTally(value: unknown): Tally {
  const raw = asRecord(value);
  return { confirmed: asCount(raw?.confirmed), new: asCount(raw?.new), rejected: asCount(raw?.rejected) };
}

function parseCount(value: unknown): Count | null {
  const raw = asRecord(value);

  // Something that answered 200 but is not this feature's count.
  if (!raw || !asRecord(raw.photos)) {
    return null;
  }

  return { photos: asTally(raw.photos), matches: asTally(raw.matches), copies: asTally(raw.copies) };
}

/**
 * A row of `/matches` (`kind` faces: `face`, `asset: { id, box }`) or of `/copies` (`assetId`, no boxes: the whole
 * picture is the match).
 */
function parseMatch(value: unknown, verdict: Verdict, immeyesUrl: string, kind: Kind = 'faces'): Match | null {
  const raw = asRecord(value);
  const photo = asRecord(raw?.photo);
  const asset = kind === 'faces' ? asRecord(raw?.asset) : null;

  const id = raw?.id;
  const distance = raw?.distance;
  const source = asSource(photo?.source);
  const owner = asString(photo?.owner);
  const ownerName = asString(photo?.ownerName);
  const pathAlias = asString(photo?.pathAlias);
  const pageUrl = asHttpUrl(photo?.pageUrl);
  const imageUrl = asHttpUrl(photo?.imageUrl);
  const thumbUrl = asImageUrl(photo?.thumbUrl, immeyesUrl);
  const face = kind === 'faces' ? asBox(raw?.face) : null;
  const assetId = kind === 'faces' ? asString(asset?.id) : asString(raw?.assetId);

  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    typeof distance !== 'number' ||
    !Number.isFinite(distance) ||
    !owner ||
    !pageUrl ||
    !thumbUrl ||
    (kind === 'faces' && !face) ||
    !assetId
  ) {
    return null;
  }

  return {
    id,
    distance,
    // The list a row came from decides its section, so a row that disagrees cannot land in the wrong one.
    verdict,
    photo: {
      source,
      ownerLabel: ownerName ?? pathAlias ?? owner,
      ownerUrl: ownerPageUrl(source, owner, ownerName, pathAlias),
      takenAt: asDate(photo?.takenAt),
      pageUrl,
      imageUrl,
      thumbUrl,
      sourceId: asSourceId(photo?.sourceId),
      sourceName: asString(photo?.sourceName)?.trim() ?? null,
    },
    face,
    asset: { id: assetId, box: asBox(asset?.box) },
  };
}

/** Rows of a list; a malformed one is dropped instead of failing the popup. Not an array: no answer. */
function parseMatches(value: unknown, verdict: Verdict, immeyesUrl: string, kind: Kind): Match[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.flatMap((item) => parseMatch(item, verdict, immeyesUrl, kind) ?? []);
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

function personUrl(immeyesUrl: string, personId: string): string {
  return `${immeyesUrl}/api/flickr/persons/${encodeURIComponent(personId)}`;
}

async function requestCount(immeyesUrl: string, personId: string): Promise<Count | null> {
  const url = `${personUrl(immeyesUrl, personId)}/count?max=${MAX_DISTANCE}`;
  return parseCount(await getJson(url, COUNT_TIMEOUT_MS));
}

/** The faces list (`/matches`, cut at `MAX_DISTANCE`) or the copies list (`/copies`, cut by Immeyes at its own copy distance). */
async function requestMatches(
  immeyesUrl: string,
  personId: string,
  kind: Kind,
  show: 'yes' | 'new',
): Promise<Match[] | null> {
  const path = kind === 'faces' ? `matches?max=${MAX_DISTANCE}&show=${show}` : `copies?show=${show}`;
  const url = `${personUrl(immeyesUrl, personId)}/${path}`;
  return parseMatches(await getJson(url, LIST_TIMEOUT_MS), show === 'yes' ? 'yes' : null, immeyesUrl, kind);
}

async function postVerdict(immeyesUrl: string, matchId: number, verdict: Verdict): Promise<boolean> {
  try {
    const response = await fetch(`${immeyesUrl}/api/flickr/matches/${matchId}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict }),
      signal: AbortSignal.timeout(VERDICT_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Counts per person for the life of the page, like the «Хто знімав» answers. A failure is not kept, so
 * the next mount asks again. `stamps` numbers the requests per person: an answer older than the latest
 * request (a refresh after a verdict overtaking the first request) is ignored.
 */
const counts = new Map<string, Count>();
const inflight = new Map<string, Promise<Count | null>>();
const stamps = new Map<string, number>();
const listeners = new Map<string, Set<(count: Count) => void>>();

function countKey(immeyesUrl: string, personId: string): string {
  return `${immeyesUrl}\n${personId}`;
}

async function fetchCount(immeyesUrl: string, personId: string): Promise<Count | null> {
  const key = countKey(immeyesUrl, personId);
  const stamp = (stamps.get(key) ?? 0) + 1;
  stamps.set(key, stamp);

  const count = await requestCount(immeyesUrl, personId);

  if (count && stamps.get(key) === stamp) {
    counts.set(key, count);

    for (const listener of listeners.get(key) ?? []) {
      listener(count);
    }
  }

  return count;
}

function loadCount(immeyesUrl: string, personId: string): Promise<Count | null> {
  const key = countKey(immeyesUrl, personId);
  const cached = counts.get(key);

  if (cached) {
    return Promise.resolve(cached);
  }

  let pending = inflight.get(key);

  if (!pending) {
    pending = fetchCount(immeyesUrl, personId).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }

  return pending;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function createLink(className: string, href: string, newTab: boolean): HTMLAnchorElement {
  const link = element('a', className);
  link.href = href;

  if (newTab) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  return link;
}

/**
 * One number for both lists (faces and copies), so a person who only has copies is not shown as empty. A photo that is
 * in both lists counts in both; the title says how the number is made up.
 */
function applyCount(button: HTMLButtonElement, { photos, copies }: Count): void {
  const confirmed = photos.confirmed + copies.confirmed;
  const fresh = photos.new + copies.new;
  const rejected = photos.rejected + copies.rejected;
  const total = confirmed + fresh;
  const copyTotal = copies.confirmed + copies.new;
  button.textContent = `В інших джерелах (${total})`;
  button.classList.toggle('is-empty', total === 0);
  button.title =
    total === 0
      ? 'збігів немає'
      : `підтверджених ${confirmed}, нових ${fresh}, відхилених ${rejected}` +
        (copyTotal > 0 ? ` · з них копій фото: ${copyTotal}` : '');
}

/**
 * Requests the count and, if Immeyes has the Flickr feature, appends «В інших джерелах (N)» to `parent`.
 * Nothing is added when the request fails or `parent` is gone by then (another person, page left).
 */
export function mountOtherSourcesButton(parent: HTMLElement, immeyesUrl: string, personId: string): void {
  void loadCount(immeyesUrl, personId).then((count) => {
    if (!count || !parent.isConnected) {
      return;
    }

    const button = element('button', 'immich-ext-person-card__trigger immich-ext-immeyes-links__link');
    button.classList.add('immich-ext-sources__trigger');
    button.type = 'button';
    button.dataset.immichPeoplePlus = 'sources-trigger';
    applyCount(button, count);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openOtherSourcesPopup(immeyesUrl, personId);
    });
    parent.appendChild(button);

    // Follows the count after a verdict; forgets the button once it is gone from the page.
    const key = countKey(immeyesUrl, personId);
    const set = listeners.get(key) ?? new Set();
    const listener = (next: Count) => {
      if (button.isConnected) {
        applyCount(button, next);
      } else {
        set.delete(listener);
      }
    };

    set.add(listener);
    listeners.set(key, set);
  });
}

function formatDistance(distance: number): string {
  return distance.toFixed(3).replace('.', ',');
}

/** Flickr's "taken" time is a wall clock stored as UTC (see Immeyes), so the date is read in UTC. */
function formatDate(date: Date): string {
  return date.toLocaleDateString('uk-UA', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 10_000) / 100}%`;
}

/** A hotlinked picture: lazy, no referrer. The caller sets `src` once its listeners are in place. */
function createImage(alt: string, className: string): HTMLImageElement {
  const image = element('img', className);
  image.alt = alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  return image;
}

/**
 * A square slot with the picture at its natural aspect and the face outlined. The frame hugs the
 * picture (`inline-block`), so the percentages of the box are fractions of the picture itself.
 * The picture is the link (`href`); `extra.pageHref` adds a second link, a bar over the picture's bottom edge.
 */
function createPicture(
  href: string,
  newTab: boolean,
  src: string,
  alt: string,
  box: Box | null,
  extra: { title?: string; pageHref?: string | null } = {},
): HTMLElement {
  const slot = element('div', 'immich-ext-sources__slot');
  const frame = element('span', 'immich-ext-sources__frame');
  const link = createLink('immich-ext-sources__link', href, newTab);
  const image = createImage(alt, 'immich-ext-sources__image');

  if (extra.title) {
    link.title = extra.title;
  }

  link.appendChild(image);
  frame.appendChild(link);

  if (box) {
    const outline = element('span', 'immich-ext-sources__box');
    outline.style.left = percent(box.x1);
    outline.style.top = percent(box.y1);
    outline.style.width = percent(box.x2 - box.x1);
    outline.style.height = percent(box.y2 - box.y1);
    // Until the picture is there the frame has no size and the outline would be a dot (for good if it fails).
    outline.hidden = true;
    image.addEventListener('load', () => (outline.hidden = false));
    frame.appendChild(outline);
  }

  // Over the bottom edge of the picture itself (the frame hugs it), on hover or focus; a sibling of the link, links do not nest.
  if (extra.pageHref) {
    const page = createLink('immich-ext-sources__page', extra.pageHref, true);
    page.textContent = 'На сторінку';
    page.title = 'Відкрити сторінку, на якій знайдено фото';
    frame.appendChild(page);
  }

  image.src = src;
  slot.appendChild(frame);
  return slot;
}

type Mode = 'compare' | 'tiles';

const KINDS: readonly { kind: Kind; label: string }[] = [
  { kind: 'faces', label: 'Обличчя' },
  { kind: 'copies', label: 'Копії' },
];

const MODES: readonly { mode: Mode; label: string }[] = [
  { mode: 'compare', label: 'порівняння' },
  { mode: 'tiles', label: 'плитка' },
];

/** Kept in the page's `localStorage` (a per-viewer convenience); anything but «плитка» reads as the default. */
function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'tiles' ? 'tiles' : 'compare';
  } catch {
    return 'compare';
  }
}

function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // storage blocked: the choice just lasts until the popup is closed
  }
}

/** `all` or one platform; the chips' choice. */
type Platform = Source | 'all';
/** The «джерело» choice: every source, the rows with no source (`other`), or one Immeyes source by its id. */
type SourceChoice = 'all' | 'other' | number;
type Filter = { platform: Platform; source: SourceChoice };

/** The chips, in order. «Сайти» is plural here, the single «Сайт» is a card's label. */
const PLATFORMS: readonly { platform: Platform; label: string }[] = [
  { platform: 'all', label: 'Усі' },
  { platform: 'flickr', label: 'Flickr' },
  { platform: 'telegram', label: 'Telegram' },
  { platform: 'site', label: 'Сайти' },
];

const NO_FILTER: Filter = { platform: 'all', source: 'all' };

function asPlatform(value: unknown): Platform {
  return PLATFORMS.find((item) => item.platform === value)?.platform ?? 'all';
}

/** Kept like the mode; anything unreadable is «Усі» / «усі джерела». */
function loadFilter(): Filter {
  try {
    const raw = asRecord(JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? 'null'));
    return {
      platform: asPlatform(raw?.platform),
      source: raw?.source === 'other' ? 'other' : (asSourceId(raw?.source) ?? 'all'),
    };
  } catch {
    return NO_FILTER;
  }
}

function saveFilter(filter: Filter): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // storage blocked: the choice just lasts until the popup is closed
  }
}

/** How many of `matches` each platform has (`all`: every one). */
function platformCounts(matches: readonly Match[]): Record<Platform, number> {
  const counts: Record<Platform, number> = { all: matches.length, flickr: 0, telegram: 0, site: 0 };

  for (const { photo } of matches) {
    counts[photo.source] += 1;
  }

  return counts;
}

/** One Immeyes source among the rows, or the rows that have none (`other`, shown as «інше»). */
type SourceGroup = { choice: 'other' | number; name: string; count: number };

/**
 * The sources of `platform`'s rows, most rows first, «інше» (rows with no source id) last. The name is the
 * first one a row of the source carries; a source whose rows have none is called by its number.
 */
function sourceGroups(matches: readonly Match[], platform: Platform): SourceGroup[] {
  const groups = new Map<number | 'other', { name: string | null; count: number }>();

  for (const { photo } of matches) {
    if (platform === 'all' || photo.source === platform) {
      const key = photo.sourceId ?? 'other';
      const group = groups.get(key) ?? { name: null, count: 0 };
      group.name ??= photo.sourceId === null ? null : photo.sourceName;
      group.count += 1;
      groups.set(key, group);
    }
  }

  const rank = (group: SourceGroup) => (group.choice === 'other' ? 1 : 0);
  return [...groups]
    .map(([choice, { name, count }]) => ({
      choice,
      name: choice === 'other' ? 'інше' : (name ?? `#${choice}`),
      count,
    }))
    .sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.name.localeCompare(b.name, 'uk'));
}

/**
 * What the saved choice means for these rows: a platform with no rows is «Усі» (and then its source goes
 * with it), a source that is not among the platform's sources (or the only one there) is «усі джерела».
 * The saved choice itself is left alone.
 */
function resolveFilter(saved: Filter, matches: readonly Match[]): Filter {
  const platform = platformCounts(matches)[saved.platform] > 0 ? saved.platform : 'all';
  const groups = sourceGroups(matches, platform);
  const known =
    platform === saved.platform && groups.length > 1 && groups.some((group) => group.choice === saved.source);
  return { platform, source: known ? saved.source : 'all' };
}

function passesFilter({ photo }: Match, filter: Filter): boolean {
  if (filter.platform !== 'all' && photo.source !== filter.platform) {
    return false;
  }

  if (filter.source === 'all') {
    return true;
  }

  return filter.source === 'other' ? photo.sourceId === null : photo.sourceId === filter.source;
}

/**
 * One match as the lists hold it, whatever the mode: the verdict handling works on this, a view only
 * shows it (and is thrown away and made again when the mode changes).
 */
type Entry = {
  match: Match;
  /** A verdict is being saved: further clicks wait, so the answers cannot arrive out of order. */
  saving: boolean;
  /** The last save failed: the error line shows until the next attempt. */
  failed: boolean;
  view: View | null;
};

/** What every mode's item has: the two verdict buttons, the error line, and maybe the «нове» badge. */
type View = {
  element: HTMLElement;
  yes: HTMLButtonElement;
  no: HTMLButtonElement;
  error: HTMLElement;
  badge: HTMLElement | null;
};

type VerdictHandler = (entry: Entry, pressed: 'yes' | 'no') => void;

function createVerdictButtons(
  entry: Entry,
  onVerdict: VerdictHandler,
  className: string,
): { root: HTMLElement; yes: HTMLButtonElement; no: HTMLButtonElement } {
  const root = element('div', className);
  const yes = element('button', 'immich-ext-sources__verdict immich-ext-sources__verdict--yes', 'так');
  const no = element('button', 'immich-ext-sources__verdict immich-ext-sources__verdict--no', 'ні');
  yes.type = 'button';
  no.type = 'button';
  yes.addEventListener('click', () => onVerdict(entry, 'yes'));
  no.addEventListener('click', () => onVerdict(entry, 'no'));
  root.append(yes, no);
  return { root, yes, no };
}

function createErrorLine(): HTMLElement {
  const error = element('p', 'immich-ext-sources__error', 'Не вдалося зберегти вердикт');
  error.hidden = true;
  error.setAttribute('role', 'alert');
  return error;
}

/** «порівняння»: the external picture (Flickr, Telegram, a site) and the library photo side by side, the facts under them. */
function createCard(entry: Entry, onVerdict: VerdictHandler): View {
  const { match } = entry;
  const { photo, asset } = match;
  const root = element('article', 'immich-ext-sources__card');
  root.dataset.matchId = String(match.id);
  root.dataset.distance = String(match.distance);

  const pictures = element('div', 'immich-ext-sources__pictures');
  pictures.append(
    // A website photo: the picture opens the file and «На сторінку» the page; any other (and an older Immeyes) opens its page, as before.
    photo.imageUrl
      ? createPicture(photo.imageUrl, true, photo.thumbUrl, SOURCE_LABELS[photo.source], match.face, {
          title: 'Відкрити зображення',
          pageHref: photo.pageUrl,
        })
      : createPicture(photo.pageUrl, true, photo.thumbUrl, SOURCE_LABELS[photo.source], match.face),
    createPicture(
      `/photos/${encodeURIComponent(asset.id)}`,
      false,
      `/api/assets/${encodeURIComponent(asset.id)}/thumbnail?size=thumbnail`,
      'Immich',
      asset.box,
    ),
  );

  const meta = element('div', 'immich-ext-sources__meta');
  meta.appendChild(element('span', 'immich-ext-sources__distance', `відстань ${formatDistance(match.distance)}`));

  if (photo.takenAt) {
    meta.appendChild(element('span', 'immich-ext-sources__date', formatDate(photo.takenAt)));
  }

  const source = element('span', 'immich-ext-sources__source-line');
  const owner = photo.ownerUrl
    ? createLink('immich-ext-sources__owner', photo.ownerUrl, true)
    : element('span', 'immich-ext-sources__owner');
  owner.textContent = photo.ownerLabel;

  if (photo.ownerUrl) {
    owner.title = OWNER_TITLES[photo.source];
  }

  source.append(owner, element('span', 'immich-ext-sources__source', SOURCE_LABELS[photo.source]));
  meta.appendChild(source);

  const { root: verdicts, yes, no } = createVerdictButtons(entry, onVerdict, 'immich-ext-sources__verdicts');
  const error = createErrorLine();
  root.append(pictures, meta, verdicts, error);

  return { element: root, yes, no, error, badge: null };
}

/**
 * «плитка»: only the external picture, cropped to a square tile that links to its page (Flickr, Telegram, a site); the
 * verdict bar slides over the bottom edge on hover or focus, the error line is under the tile.
 */
function createTile(entry: Entry, onVerdict: VerdictHandler): View {
  const { match } = entry;
  const { photo } = match;
  const root = element('article', 'immich-ext-sources__tile');
  root.dataset.matchId = String(match.id);
  root.dataset.distance = String(match.distance);

  const frame = element('div', 'immich-ext-sources__tile-frame');
  // «Alice Photo · 12.03.2019 · відстань 0,374» (no date part when unknown)
  const label = [
    photo.ownerLabel,
    photo.takenAt ? formatDate(photo.takenAt) : null,
    `відстань ${formatDistance(match.distance)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  // A website photo opens the file, and the page is a bar over the top edge (the bottom one is the verdicts'), shown with it on hover or focus
  const link = createLink('immich-ext-sources__tile-link', photo.imageUrl ?? photo.pageUrl, true);
  link.title = label;
  link.setAttribute('aria-label', label);

  const image = createImage(SOURCE_LABELS[photo.source], 'immich-ext-sources__tile-image');
  image.src = photo.thumbUrl;
  link.appendChild(image);

  const badge = element('span', 'immich-ext-sources__badge', 'нове');
  const { root: verdicts, yes, no } = createVerdictButtons(entry, onVerdict, 'immich-ext-sources__tile-verdicts');
  frame.append(link, badge, verdicts);

  if (photo.imageUrl) {
    const page = createLink('immich-ext-sources__tile-page', photo.pageUrl, true);
    page.textContent = 'На сторінку';
    page.title = 'Відкрити сторінку, на якій знайдено фото';
    frame.appendChild(page);
  }

  const error = createErrorLine();
  root.append(frame, error);

  return { element: root, yes, no, error, badge };
}

function paintView(entry: Entry): void {
  const view = entry.view;

  if (!view) {
    return;
  }

  const { verdict } = entry.match;
  view.yes.classList.toggle('is-active', verdict === 'yes');
  view.no.classList.toggle('is-active', verdict === 'no');
  view.yes.setAttribute('aria-pressed', String(verdict === 'yes'));
  view.no.setAttribute('aria-pressed', String(verdict === 'no'));
  view.yes.disabled = entry.saving;
  view.no.disabled = entry.saving;
  view.error.hidden = !entry.failed;

  if (view.badge) {
    view.badge.hidden = verdict !== null;
  }
}

type Section = { title: string; root: HTMLElement; heading: HTMLElement; grid: HTMLElement };

function createSection(title: string): Section {
  const root = element('section', 'immich-ext-sources__section');
  const heading = element('h3', 'immich-ext-sources__heading');
  const grid = element('div', 'immich-ext-sources__grid');
  root.append(heading, grid);
  return { root, heading, grid, title };
}

/** Puts an item into `grid` among the others by distance (closest first, like the lists come). */
function insertByDistance(grid: HTMLElement, item: HTMLElement, distance: number): void {
  let before: Element | null = null;

  for (
    let child = grid.lastElementChild;
    child instanceof HTMLElement && Number(child.dataset.distance) > distance;
    child = child.previousElementSibling
  ) {
    before = child;
  }

  grid.insertBefore(item, before);
}

type FilterBar = {
  root: HTMLElement;
  /** Shows the counts of `matches` (the loaded, not rejected ones) and the choice `filter` that applies to them. */
  paint: (matches: readonly Match[], filter: Filter) => void;
};

function createOption(value: string, text: string): HTMLOptionElement {
  const option = element('option', '', text);
  option.value = value;
  return option;
}

function parseSourceChoice(value: string): SourceChoice {
  return value === 'all' || value === 'other' ? value : Number(value);
}

/**
 * Platform chips («Усі · Flickr · Telegram · Сайти», each with its count) and the «джерело» select. Each part
 * hides itself when there is nothing to choose from: the chips with fewer than two platforms, the select
 * with fewer than two sources in the chosen platform.
 */
function createFilterBar(onChoose: (filter: Filter) => void): FilterBar {
  const root = element('div', 'immich-ext-sources__filter');

  const platforms = element('div', 'immich-ext-sources__platforms');
  platforms.setAttribute('role', 'group');
  platforms.setAttribute('aria-label', 'Платформа');

  const chips = PLATFORMS.map(({ platform, label }) => {
    const button = element('button', 'immich-ext-sources__chip');
    const count = element('span', 'immich-ext-sources__chip-count');
    button.type = 'button';
    button.dataset.platform = platform;
    button.append(label, ' ', count);
    button.addEventListener('click', () => onChoose({ platform, source: 'all' }));
    return { platform, button, count };
  });

  platforms.append(...chips.map(({ button }) => button));

  const pick = element('label', 'immich-ext-sources__pick');
  const select = element('select', 'immich-ext-sources__select');
  pick.append(element('span', 'immich-ext-sources__pick-label', 'джерело'), select);

  let platform: Platform = 'all';
  let options = '';
  select.addEventListener('change', () => onChoose({ platform, source: parseSourceChoice(select.value) }));

  root.append(platforms, pick);

  return {
    root,
    paint: (matches, filter) => {
      const counts = platformCounts(matches);
      const groups = sourceGroups(matches, filter.platform);
      const severalPlatforms = chips.filter((chip) => chip.platform !== 'all' && counts[chip.platform] > 0).length > 1;
      const severalSources = groups.length > 1;
      platform = filter.platform;

      for (const chip of chips) {
        const active = chip.platform === filter.platform;
        chip.count.textContent = String(counts[chip.platform]);
        chip.button.disabled = counts[chip.platform] === 0;
        chip.button.classList.toggle('is-empty', counts[chip.platform] === 0);
        chip.button.classList.toggle('is-active', active);
        chip.button.setAttribute('aria-pressed', String(active));
      }

      // The options are made again only when they changed, so an open list is not closed under the user's hand.
      const next = JSON.stringify(groups);

      if (severalSources && next !== options) {
        options = next;
        select.replaceChildren(
          createOption('all', 'усі джерела'),
          ...groups.map((group) => createOption(String(group.choice), `${group.name} · ${group.count}`)),
        );
      }

      select.value = String(filter.source);
      platforms.hidden = !severalPlatforms;
      pick.hidden = !severalSources;
      root.hidden = !severalPlatforms && !severalSources;
    },
  };
}

type Lists = {
  nodes: HTMLElement[];
  setMode: (mode: Mode) => void;
  /** How many matches the list holds now: every one but those rejected with «ні». */
  size: () => number;
};

/** Where the whole list of each kind is in Immeyes (the faces of the person, or the copies tab). */
function listFooter(kind: Kind, immeyesUrl: string, personId: string): { href: string; text: string } {
  return kind === 'faces'
    ? { href: `${immeyesUrl}/flickr?person=${encodeURIComponent(personId)}`, text: 'усі збіги в Immeyes' }
    : { href: `${immeyesUrl}/flickr?tab=copies`, text: 'усі копії в Immeyes' };
}

function createLists(
  immeyesUrl: string,
  personId: string,
  confirmed: Match[],
  fresh: Match[],
  initialMode: Mode,
  kind: Kind,
  /** The list changed (a verdict, a filter): the popup repaints the numbers of its switch. */
  onChange: () => void,
): Lists {
  const confirmedSection = createSection('Підтверджені');
  const freshSection = createSection('Нові');
  const sections = [confirmedSection, freshSection];
  const empty = element('p', 'immich-ext-sources__empty', 'немає');
  const entries: Entry[] = [...confirmed, ...fresh]
    .sort((a, b) => a.distance - b.distance)
    .map((match) => ({ match, saving: false, failed: false, view: null }));
  let mode = initialMode;
  let size = 0;
  // The choice as the user left it; what applies to the rows at hand is `resolveFilter` of it.
  let chosen = loadFilter();

  const filterBar = createFilterBar((next) => {
    chosen = next;
    saveFilter(next);
    refresh();
  });
  const shown = element('span', 'immich-ext-sources__shown');

  /** Where the item of an entry belongs: «Підтверджені», «Нові», or nowhere («ні», or filtered out). */
  const gridOf = ({ match }: Entry, filter: Filter): HTMLElement | null => {
    if (!passesFilter(match, filter)) {
      return null;
    }

    return match.verdict === 'yes' ? confirmedSection.grid : match.verdict === null ? freshSection.grid : null;
  };

  /** Takes the entry's item out of wherever it is and puts it into `grid` among the others by distance. */
  const place = (entry: Entry, grid: HTMLElement | null) => {
    entry.view?.element.remove();

    if (!grid) {
      return;
    }

    // Items are made when first needed: a filtered-out entry costs no picture request.
    entry.view ??= (mode === 'tiles' ? createTile : createCard)(entry, onVerdict);
    insertByDistance(grid, entry.view.element, entry.match.distance);
    paintView(entry);
  };

  /**
   * Brings everything in line with the entries and the filter: the bar's counts and choices, which items
   * are shown and where, the headings, the footer. Called after anything that changes one of them.
   */
  const refresh = () => {
    // A match rejected with «ні» is out of every count, as it is out of both lists.
    const loaded = entries.filter(({ match }) => match.verdict !== 'no').map(({ match }) => match);
    size = loaded.length;
    const filter = resolveFilter(chosen, loaded);
    filterBar.paint(loaded, filter);

    let visible = 0;

    for (const entry of entries) {
      const grid = gridOf(entry, filter);
      visible += grid ? 1 : 0;

      if ((entry.view?.element.parentElement ?? null) !== grid) {
        place(entry, grid);
      }
    }

    for (const section of sections) {
      const size = section.grid.children.length;
      section.heading.textContent = `${section.title} (${size})`;
      section.root.hidden = size === 0;
    }

    empty.hidden = visible > 0;
    shown.hidden = visible === loaded.length;
    shown.textContent = shown.hidden ? '' : `показано ${visible} з ${loaded.length}`;
    onChange();
  };

  // The one place a verdict is handled; cards and tiles only call it.
  const onVerdict: VerdictHandler = (entry, pressed) => {
    if (entry.saving) {
      return;
    }

    const previous = entry.match.verdict;
    // Pressing the active one again clears the verdict.
    const next: Verdict = previous === pressed ? null : pressed;

    entry.failed = false;
    entry.saving = true;
    entry.match.verdict = next;
    refresh();
    paintView(entry);

    void postVerdict(immeyesUrl, entry.match.id, next).then((saved) => {
      entry.saving = false;

      if (saved) {
        paintView(entry);
        void fetchCount(immeyesUrl, personId);
        return;
      }

      entry.match.verdict = previous;
      entry.failed = true;
      refresh();
      paintView(entry);
    });
  };

  /** Builds the items of the current mode from the entries (the lists, verdicts and errors stay as they are). */
  const render = () => {
    for (const section of sections) {
      section.grid.replaceChildren();
      section.grid.classList.toggle('immich-ext-sources__grid--tiles', mode === 'tiles');
    }

    for (const entry of entries) {
      entry.view = null;
    }

    refresh();
  };

  render();

  const footer = element('p', 'immich-ext-sources__footer');
  const where = listFooter(kind, immeyesUrl, personId);
  const all = createLink('immich-ext-sources__all', where.href, true);
  all.textContent = where.text;
  footer.append(shown, all);

  return {
    nodes: [filterBar.root, confirmedSection.root, freshSection.root, empty, footer],
    setMode: (next) => {
      if (next !== mode) {
        mode = next;
        render();
      }
    },
    size: () => size,
  };
}

let removeKeyListener: (() => void) | null = null;

export function closeOtherSourcesPopup(): void {
  removeKeyListener?.();
  removeKeyListener = null;
  document.querySelector(MODAL_SELECTOR)?.remove();
}

/** Opens the popup at once with «Рахую…» and fills it when both lists have come. */
export function openOtherSourcesPopup(immeyesUrl: string, personId: string): void {
  closeOtherSourcesPopup();

  // Same overlay, panel and theme tokens as the person card modal.
  const overlay = element('div', 'immich-ext-person-card-modal');
  overlay.dataset.immichPeoplePlus = 'sources-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', TITLE_ID);

  const backdrop = element('button', 'immich-ext-person-card-modal__backdrop');
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Закрити');
  backdrop.addEventListener('click', closeOtherSourcesPopup);

  const panel = element('div', 'immich-ext-person-card-modal__panel immich-ext-sources__panel');
  panel.addEventListener('click', (event) => event.stopPropagation());

  const title = element('h2', 'immich-ext-person-card-modal__title', 'В інших джерелах');
  title.id = TITLE_ID;

  const closeButton = element('button', 'immich-ext-person-card__chip', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Закрити');
  closeButton.addEventListener('click', closeOtherSourcesPopup);

  // «порівняння» / «плитка»: remembered between openings; applies to the lists as soon as they are there.
  let mode = loadMode();
  // The list of each kind; the copies one exists only when there is a copy of the person's photos.
  const lists: Record<Kind, Lists | null> = { faces: null, copies: null };
  let shownKind: Kind = 'faces';

  const modeSwitch = element('div', 'immich-ext-sources__modes');
  modeSwitch.setAttribute('role', 'group');
  modeSwitch.setAttribute('aria-label', 'Вигляд');

  const modeButtons = MODES.map(({ mode: value, label }) => {
    const button = element('button', 'immich-ext-sources__mode', label);
    button.type = 'button';
    button.dataset.mode = value;
    button.addEventListener('click', () => {
      if (value === mode) {
        return;
      }

      mode = value;
      saveMode(value);
      paintModes();
      lists.faces?.setMode(value);
      lists.copies?.setMode(value);
      // The layout is a different one: start from the top rather than at some arbitrary place of it.
      panel.scrollTop = 0;
    });
    return button;
  });

  const paintModes = () => {
    for (const button of modeButtons) {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };

  paintModes();
  modeSwitch.append(...modeButtons);

  // «Обличчя (N)» / «Копії (M)»: which list the body shows. Hidden until the lists are there, and without copies.
  const viewSwitch = element('div', 'immich-ext-sources__modes immich-ext-sources__views');
  viewSwitch.setAttribute('role', 'group');
  viewSwitch.setAttribute('aria-label', 'Список');
  viewSwitch.hidden = true;

  const viewButtons = KINDS.map(({ kind, label }) => {
    const button = element('button', 'immich-ext-sources__mode', label);
    button.type = 'button';
    button.dataset.view = kind;
    button.addEventListener('click', () => showKind(kind));
    return button;
  });

  viewSwitch.append(...viewButtons);

  /** The labels carry the live size of each list (a «ні» takes a match out of it). */
  const paintViews = () => {
    for (const button of viewButtons) {
      const { kind, label } = KINDS.find(({ kind: value }) => value === button.dataset.view)!;
      const active = kind === shownKind;
      button.textContent = `${label} (${lists[kind]?.size() ?? 0})`;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };

  const showKind = (kind: Kind) => {
    const next = lists[kind];

    if (!next || kind === shownKind) {
      return;
    }

    shownKind = kind;
    body.replaceChildren(...next.nodes);
    paintViews();
    // A different list: start from its top rather than at the place the other one was left.
    panel.scrollTop = 0;
  };

  const header = element('div', 'immich-ext-person-card-modal__header');
  header.append(title, viewSwitch, modeSwitch, closeButton);

  const body = element('div', 'immich-ext-person-card-modal__body');
  body.appendChild(element('p', 'immich-ext-sources__status', 'Рахую…'));

  panel.append(header, body);
  overlay.append(backdrop, panel);
  document.body.appendChild(overlay);
  closeButton.focus();

  // Capture phase: Esc closes only the popup, Immich's own Esc shortcuts do not also run.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeOtherSourcesPopup();
    }
  };

  document.addEventListener('keydown', onKeyDown, true);
  removeKeyListener = () => document.removeEventListener('keydown', onKeyDown, true);

  void Promise.all([
    requestMatches(immeyesUrl, personId, 'faces', 'yes'),
    requestMatches(immeyesUrl, personId, 'faces', 'new'),
    requestMatches(immeyesUrl, personId, 'copies', 'yes'),
    requestMatches(immeyesUrl, personId, 'copies', 'new'),
  ]).then(([confirmed, fresh, copyConfirmed, copyFresh]) => {
    // Closed (or replaced by a newer popup) while the answers were on their way.
    if (!overlay.isConnected) {
      return;
    }

    if (!confirmed || !fresh) {
      body.replaceChildren(element('p', 'immich-ext-sources__status', 'Immeyes недоступний'));
      return;
    }

    const make = (kind: Kind, yes: Match[], now: Match[]) => {
      // A verdict saved between the two requests could put a match in both: the confirmed one wins.
      const ids = new Set(yes.map((match) => match.id));
      return createLists(
        immeyesUrl,
        personId,
        yes,
        now.filter((match) => !ids.has(match.id)),
        mode,
        kind,
        paintViews,
      );
    };

    lists.faces = make('faces', confirmed, fresh);

    // An Immeyes without the copies feature answers nothing for them, a person without copies gets no switch.
    if (copyConfirmed && copyFresh && copyConfirmed.length + copyFresh.length > 0) {
      lists.copies = make('copies', copyConfirmed, copyFresh);
    }

    // Only copies to review: start there.
    shownKind = lists.faces.size() === 0 && lists.copies ? 'copies' : 'faces';
    body.replaceChildren(...lists[shownKind]!.nodes);
    viewSwitch.hidden = !lists.copies;
    paintViews();
  });
}
