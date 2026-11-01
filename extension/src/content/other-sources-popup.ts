/**
 * "В інших джерелах" on the person page: where else this person was recognised, from Immeyes'
 * Flickr probe (a Flickr face matched against the library's people, with a cosine distance).
 *
 * - The button is mounted next to the Immeyes links once `GET <Immeyes URL>/api/flickr/persons/<id>/count`
 *   answers; an Immeyes without the Flickr feature (404, network error) gets no button at all.
 * - The popup, opened by that button, lists confirmed and new matches
 *   (`.../matches?max=0.5&show=yes|new`) and saves the user's «так» / «ні» verdict at once.
 */

const MODAL_SELECTOR = '[data-immich-people-plus="sources-modal"]';
const TITLE_ID = 'immich-ext-sources-title';
/** The usual cut for "same person"; fixed, the popup has no control for it. */
const MAX_DISTANCE = 0.5;
const COUNT_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 60_000;
const VERDICT_TIMEOUT_MS = 15_000;

type Verdict = 'yes' | 'no' | null;
/** Fractions 0..1 of the picture. */
type Box = { x1: number; y1: number; x2: number; y2: number };

type Tally = { confirmed: number; new: number; rejected: number };
/** `photos`: distinct Flickr photos, `matches`: faces. */
type Count = { photos: Tally; matches: Tally };

type Match = {
  id: number;
  distance: number;
  verdict: Verdict;
  photo: {
    owner: string;
    /** `ownerName ?? pathAlias ?? owner` */
    ownerLabel: string;
    takenAt: Date | null;
    pageUrl: string;
    thumbUrl: string;
  };
  face: Box;
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

  return { photos: asTally(raw.photos), matches: asTally(raw.matches) };
}

function parseMatch(value: unknown, verdict: Verdict): Match | null {
  const raw = asRecord(value);
  const photo = asRecord(raw?.photo);
  const asset = asRecord(raw?.asset);

  const id = raw?.id;
  const distance = raw?.distance;
  const owner = asString(photo?.owner);
  const pageUrl = asHttpUrl(photo?.pageUrl);
  const thumbUrl = asHttpUrl(photo?.thumbUrl);
  const face = asBox(raw?.face);
  const assetId = asString(asset?.id);

  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    typeof distance !== 'number' ||
    !Number.isFinite(distance) ||
    !owner ||
    !pageUrl ||
    !thumbUrl ||
    !face ||
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
      owner,
      ownerLabel: asString(photo?.ownerName) ?? asString(photo?.pathAlias) ?? owner,
      takenAt: asDate(photo?.takenAt),
      pageUrl,
      thumbUrl,
    },
    face,
    asset: { id: assetId, box: asBox(asset?.box) },
  };
}

