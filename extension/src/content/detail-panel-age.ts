import { fetchAssetPeople } from './api';
import { parseImmichBirthDate, resolveBirthDates } from './birth-date';
import { PersonApiClient } from './person-api-client';
import {
  describeBirthDate,
  formatAgeOnPhoto,
  immichAgeLanguage,
  immichDateLocale,
  photoDateFromLocalDateTime,
} from './person-age';
import { isExtensionContextValid } from './storage';

/**
 * Age under each person in the "People" block of Immich's info panel (DetailPanelPeople.svelte) for
 * people whose birth date is only in person-api. Immich already shows the age for its own
 * `birthDate`; those people are left to Immich.
 */

const AGE_MARK = 'person-age';
const AGE_SELECTOR = `[data-immich-people-plus="${AGE_MARK}"]`;
const AGE_CLASS = 'immich-ext-person-age';
const AGE_COMPACT_CLASS = `${AGE_CLASS} ${AGE_CLASS}--compact`;
/** Immich switches the people grid to smaller text above this many people. */
const COMPACT_AFTER_PEOPLE = 6;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Every Immich viewer route ends in `/photos/<assetId>` (`/photos/…`, `/albums/<id>/photos/…`, …). */
const VIEWER_ASSET_PATTERN = new RegExp(`/photos/(${UUID})/?$`, 'i');
/** Person links in the panel: `Route.viewPerson` = `/people/<id>?previousRoute=…`. */
const PERSON_LINK_PATTERN = new RegExp(`^/people/(${UUID})/?$`, 'i');

type AgeLabel = { text: string; title: string };
type PersonLink = { link: HTMLAnchorElement; personId: string };

export function getViewerAssetId(pathname: string): string | null {
  return VIEWER_ASSET_PATTERN.exec(pathname)?.[1]?.toLowerCase() ?? null;
}

function findPeopleLinks(): PersonLink[] {
  const panel = document.getElementById('detail-panel');

  if (!panel) {
    return [];
  }

  const links: PersonLink[] = [];

  for (const link of panel.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let pathname: string;

    try {
      pathname = new URL(link.href, window.location.origin).pathname;
    } catch {
      continue;
    }

    const personId = PERSON_LINK_PATTERN.exec(pathname)?.[1];

    if (personId) {
      links.push({ link, personId: personId.toLowerCase() });
    }
  }

  return links;
}

function removeAges(): void {
  for (const node of document.querySelectorAll(AGE_SELECTOR)) {
    node.remove();
  }
}

/** Idempotent: touches the DOM only when something differs (the route sync runs on every mutation). */
function renderAges(ages: ReadonlyMap<string, AgeLabel>, links: readonly PersonLink[]): void {
  const className = links.length > COMPACT_AFTER_PEOPLE ? AGE_COMPACT_CLASS : AGE_CLASS;

  for (const { link, personId } of links) {
    const label = ages.get(personId);
    let node = link.querySelector<HTMLElement>(`:scope > ${AGE_SELECTOR}`);

    if (!label) {
      node?.remove();
      continue;
    }

    if (!node) {
      node = document.createElement('p');
      node.dataset.immichPeoplePlus = AGE_MARK;
      link.appendChild(node);
    }

    if (node.className !== className) {
      node.className = className;
    }

    if (node.textContent !== label.text) {
      node.textContent = label.text;
    }

    if (node.title !== label.title) {
      node.title = label.title;
    }
  }
}

async function loadAges(assetId: string): Promise<Map<string, AgeLabel>> {
  const ages = new Map<string, AgeLabel>();
  const client = await PersonApiClient.create();

  if (!client) {
    return ages;
  }

  const asset = await fetchAssetPeople(assetId);
  const photoDate = photoDateFromLocalDateTime(asset.localDateTime);
  // Immich shows the age itself for people with its own birth date.
  const people = asset.people.filter((person) => !parseImmichBirthDate(person.birthDate));

  if (!photoDate || people.length === 0) {
    return ages;
  }

  const { byPersonId } = await resolveBirthDates(people, client);
  const language = immichAgeLanguage();
  const locale = immichDateLocale();

  for (const [personId, birthDate] of byPersonId) {
    const text = formatAgeOnPhoto(birthDate, photoDate, language);

    if (text) {
      ages.set(personId.toLowerCase(), { text, title: describeBirthDate(birthDate, language, locale) });
    }
  }

  return ages;
}

/** Ages for the photo open in the viewer; dropped as soon as another photo opens. */
let loaded: { assetId: string; ages: Map<string, AgeLabel> } | null = null;
let loadingAssetId: string | null = null;

export function syncDetailPanelAges(): void {
  const assetId = isExtensionContextValid() ? getViewerAssetId(window.location.pathname) : null;

  if (!assetId) {
    loaded = null;
    loadingAssetId = null;
    removeAges();
    return;
  }

  if (loaded?.assetId === assetId) {
    renderAges(loaded.ages, findPeopleLinks());
    return;
  }

  // Another photo: Immich keeps the link of a person who is on both photos, so the previous age
  // would stay under it until the new one is known.
  removeAges();

  // Nothing to fill (info panel closed, or a photo without people), or already on its way.
  if (loadingAssetId === assetId || findPeopleLinks().length === 0) {
    return;
  }

  loadingAssetId = assetId;

  void loadAges(assetId)
    .catch((error: unknown) => {
      console.warn('[Immich People Plus] Age in the info panel failed:', error);
      return new Map<string, AgeLabel>();
    })
    .then((ages) => {
      if (loadingAssetId === assetId) {
        loadingAssetId = null;
      }

      if (getViewerAssetId(window.location.pathname) !== assetId) {
        return;
      }

      loaded = { assetId, ages };
      renderAges(ages, findPeopleLinks());
    });
}
