import { describeBody, fingerprintParts } from './detail-panel-photographer';

/**
 * "Хто знімав" popup on the person page: who took the photos this person is on, with which camera
 * bodies and under which author signatures, from Immeyes
 * (`GET <Immeyes URL>/api/photographers/person/<personId>`). Opened by a button next to the Immeyes
 * links; the request is made only on that click (it can take seconds for a person with many photos).
 */

const MODAL_SELECTOR = '[data-immich-people-plus="who-shot-modal"]';
const TITLE_ID = 'immich-ext-who-shot-title';
/** Rows shown per section before «ще N». */
const VISIBLE_ROWS = 15;
const REQUEST_TIMEOUT_MS = 60_000;

type Counted = { photos: number };
/** `private`: a person's own camera rather than a photographer (absent in older Immeyes: false). */
type Photographer = { id: string; name: string; private: boolean };
type PhotographerEntry = Counted & Photographer;
/** `photographer`: whom a rule links the key to; null without a rule (and in an Immeyes without the field). */
type BodyEntry = Counted & {
  bodyKey: string;
  make: string | null;
  model: string | null;
  serial: string | null;
  photographer: Photographer | null;
};
type FingerprintEntry = Counted & {
  fingerprint: string;
  make: string | null;
  model: string | null;
  hash: string | null;
  photographer: Photographer | null;
};
type SignatureEntry = Counted & { signature: string; raw: string; photographer: Photographer | null };

type Summary = {
  total: number;
  attributed: number;
  withoutData: number;
  photographers: PhotographerEntry[];
  bodies: BodyEntry[];
  fingerprints: FingerprintEntry[];
  signatures: SignatureEntry[];
  /** How many different ones there are in all; the lists hold only the most frequent `limit`. */
  counts: { photographers: number; bodies: number; fingerprints: number; signatures: number };
};

type RowLink = { label: string; href: string; title: string };
/** `photographer`: a muted link to the photographer the row's key is linked to, right after the name. */
type Row = RowLink & { photos: number; photographer?: RowLink };

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asPhotographer(value: unknown): Photographer | null {
  const person = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const id = asString(person?.id);
  const name = asString(person?.name);
  return id && name ? { id, name, private: person?.private === true } : null;
}

/** Rows of a list; one without its key (or not an object) is dropped instead of failing the popup. */
function parseList<T>(value: unknown, parse: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const entry = item && typeof item === 'object' ? parse(item as Record<string, unknown>) : null;
    return entry ?? [];
  });
}

function parseSummary(value: unknown): Summary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const counts = (raw.counts ?? {}) as Record<string, unknown>;

  const photographers = parseList<PhotographerEntry>(raw.photographers, (item) => {
    const person = asPhotographer(item.photographer);
    return person ? { ...person, photos: asCount(item.photos) } : null;
  });

  const bodies = parseList<BodyEntry>(raw.bodies, (item) => {
    const bodyKey = asString(item.bodyKey);
    return bodyKey
      ? {
          bodyKey,
          make: asString(item.make),
          model: asString(item.model),
          serial: asString(item.serial),
          photographer: asPhotographer(item.photographer),
          photos: asCount(item.photos),
        }
      : null;
  });

  // Absent in an Immeyes without camera fingerprints: no rows.
  const fingerprints = parseList<FingerprintEntry>(raw.fingerprints, (item) => {
    const fingerprint = asString(item.fingerprint);
    return fingerprint
      ? {
          fingerprint,
          make: asString(item.make),
          model: asString(item.model),
          hash: asString(item.hash),
          photographer: asPhotographer(item.photographer),
          photos: asCount(item.photos),
        }
      : null;
  });

  const signatures = parseList<SignatureEntry>(raw.signatures, (item) => {
    const signature = asString(item.signature);
    const raw = asString(item.raw) ?? signature;
    return signature && raw
      ? { signature, raw, photographer: asPhotographer(item.photographer), photos: asCount(item.photos) }
      : null;
  });

  return {
    total: asCount(raw.total),
    attributed: asCount(raw.attributed),
    withoutData: asCount(raw.withoutData),
    photographers,
    bodies,
    fingerprints,
    signatures,
    counts: {
      photographers: Math.max(asCount(counts.photographers), photographers.length),
      bodies: Math.max(asCount(counts.bodies), bodies.length),
      fingerprints: Math.max(asCount(counts.fingerprints), fingerprints.length),
      signatures: Math.max(asCount(counts.signatures), signatures.length),
    },
  };
}