/** Rows of a list; a malformed one is dropped instead of failing the popup. Not an array: no answer. */
function parseMatches(value: unknown, verdict: Verdict): Match[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.flatMap((item) => parseMatch(item, verdict) ?? []);
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

async function requestMatches(
  immeyesUrl: string,
  personId: string,
  show: 'yes' | 'new',
): Promise<Match[] | null> {
  const url = `${personUrl(immeyesUrl, personId)}/matches?max=${MAX_DISTANCE}&show=${show}`;
  return parseMatches(await getJson(url, LIST_TIMEOUT_MS), show === 'yes' ? 'yes' : null);
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

function applyCount(button: HTMLButtonElement, { photos }: Count): void {
  const total = photos.confirmed + photos.new;
  button.textContent = `В інших джерелах (${total})`;
  button.classList.toggle('is-empty', total === 0);
  button.title =
    total === 0
      ? 'збігів немає'
      : `підтверджених ${photos.confirmed}, нових ${photos.new}, відхилених ${photos.rejected}`;
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

/**
 * A square slot with the picture at its natural aspect and the face outlined. The frame hugs the
 * picture (`inline-block`), so the percentages of the box are fractions of the picture itself.
 */
function createPicture(href: string, newTab: boolean, src: string, alt: string, box: Box | null): HTMLElement {
  const slot = createLink('immich-ext-sources__slot', href, newTab);
  const frame = element('span', 'immich-ext-sources__frame');
  const image = element('img', 'immich-ext-sources__image');
  image.alt = alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  frame.appendChild(image);

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

  image.src = src;
  slot.appendChild(frame);
  return slot;
}

function photostreamUrl(owner: string): string {
  return `https://www.flickr.com/photos/${encodeURIComponent(owner).replace(/%40/g, '@')}/`;
}

type Card = {
  match: Match;
  element: HTMLElement;
  yes: HTMLButtonElement;
  no: HTMLButtonElement;
  error: HTMLElement;
  /** A verdict is being saved: further clicks wait, so the answers cannot arrive out of order. */
  saving: boolean;
};

function createCard(match: Match, onVerdict: (card: Card, pressed: 'yes' | 'no') => void): Card {
  const { photo, asset } = match;
  const root = element('article', 'immich-ext-sources__card');
  root.dataset.matchId = String(match.id);
  root.dataset.distance = String(match.distance);

  const pictures = element('div', 'immich-ext-sources__pictures');
  pictures.append(
    createPicture(photo.pageUrl, true, photo.thumbUrl, 'Flickr', match.face),
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
  const owner = createLink('immich-ext-sources__owner', photostreamUrl(photo.owner), true);
  owner.textContent = photo.ownerLabel;
  owner.title = 'Фотопотік автора на Flickr';
  source.append(owner, element('span', 'immich-ext-sources__source', 'Flickr'));
  meta.appendChild(source);

  const verdicts = element('div', 'immich-ext-sources__verdicts');
  const yes = element('button', 'immich-ext-sources__verdict immich-ext-sources__verdict--yes', 'так');
  const no = element('button', 'immich-ext-sources__verdict immich-ext-sources__verdict--no', 'ні');
  yes.type = 'button';
  no.type = 'button';
  verdicts.append(yes, no);

  const error = element('p', 'immich-ext-sources__error');
  error.hidden = true;
  error.setAttribute('role', 'alert');

  root.append(pictures, meta, verdicts, error);

  const card: Card = { match, element: root, yes, no, error, saving: false };
  yes.addEventListener('click', () => onVerdict(card, 'yes'));
  no.addEventListener('click', () => onVerdict(card, 'no'));
  paintVerdict(card);

  return card;
}

function paintVerdict(card: Card): void {
  const { verdict } = card.match;
  card.yes.classList.toggle('is-active', verdict === 'yes');
  card.no.classList.toggle('is-active', verdict === 'no');
  card.yes.setAttribute('aria-pressed', String(verdict === 'yes'));
  card.no.setAttribute('aria-pressed', String(verdict === 'no'));
  card.yes.disabled = card.saving;
  card.no.disabled = card.saving;
}

type Section = { title: string; root: HTMLElement; heading: HTMLElement; grid: HTMLElement };

function createSection(title: string): Section {
  const root = element('section', 'immich-ext-sources__section');
  const heading = element('h3', 'immich-ext-sources__heading');
  const grid = element('div', 'immich-ext-sources__grid');
  root.append(heading, grid);
  return { root, heading, grid, title };
}

/** Puts a card into `grid` among the others by distance (closest first, like the lists come). */
function insertByDistance(grid: HTMLElement, card: Card): void {
  const after = Array.from(grid.children).find(
    (child) => Number((child as HTMLElement).dataset.distance) > card.match.distance,
  );
  grid.insertBefore(card.element, after ?? null);
}

function popupBody(immeyesUrl: string, personId: string, confirmed: Match[], fresh: Match[]): HTMLElement[] {
  const confirmedSection = createSection('Підтверджені');
  const freshSection = createSection('Нові');
  const empty = element('p', 'immich-ext-sources__empty', 'немає');

  const sync = () => {
    for (const section of [confirmedSection, freshSection]) {
      const size = section.grid.children.length;
      section.heading.textContent = `${section.title} (${size})`;
      section.root.hidden = size === 0;
    }

    empty.hidden = confirmedSection.grid.children.length + freshSection.grid.children.length > 0;
  };

  /** Moves the card to where its verdict says: «Підтверджені», «Нові», or out of both («ні»). */
  const place = (card: Card) => {
    card.element.remove();

    const { verdict } = card.match;

    if (verdict === 'yes') {
      insertByDistance(confirmedSection.grid, card);
    } else if (verdict === null) {
      insertByDistance(freshSection.grid, card);
    }

    paintVerdict(card);
    sync();
  };

  const onVerdict = (card: Card, pressed: 'yes' | 'no') => {
    if (card.saving) {
      return;
    }

    const previous = card.match.verdict;
    // Pressing the active one again clears the verdict.
    const next: Verdict = previous === pressed ? null : pressed;

    card.error.hidden = true;
    card.saving = true;
    card.match.verdict = next;
    place(card);

    void postVerdict(immeyesUrl, card.match.id, next).then((saved) => {
      card.saving = false;

      if (saved) {
        paintVerdict(card);
        void fetchCount(immeyesUrl, personId);
        return;
      }

      card.match.verdict = previous;
      card.error.textContent = 'Не вдалося зберегти вердикт';
      card.error.hidden = false;
      place(card);
    });
  };

  for (const [matches, section] of [
    [confirmed, confirmedSection],
    [fresh, freshSection],
  ] as const) {
    for (const match of matches) {
      insertByDistance(section.grid, createCard(match, onVerdict));
    }
  }

  sync();

  const footer = element('p', 'immich-ext-sources__footer');
  const all = createLink(
    'immich-ext-sources__all',
    `${immeyesUrl}/flickr?person=${encodeURIComponent(personId)}`,
    true,
  );
  all.textContent = 'усі збіги в Immeyes';
  footer.appendChild(all);

  return [confirmedSection.root, freshSection.root, empty, footer];
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

  const header = element('div', 'immich-ext-person-card-modal__header');
  header.append(title, closeButton);

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
    requestMatches(immeyesUrl, personId, 'yes'),
    requestMatches(immeyesUrl, personId, 'new'),
  ]).then(([confirmed, fresh]) => {
    // Closed (or replaced by a newer popup) while the answers were on their way.
    if (!overlay.isConnected) {
      return;
    }

    if (confirmed && fresh) {
      // A verdict saved between the two requests could put a match in both: the confirmed one wins.
      const ids = new Set(confirmed.map((match) => match.id));
      body.replaceChildren(
        ...popupBody(
          immeyesUrl,
          personId,
          confirmed,
          fresh.filter((match) => !ids.has(match.id)),
        ),
      );
    } else {
      body.replaceChildren(element('p', 'immich-ext-sources__status', 'Immeyes недоступний'));
    }
  });
}