async function requestSummary(immeyesUrl: string, personId: string): Promise<Summary | null> {
  try {
    const response = await fetch(`${immeyesUrl}/api/photographers/person/${encodeURIComponent(personId)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // 503 (no state database) and any other failure read the same to the user: Immeyes is not usable.
    return response.ok ? parseSummary(await response.json()) : null;
  } catch {
    return null;
  }
}

/**
 * Answers per person for the life of the page. A failure is not kept, so the next click asks again;
 * a request still running when the popup is closed and reopened is shared instead of repeated.
 */
const cache = new Map<string, Summary>();
const inflight = new Map<string, Promise<Summary | null>>();

function loadSummary(immeyesUrl: string, personId: string): Promise<Summary | null> {
  const key = `${immeyesUrl}\n${personId}`;
  const cached = cache.get(key);

  if (cached) {
    return Promise.resolve(cached);
  }

  let pending = inflight.get(key);

  if (!pending) {
    pending = requestSummary(immeyesUrl, personId).then((summary) => {
      inflight.delete(key);

      if (summary) {
        cache.set(key, summary);
      }

      return summary;
    });
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

function createLink(className: string, { label, href, title }: RowLink): HTMLAnchorElement {
  const link = element('a', className, label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = title;
  return link;
}

function createRowItem({ label, href, title, photos, photographer }: Row): HTMLLIElement {
  const item = element('li', 'immich-ext-who-shot__row');
  item.appendChild(createLink('immich-ext-who-shot__name', { label, href, title }));

  if (photographer) {
    item.appendChild(createLink('immich-ext-who-shot__owner', photographer));
  }

  const count = element('span', 'immich-ext-who-shot__count', String(photos));
  count.title = `${photos} фото`;

  item.appendChild(count);
  return item;
}

/** One section: the first rows, then «ще N» which shows the rest of what Immeyes sent. */
function createSection(title: string, rows: readonly Row[], totalDistinct: number): HTMLElement {
  const section = element('section', 'immich-ext-who-shot__section');
  section.appendChild(element('h3', 'immich-ext-who-shot__heading', title));

  if (rows.length === 0) {
    section.appendChild(element('p', 'immich-ext-who-shot__empty', 'немає'));
    return section;
  }

  const list = element('ul', 'immich-ext-who-shot__list');
  list.append(...rows.slice(0, VISIBLE_ROWS).map(createRowItem));
  section.appendChild(list);

  if (rows.length <= VISIBLE_ROWS) {
    return section;
  }

  const more = element('button', 'immich-ext-who-shot__more', `ще ${totalDistinct - VISIBLE_ROWS}`);
  more.type = 'button';
  more.addEventListener('click', () => {
    list.append(...rows.slice(VISIBLE_ROWS).map(createRowItem));
    more.remove();

    // Immeyes sends only the most frequent ones; say so when the person has more than it sent.
    if (totalDistinct > rows.length) {
      section.appendChild(
        element('p', 'immich-ext-who-shot__note', `Показано найчастіші: ${rows.length} з ${totalDistinct}`),
      );
    }
  });
  section.appendChild(more);

  return section;
}

function summaryBody(immeyesUrl: string, personId: string, summary: Summary): HTMLElement[] {
  const encodedPerson = encodeURIComponent(personId);
  const photographerRows = (entries: readonly PhotographerEntry[]): Row[] =>
    entries.map((entry) => ({
      label: entry.name,
      href: `${immeyesUrl}/photographers/${encodeURIComponent(entry.id)}?person=${encodedPerson}`,
      title: `${entry.name}: фото цієї персони в Immeyes`,
      photos: entry.photos,
    }));

  // «→ Ім'я» after a body, fingerprint or signature a rule links to a photographer (`noun`: what is linked).
  const ownerLink = (noun: string, owner: Photographer | null): RowLink | undefined =>
    owner
      ? {
          label: `→ ${owner.name}`,
          href: `${immeyesUrl}/photographers/${encodeURIComponent(owner.id)}?person=${encodedPerson}`,
          title: `${noun} прив'язано до ${owner.private ? 'приватної камери' : 'фотографа'} «${owner.name}»`,
        }
      : undefined;

  // Private cameras (a person's own camera, not a photographer) get a list of their own.
  const photographers = summary.photographers.filter((entry) => !entry.private);
  const privateCameras = summary.photographers.filter((entry) => entry.private);
  // Photographers Immeyes did not send (it caps the lists) are counted under «Фотографи».
  const notSent = summary.counts.photographers - summary.photographers.length;

  const sections = [
    createSection('Фотографи', photographerRows(photographers), photographers.length + notSent),
  ];

  if (privateCameras.length > 0) {
    sections.push(createSection('Приватні камери', photographerRows(privateCameras), privateCameras.length));
  }

  sections.push(
    createSection(
      'Корпуси',
      summary.bodies.map((entry) => {
        const label = describeBody(entry);
        return {
          label,
          href: `${immeyesUrl}/photographers?tab=bodies&open=${encodeURIComponent(entry.bodyKey)}`,
          title: `${label}: усі фото з цього корпусу в Immeyes`,
          photos: entry.photos,
          photographer: ownerLink('Корпус', entry.photographer),
        };
      }),
      summary.counts.bodies,
    ),
  );

  if (summary.fingerprints.length > 0) {
    sections.push(
      createSection(
        'Відбитки',
        summary.fingerprints.map((entry) => {
          const { camera, hash } = fingerprintParts(entry.fingerprint, entry.make, entry.model, entry.hash);
          const label = `${camera} · відбиток ${hash}`;
          const open = encodeURIComponent(entry.fingerprint);
          return {
            label,
            href: `${immeyesUrl}/photographers?tab=fingerprints&open=${open}`,
            title: `${label}: усі фото з цим відбитком камери в Immeyes`,
            photos: entry.photos,
            photographer: ownerLink('Відбиток', entry.photographer),
          };
        }),
        summary.counts.fingerprints,
      ),
    );
  }

  sections.push(
    createSection(
      'Підписи',
      summary.signatures.map((entry) => ({
        label: entry.raw,
        href: `${immeyesUrl}/photographers?tab=signatures&open=${encodeURIComponent(entry.signature)}`,
        title: `${entry.raw}: усі фото з цим підписом в Immeyes`,
        photos: entry.photos,
        photographer: ownerLink('Підпис', entry.photographer),
      })),
      summary.counts.signatures,
    ),
  );

  return [
    element(
      'p',
      'immich-ext-who-shot__summary',
      `Фото: ${summary.total} · з фотографом: ${summary.attributed} · без даних: ${summary.withoutData}`,
    ),
    ...sections,
  ];
}

let removeKeyListener: (() => void) | null = null;

export function closeWhoShotPopup(): void {
  removeKeyListener?.();
  removeKeyListener = null;
  document.querySelector(MODAL_SELECTOR)?.remove();
}

/** Opens the popup at once with «Рахую…» and fills it when Immeyes answers (at once when it already did). */
export function openWhoShotPopup(immeyesUrl: string, personId: string): void {
  closeWhoShotPopup();

  // Same overlay, panel and theme tokens as the person card modal.
  const overlay = element('div', 'immich-ext-person-card-modal');
  overlay.dataset.immichPeoplePlus = 'who-shot-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', TITLE_ID);

  const backdrop = element('button', 'immich-ext-person-card-modal__backdrop');
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Закрити');
  backdrop.addEventListener('click', closeWhoShotPopup);

  const panel = element('div', 'immich-ext-person-card-modal__panel immich-ext-who-shot__panel');
  panel.addEventListener('click', (event) => event.stopPropagation());

  const title = element('h2', 'immich-ext-person-card-modal__title', 'Хто знімав');
  title.id = TITLE_ID;

  const closeButton = element('button', 'immich-ext-person-card__chip', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Закрити');
  closeButton.addEventListener('click', closeWhoShotPopup);

  const header = element('div', 'immich-ext-person-card-modal__header');
  header.append(title, closeButton);

  const body = element('div', 'immich-ext-person-card-modal__body');
  body.appendChild(element('p', 'immich-ext-who-shot__status', 'Рахую…'));

  panel.append(header, body);
  overlay.append(backdrop, panel);
  document.body.appendChild(overlay);
  closeButton.focus();

  // Capture phase: Esc closes only the popup, Immich's own Esc shortcuts do not also run.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeWhoShotPopup();
    }
  };

  document.addEventListener('keydown', onKeyDown, true);
  removeKeyListener = () => document.removeEventListener('keydown', onKeyDown, true);

  void loadSummary(immeyesUrl, personId).then((summary) => {
    // Closed (or replaced by a newer popup) while the answer was on its way.
    if (!overlay.isConnected) {
      return;
    }

    if (summary) {
      body.replaceChildren(...summaryBody(immeyesUrl, personId, summary));
    } else {
      body.replaceChildren(element('p', 'immich-ext-who-shot__status', 'Immeyes недоступний'));
    }
  });
}
